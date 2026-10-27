/** Per-open-book daily backup policy. Failure dates never masquerade as success dates. */
export class BackupCoordinator {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private pending: Promise<boolean> | null = null;
  private day = '';
  private completed = '';
  private failures = 0;
  private retryAt = 0;
  private stopped = false;
  constructor(private clock = () => Date.now(), private quietMs = 2500) {}
  cancelScheduled(): void {
    this.stopped = true;
    clearTimeout(this.timer);
    this.timer = undefined;
  }
  resetAfterRestore(): void {
    this.cancelScheduled();
    this.completed = ''; this.failures = 0; this.retryAt = 0;
  }
  private checkDay(day: string) {
    if (this.day !== day) { this.day = day; this.failures = 0; this.retryAt = 0; }
  }
  schedule(day: string, savedDay: string | undefined, work: () => Promise<void>, onError: (error: unknown) => void): void {
    this.stopped = false;
    this.checkDay(day);
    if (this.pending || savedDay === day || this.completed === day) return;
    clearTimeout(this.timer);
    const delay = Math.max(this.quietMs, this.retryAt - this.clock());
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.attempt(day, work, onError, false).then(ok => {
        if (!ok && !this.stopped) this.schedule(day, undefined, work, onError);
      });
    }, delay);
  }
  attempt(day: string, work: () => Promise<void>, onError: (error: unknown) => void, force = true): Promise<boolean> {
    this.checkDay(day);
    if (this.pending) return this.pending;
    if (!force && (this.completed === day || this.clock() < this.retryAt)) return Promise.resolve(false);
    clearTimeout(this.timer);
    this.timer = undefined;
    this.pending = Promise.resolve().then(work).then(() => {
      this.completed = day;
      this.failures = 0;
      this.retryAt = 0;
      return true;
    }).catch((error: unknown) => {
      const backoff = [60_000, 300_000, 900_000];
      this.retryAt = this.clock() + backoff[Math.min(this.failures++, backoff.length - 1)];
      onError(error);
      return false;
    }).finally(() => { this.pending = null; });
    return this.pending;
  }
}
