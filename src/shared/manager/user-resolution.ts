/**
 * Deciding *whether* a manager has to be resolved through Sleeper at all, and
 * remembering the answer when they do.
 *
 * **A manager page is one username and five reads, and it used to be five
 * lookups.** Every route under `/api/user/[username]` opened by asking Sleeper
 * who that name is — and four of the six are pure Postgres reads that need
 * nothing from Sleeper but the id. So loading the leagues tab spent four
 * upstream requests re-answering a question the leagues response had already
 * answered, on every navigation between tabs, for every reader. The fix is that
 * the leagues route resolves the manager *once* and its payload carries the
 * canonical `user_id`, which the dependent reads then send back as a hint.
 *
 * Pure, with no runtime imports at all: the lookup and the clock are arguments,
 * so the policy is testable without a network or a database — the same split
 * `internal-auth/policy` keeps from the `NextResponse` half beside it.
 *
 * **A hinted id is not authorization.** These are public, statistical reads over
 * a manager's own leagues, so what an id can buy an attacker is a public answer
 * about a different public account. What it must not buy is a way to put
 * arbitrary text into a query, which is why the shape below is checked before it
 * is used and why every id still arrives at Postgres as a bound parameter.
 */

/** The Sleeper user fields this policy touches — the client's own type, erased. */
export type SleeperUserLike = {
  user_id: string;
  username: string;
  display_name: string;
  avatar: string | null;
};

/** How a username (or id) becomes a user. Injected so tests can count calls. */
export type ManagerLookup = (
  usernameOrId: string,
) => Promise<SleeperUserLike | null>;

/**
 * How long an id may be. Sleeper's are ~18-digit snowflakes today and were
 * shorter once; the bound is about refusing something unbounded, not about
 * predicting their format.
 */
const MAX_USER_ID_LENGTH = 32;

/**
 * Whether a value is shaped like a Sleeper user id.
 *
 * Digits only, which is what Sleeper issues. Deliberately *narrower* than the
 * username rules: a username can be anything, so accepting the same shape here
 * would make "is this a hinted id" unanswerable and let a name be passed off as
 * one. Where the shape fails, the caller resolves the name properly — the hint
 * is an optimisation, never a requirement.
 */
export function isSleeperUserId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_USER_ID_LENGTH &&
    /^[0-9]+$/.test(value)
  );
}

/** A resolved manager, or a normalized failure with the HTTP status to return. */
export type ResolvedManagerId =
  | {
      ok: true;
      userId: string;
      /**
       * The Sleeper user, where one had to be fetched — null when the id came
       * from the caller, which is exactly when nothing needed it. A route that
       * *does* need the profile (an avatar, a canonical username) must resolve
       * rather than hint; see `resolveManagerUser`.
       */
      user: SleeperUserLike | null;
    }
  | { ok: false; status: 400 | 404 | 502; error: string };

/**
 * Resolve a manager to the id the Postgres-backed reads are keyed on.
 *
 * A valid `hintedId` short-circuits the whole thing: no Sleeper request, no
 * profile, just the id. Anything else — a blank hint, a hint that isn't
 * id-shaped, a client that sent none — falls through to the lookup, so direct
 * navigation to `/api/user/<name>/ranks` keeps working exactly as it did and an
 * unknown manager still 404s.
 */
export async function resolveManagerId(
  username: string,
  hintedId: unknown,
  lookup: ManagerLookup,
): Promise<ResolvedManagerId> {
  if (isSleeperUserId(hintedId)) {
    return { ok: true, userId: hintedId, user: null };
  }
  if (!username?.trim()) {
    return { ok: false, status: 400, error: "Username is required" };
  }

  let user: SleeperUserLike | null;
  try {
    user = await lookup(username);
  } catch {
    return { ok: false, status: 502, error: "Failed to reach Sleeper" };
  }
  if (!user) return { ok: false, status: 404, error: "User not found" };
  return { ok: true, userId: user.user_id, user };
}

/** What {@link memoizeManagerLookup} takes, so a test can drive its clock. */
export type MemoOptions = {
  ttlMs?: number;
  max?: number;
  now?: () => number;
};

/**
 * How long a username → user answer is reused.
 *
 * Short on purpose: this is defence in depth behind the hint above, not the
 * mechanism. What it covers is the traffic the hint cannot — a cold page load,
 * a reader who navigates straight to a manager URL, several tabs opening at
 * once — where the same name would otherwise be asked for once per request. A
 * minute is long enough to collapse a page load's burst and short enough that a
 * renamed account is never stale for anything a person would notice.
 */
export const MANAGER_LOOKUP_TTL_MS = 60 * 1000;

/** Bounded, so a process asked about a decade of names doesn't hold them all. */
const MANAGER_LOOKUP_MAX = 2000;

/**
 * Wrap a lookup so identical names inside the TTL cost one upstream request.
 *
 * Three details are load-bearing:
 *
 * - **The in-flight promise is what is cached, not the result.** Two requests
 *   arriving in the same millisecond are the case worth collapsing, and a cache
 *   that only remembers settled answers collapses neither of them.
 * - **A rejection is not remembered.** A failed lookup is a 502 the caller
 *   should be able to retry immediately, so the entry is dropped as it fails —
 *   the same rule `shared/season` follows for a failed state read.
 * - **A `null` is remembered.** "No such user" is a real answer, and it is the
 *   one an abusive caller can produce endlessly with made-up names; caching it
 *   is what keeps that from being one Sleeper request per attempt.
 */
export function memoizeManagerLookup(
  lookup: ManagerLookup,
  options: MemoOptions = {},
): ManagerLookup & { clear: () => void } {
  const {
    ttlMs = MANAGER_LOOKUP_TTL_MS,
    max = MANAGER_LOOKUP_MAX,
    now = Date.now,
  } = options;
  const entries = new Map<
    string,
    { at: number; value: Promise<SleeperUserLike | null> }
  >();

  const memoized = (usernameOrId: string): Promise<SleeperUserLike | null> => {
    // Sleeper resolves `Jkap` and `jkap` to one account, so two entries for one
    // manager is exactly the duplicate request this exists to remove — the same
    // lower-casing the client's own query keys do.
    const key = usernameOrId.toLowerCase();
    const hit = entries.get(key);
    if (hit && now() - hit.at < ttlMs) return hit.value;

    const value = lookup(usernameOrId);
    entries.set(key, { at: now(), value });
    // A rejected lookup must not be served to the next caller as this one's
    // failure; dropping it here is what makes a 502 immediately retryable.
    void value.catch(() => {
      if (entries.get(key)?.value === value) entries.delete(key);
    });

    if (entries.size > max) {
      // Insertion-ordered, so the first key is the oldest — one eviction per
      // insertion past the bound keeps this O(1) without a second structure.
      const oldest = entries.keys().next();
      if (!oldest.done) entries.delete(oldest.value);
    }
    return value;
  };

  memoized.clear = () => entries.clear();
  return memoized;
}
