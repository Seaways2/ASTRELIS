// Serialize source starts; a newer request invalidates queued older work.
export class PlaybackExclusion {
  private generation = 0;
  private tail: Promise<unknown> = Promise.resolve();
  cancel() { this.generation++; }
  run(valid: () => boolean, pauseOthers: () => Promise<void>, start: () => Promise<void>) {
    const generation = ++this.generation;
    const current = () => generation === this.generation && valid();
    const task = this.tail.catch(() => undefined).then(async () => {
      if (!current()) return;
      await pauseOthers();
      if (!current()) return;
      await start();
    });
    this.tail = task;
    return task;
  }
}
