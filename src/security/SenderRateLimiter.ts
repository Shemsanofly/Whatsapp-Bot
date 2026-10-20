export type RateLimitResult = 'allowed' | 'limited' | 'limited-notified';

/**
 * Sliding-window limiter keyed by sender. The first rejected message in a window
 * returns 'limited' so the caller can warn the sender once; later ones return
 * 'limited-notified' so the caller can stay silent.
 */
export class SenderRateLimiter {
  private readonly hits = new Map<string, number[]>();
  private readonly notified = new Set<string>();

  constructor(
    private readonly maxPerWindow: number,
    private readonly windowMs = 60_000,
    private readonly now: () => number = Date.now
  ) {}

  check(senderId: string): RateLimitResult {
    if (this.maxPerWindow <= 0) {
      return 'allowed';
    }

    const now = this.now();
    const recent = (this.hits.get(senderId) ?? []).filter((hitAt) => now - hitAt < this.windowMs);
    if (recent.length < this.maxPerWindow) {
      recent.push(now);
      this.hits.set(senderId, recent);
      this.notified.delete(senderId);
      return 'allowed';
    }

    this.hits.set(senderId, recent);
    if (this.notified.has(senderId)) {
      return 'limited-notified';
    }
    this.notified.add(senderId);
    return 'limited';
  }
}
