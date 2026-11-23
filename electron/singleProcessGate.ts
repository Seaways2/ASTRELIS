export type SingleProcessGateOptions<T> = {
  /**
   * Upper bound for one retirement to hold back the next start. A stop that is
   * still pending after this many milliseconds keeps running in the background,
   * but it no longer blocks a replacement process.
   */
  retirementTimeoutMs?: number;
  /** Called when a retirement fails or exceeds its bound; the gate stays usable. */
  onRetirementFailure?: (process: T, reason: unknown) => void;
};

export class SingleProcessGate<T extends object> {
  private activeProcess: T | null = null;
  private startPromise: Promise<T> | null = null;
  // Orders starts after earlier retirements. It never rejects: a process that
  // could not be terminated must not prevent every later start this session.
  private retirementTail: Promise<void> = Promise.resolve();
  private readonly retirements = new Map<T, Promise<void>>();
  private readonly unterminated = new Set<T>();

  constructor(
    private readonly startProcess: () => T | Promise<T>,
    private readonly isProcessAlive: (process: T) => boolean,
    private readonly stopProcess: (process: T) => Promise<void>,
    private readonly options: SingleProcessGateOptions<T> = {}
  ) {}

  current() {
    return this.activeProcess;
  }

  isCurrent(process: T) {
    return this.activeProcess === process;
  }

  clearIfCurrent(process: T) {
    if (this.activeProcess !== process) return false;
    this.activeProcess = null;
    return true;
  }

  /** Retired processes whose termination failed or is still outstanding. */
  unterminatedProcesses() {
    return [...this.unterminated];
  }

  ensure() {
    const active = this.activeProcess;
    if (active && this.isProcessAlive(active)) return Promise.resolve(active);
    if (active) this.activeProcess = null;
    if (this.startPromise) return this.startPromise;

    const starting = this.retirementTail.then(async () => {
      const current = this.activeProcess;
      if (current && this.isProcessAlive(current)) return current;
      const process = await this.startProcess();
      this.activeProcess = process;
      return process;
    });
    this.startPromise = starting;
    const clearStarting = () => {
      if (this.startPromise === starting) this.startPromise = null;
    };
    starting.then(clearStarting, clearStarting);
    return starting;
  }

  retire(process: T) {
    const existing = this.retirements.get(process);
    if (existing) return existing;
    this.clearIfCurrent(process);
    this.unterminated.add(process);
    const retirement = this.retirementTail.then(() => this.stopProcess(process));
    this.retirements.set(process, retirement);
    const clearRetirement = () => this.retirements.delete(process);
    retirement.then(() => {
      this.unterminated.delete(process);
      clearRetirement();
    }, reason => {
      clearRetirement();
      this.options.onRetirementFailure?.(process, reason);
    });
    // The caller still observes the real outcome through the returned promise;
    // the ordering tail only waits for it, bounded, and swallows its failure.
    this.retirementTail = this.boundedSettle(process, retirement);
    return retirement;
  }

  private boundedSettle(process: T, retirement: Promise<void>) {
    const settled = retirement.then(() => undefined, () => undefined);
    const timeoutMs = this.options.retirementTimeoutMs;
    if (!timeoutMs || timeoutMs <= 0) return settled;
    return new Promise<void>(resolve => {
      const timer = setTimeout(() => {
        this.options.onRetirementFailure?.(process, new Error(`PROCESS_RETIREMENT_TIMEOUT after ${timeoutMs}ms`));
        resolve();
      }, timeoutMs);
      timer.unref?.();
      void settled.then(() => { clearTimeout(timer); resolve(); });
    });
  }
}

