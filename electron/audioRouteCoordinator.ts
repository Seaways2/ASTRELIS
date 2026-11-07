export type AudioRouteSource = "local" | "netease" | "youtube" | "web-direct";
export type AudioRoutePhase = "idle" | "preparing" | "active";

export type AudioRouteIdentity = {
  source: AudioRouteSource;
  sessionId: string;
  generation: number;
};

export type AudioRouteSnapshot = {
  generation: number;
  phase: AudioRoutePhase;
  active: AudioRouteIdentity | null;
  pending: AudioRouteIdentity | null;
};

const validSession = (value: string) => value.length > 0 && value.length <= 128;

export class AudioRouteCoordinator {
  private generation = 0;
  private active: AudioRouteIdentity | null = null;
  private pending: AudioRouteIdentity | null = null;

  prepare(source: AudioRouteSource, sessionId: string) {
    if (!validSession(sessionId)) return { ok: false as const, error: "INVALID_ROUTE_SESSION", snapshot: this.snapshot() };
    if (this.pending?.source === source && this.pending.sessionId === sessionId)
      return { ok: true as const, generation: this.pending.generation, snapshot: this.snapshot() };
    if (this.active?.source === source && this.active.sessionId === sessionId)
      return { ok: true as const, generation: this.active.generation, alreadyActive: true, snapshot: this.snapshot() };
    const identity = { source, sessionId, generation: ++this.generation };
    this.pending = identity;
    return { ok: true as const, generation: identity.generation, snapshot: this.snapshot() };
  }

  commit(generation: number) {
    if (!this.pending || this.pending.generation !== generation)
      return { ok: false as const, stale: true, error: "STALE_ROUTE_COMMIT", snapshot: this.snapshot() };
    this.active = this.pending;
    this.pending = null;
    return { ok: true as const, snapshot: this.snapshot() };
  }

  abort(generation: number) {
    if (!this.pending || this.pending.generation !== generation)
      return { ok: false as const, stale: true, error: "STALE_ROUTE_ABORT", snapshot: this.snapshot() };
    this.pending = null;
    return { ok: true as const, snapshot: this.snapshot() };
  }

  owns(source: AudioRouteSource, sessionId: string) {
    return this.active?.source === source && this.active.sessionId === sessionId;
  }

  release(source: AudioRouteSource, sessionId: string) {
    if (!this.owns(source, sessionId))
      return { ok: false as const, stale: true, error: "STALE_ROUTE_RELEASE", snapshot: this.snapshot() };
    this.active = null;
    this.generation++;
    return { ok: true as const, snapshot: this.snapshot() };
  }

  snapshot(): AudioRouteSnapshot {
    return {
      generation: this.generation,
      phase: this.pending ? "preparing" : this.active ? "active" : "idle",
      active: this.active ? { ...this.active } : null,
      pending: this.pending ? { ...this.pending } : null
    };
  }
}
