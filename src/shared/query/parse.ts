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
