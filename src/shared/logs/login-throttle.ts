/**
 * How many wrong credentials one key may present before it is refused for a
 * while — the brute-force control in front of the visit log's sign-in.
 *
 * **Two keys are asked per attempt, and the second is the reason the first is
 * not enough.** A per-address key is what stops one client from guessing at
 * line rate, and it is bypassed by guessing from many addresses; a global key
 * is what bounds the *total* rate at which the credential can be guessed
 * however many addresses are used. The global key is a self-inflicted refusal
 * on an operator who happens to sign in during a spray, so its lock is short
 * and its budget is wide; the per-address lock is the one that bites.
 *
 * **Per process.** This map lives in one dyno's memory, so on a deployment
 * with several web dynos each guesses against its own budget. That multiplies
 * the attacker's rate by the dyno count and no more; the real protection is
 * the credential's entropy, which is why `logsConfig` warns about a short one.
 *
 * A fixed window rather than a sliding one: a sliding window would have to
 * hold a timestamp per failure, and the difference between the two is a
 * factor of two in the worst case on a budget that is already conservative.
 */

export type LoginThrottleConfig = {
  /** Failures allowed inside one window before the key is locked. */
  maxFailures: number;
  /** The window the failures are counted over. */
  windowMs: number;
  /** How long a locked key is refused. */
  lockMs: number;
  /** The most keys held; the oldest is dropped past it. */
  maxKeys: number;
};

export const PER_CLIENT_LOGIN_THROTTLE: LoginThrottleConfig = {
  maxFailures: 5,
  windowMs: 15 * 60_000,
  lockMs: 15 * 60_000,
  maxKeys: 10_000,
};

export const GLOBAL_LOGIN_THROTTLE: LoginThrottleConfig = {
  maxFailures: 60,
  windowMs: 15 * 60_000,
  lockMs: 60_000,
  maxKeys: 1,
};

export type ThrottleCheck = { ok: true } | { ok: false; retryAfterSeconds: number };

type Bucket = { windowStart: number; failures: number; lockedUntil: number };

export type LoginThrottle = {
  /** Whether `key` may attempt now. */
  check(key: string, now: number): ThrottleCheck;
  /** Record a wrong credential from `key`. */
  fail(key: string, now: number): void;
  /** A right credential clears the key's count. */
  succeed(key: string): void;
  /** Keys held — for a test. */
  size(): number;
};

export function createLoginThrottle(config: LoginThrottleConfig): LoginThrottle {
  const buckets = new Map<string, Bucket>();

  const bucket = (key: string, now: number): Bucket => {
    let b = buckets.get(key);
    if (b && now - b.windowStart >= config.windowMs && now >= b.lockedUntil) {
      buckets.delete(key);
      b = undefined;
    }
    if (!b) {
      b = { windowStart: now, failures: 0, lockedUntil: 0 };
      buckets.set(key, b);
      if (buckets.size > config.maxKeys) {
        // Insertion order is oldest first; a key that is still locked and was
        // evicted here simply gets a fresh budget, which is the bounded map's
        // cost and is why the global key is its own one-entry throttle.
        const oldest = buckets.keys().next().value;
        if (oldest !== undefined) buckets.delete(oldest);
      }
    }
    return b;
  };

  return {
    check(key, now) {
      const b = buckets.get(key);
      if (!b) return { ok: true };
      if (now < b.lockedUntil) {
        return { ok: false, retryAfterSeconds: Math.max(1, Math.ceil((b.lockedUntil - now) / 1000)) };
      }
      return { ok: true };
    },
    fail(key, now) {
      const b = bucket(key, now);
      b.failures += 1;
      if (b.failures >= config.maxFailures) {
        b.lockedUntil = now + config.lockMs;
        b.failures = 0;
        b.windowStart = now;
      }
    },
    succeed(key) {
      buckets.delete(key);
    },
    size: () => buckets.size,
  };
}

/** The global key every attempt is also counted under. */
export const GLOBAL_LOGIN_KEY = "*";
