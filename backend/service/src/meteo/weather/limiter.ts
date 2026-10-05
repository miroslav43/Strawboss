/**
 * Tiny counting semaphore with abortable waits: the interactive lane's timeout
 * must cover the time a request spends queued, not just the HTTP call.
 */
export class Limiter {
  private active = 0;
  private readonly waiters: Array<() => void> = [];

  constructor(private readonly max: number) {}

  /** Rejects (and leaves the queue) when `signal` aborts while waiting. */
  async acquire(signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) throw signal.reason ?? new Error('aborted');
    if (this.active < this.max) {
      this.active++;
      return;
    }
    await new Promise<void>((resolve, reject) => {
      const grant = (): void => {
        signal?.removeEventListener('abort', onAbort);
        resolve();
      };
      const onAbort = (): void => {
        const i = this.waiters.indexOf(grant);
        if (i >= 0) this.waiters.splice(i, 1);
        reject(signal?.reason ?? new Error('aborted'));
      };
      this.waiters.push(grant);
      signal?.addEventListener('abort', onAbort, { once: true });
    });
  }

  release(): void {
    const next = this.waiters.shift();
    if (next) next(); // slot handed straight to the next waiter
    else this.active--;
  }
}
