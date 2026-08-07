/**
 * Query-string parsing primitives shared by the route filter modules
 * (`manager/adp-filters`, `projections/filters`).
 *
 * Pure like its consumers, and imported by them relatively with an explicit
 * `.ts` extension — they are tested with Node's runner, which resolves neither
 * the `@/*` aliases nor a barrel's database imports, so this module must never
 * grow a runtime dependency. (These helpers used to be copied into each filter
 * module for that reason; the copies had already started to diverge.)
 *
 * Every helper returns an `ok`-discriminated result rather than throwing, so a
 * filter module can fail the request with a message naming the one bad key.
 */

type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

/**
 * Values for one key: repeated params and comma-separated lists are both
 * accepted (`?scoring=ppr&scoring=half_ppr` == `?scoring=ppr,half_ppr`), so
 * callers can use whichever their HTTP client makes easy. De-duplicated.
 */
export function list(params: URLSearchParams, key: string): string[] {
  const values = params
    .getAll(key)
    .flatMap((value) => value.split(","))
    .map((value) => value.trim())
    .filter(Boolean);
  return [...new Set(values)];
}

/** A list filter constrained to a fixed vocabulary. Absent → `fallback`. */
export function enumList<T extends string>(
  params: URLSearchParams,
  key: string,
  allowed: readonly T[],
  fallback: T[] | null,
): Parsed<T[] | null> {
  const values = list(params, key);
  if (values.length === 0) return { ok: true, value: fallback };

  const invalid = values.filter((v) => !(allowed as readonly string[]).includes(v));
  if (invalid.length > 0) {
    return {
      ok: false,
      error: `Invalid ${key}: ${invalid.join(", ")}. Expected one of ${allowed.join(", ")}.`,
    };
  }
  return { ok: true, value: values as T[] };
}

/**
 * On/off flag: absent → false. For a parameter that switches a feature on
 * (`?stats=1`). A filter that must tell "off" apart from "not filtering" wants
 * {@link booleanFilter} instead — the two absences mean different things.
 */
export function booleanFlag(
  params: URLSearchParams,
  key: string,
): Parsed<boolean> {
  const parsed = booleanFilter(params, key);
  if (!parsed.ok) return parsed;
  return { ok: true, value: parsed.value ?? false };
}

/**
 * Tri-state filter: absent → null, meaning "don't filter on this at all".
 * `?best_ball=false` narrows to the leagues without it; leaving the key off
 * narrows nothing, and only null can carry that difference.
 */
export function booleanFilter(
  params: URLSearchParams,
  key: string,
): Parsed<boolean | null> {
  const raw = params.get(key)?.trim().toLowerCase();
  if (!raw) return { ok: true, value: null };
  if (["1", "true", "yes"].includes(raw)) return { ok: true, value: true };
  if (["0", "false", "no"].includes(raw)) return { ok: true, value: false };
  return { ok: false, error: `Invalid ${key}: ${raw}. Expected true or false.` };
}

/** A bounded integer. Absent → `fallback`; out of bounds or fractional → error. */
export function integer(
  params: URLSearchParams,
  key: string,
  { min, max, fallback }: { min: number; max?: number; fallback: number | null },
): Parsed<number | null> {
  const raw = params.get(key)?.trim();
  if (!raw) return { ok: true, value: fallback };

  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || (max !== undefined && value > max)) {
    const bound = max === undefined ? `>= ${min}` : `${min}-${max}`;
    return { ok: false, error: `Invalid ${key}: ${raw}. Expected an integer ${bound}.` };
  }
  return { ok: true, value };
}

/** A Sleeper season string: a 4-digit year. */
export const isSeason = (value: string): boolean => /^\d{4}$/.test(value);

/**
 * A calendar date, `YYYY-MM-DD`. The shape check alone would pass `2026-02-31`,
 * and so would parsing it — V8 rolls an out-of-range day forward rather than
 * failing, turning that into March 3. So the parsed date is formatted back and
 * compared: only a real day survives the round trip.
 */
export const isIsoDate = (value: string): boolean => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const ms = Date.parse(`${value}T00:00:00Z`);
  return !Number.isNaN(ms) && new Date(ms).toISOString().startsWith(value);
};

/**
 * A `YYYY-MM-DD` bound. Absent → null, meaning "don't bound on this side" — a
 * range is two independent halves, so an open end has to be expressible.
 *
 * The date is returned as the string it came in as, not a timestamp: what a bare
 * date *means* is a zone question, and the caller (SQL, here) is what knows the
 * zone. Converting to epoch ms here would bake this process's zone into the
 * answer.
 */
export function isoDate(params: URLSearchParams, key: string): Parsed<string | null> {
  const raw = params.get(key)?.trim();
  if (!raw) return { ok: true, value: null };
  if (!isIsoDate(raw)) {
    return { ok: false, error: `Invalid ${key}: ${raw}. Expected a date as YYYY-MM-DD.` };
  }
  return { ok: true, value: raw };
}

/**
 * The ceiling on how many league ids one request body may carry.
 *
 * Not a tuning knob: it is the bound on how large a `= ANY($n)` a route will
 * build out of something a caller sent. The client only ever sends the *shorter*
 * of the include and exclude lists, so reaching this at all means a corpus of
 * 100k leagues in one season — far past anything real, and the honest failure
 * there is a truncated narrowing rather than an unbounded query.
 */
export const MAX_BODY_LEAGUE_IDS = 50_000;

/**
 * What a league id may look like before it is bound into a query.
 *
 * Sleeper's are digit strings; this is deliberately a little wider so a future
 * id shape doesn't silently empty a board, and deliberately bounded so a body
 * cannot carry megabyte-long "ids". Everything still arrives as a bound
 * parameter — this is about the *size* of what one request can ask for, not
 * about escaping.
 */
const LEAGUE_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * The two league-id lists a request body may carry, as `/api/trades` and
 * `/api/adp` both read them.
 *
 * **Both boards resolve their league rules in the browser and send the answer**,
 * and past `MAX_LEAGUE_IDS` that answer is too long for a request line — so it
 * arrives as JSON instead. The two routes share this parser rather than each
 * checking its own body, because the shape is JSON this app writes and this app
 * reads: there is no reason for them to disagree about it, and one parser is one
 * place the shape check, the dedupe and the cap are right.
 *
 * A list that isn't an array reads as absent (null, "no narrowing sent this
 * way") rather than as empty — an empty array is a real answer meaning "the
 * rules matched nothing", and collapsing the two would show a reader who asked
 * for no leagues every league there is.
 */
export type LeagueScopeBody = {
  leagues: string[] | null;
  excludeLeagues: string[] | null;
};

export const NO_LEAGUE_SCOPE_BODY: LeagueScopeBody = {
  leagues: null,
  excludeLeagues: null,
};

export function parseLeagueScopeBody(body: unknown): LeagueScopeBody {
  if (typeof body !== "object" || body === null) return NO_LEAGUE_SCOPE_BODY;
  const record = body as Record<string, unknown>;
  return {
    leagues: leagueIdList(record.leagues),
    excludeLeagues: leagueIdList(record.xleagues),
  };
}

/** One body id list: deduplicated, shape-checked and capped. */
function leagueIdList(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const out: string[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== "string" || !LEAGUE_ID_PATTERN.test(entry)) continue;
    if (seen.has(entry)) continue;
    seen.add(entry);
    out.push(entry);
    if (out.length >= MAX_BODY_LEAGUE_IDS) break;
  }
  return out;
}
