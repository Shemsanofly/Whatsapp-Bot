import { SenderRateLimiter } from '../../../src/security/SenderRateLimiter.js';

describe('SenderRateLimiter', () => {
  it('allows up to the limit per window, then notifies once', () => {
    let now = 0;
    const limiter = new SenderRateLimiter(2, 60_000, () => now);

    expect(limiter.check('a')).toBe('allowed');
    expect(limiter.check('a')).toBe('allowed');
    expect(limiter.check('a')).toBe('limited');
    expect(limiter.check('a')).toBe('limited-notified');
    expect(limiter.check('b')).toBe('allowed');

    now = 60_001;
    expect(limiter.check('a')).toBe('allowed');
  });

  it('is disabled when the limit is zero', () => {
    const limiter = new SenderRateLimiter(0);

    for (let index = 0; index < 100; index += 1) {
      expect(limiter.check('a')).toBe('allowed');
    }
  });
});
