export class SingleProcessGate<T extends object> {
  private activeProcess: T | null = null;
  private startPromise: Promise<T> | null = null;
  private retirementTail: Promise<void> = Promise.resolve();
  private readonly retirements = new Map<T, Promise<void>>();

  constructor(
    private readonly startProcess: () => T | Promise<T>,
    private readonly isProcessAlive: (process: T) => boolean,
    private readonly stopProcess: (process: T) => Promise<void>
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
    const retirement = this.retirementTail.then(() => this.stopProcess(process));
    this.retirements.set(process, retirement);
    this.retirementTail = retirement;
    const clearRetirement = () => this.retirements.delete(process);
    retirement.then(clearRetirement, clearRetirement);
    return retirement;
  }
}

