/**
 * Narrowing a list of named things by what a reader typed — the one ranking rule
 * every name field in the manager tool uses.
 *
 * It is its own module because two doors onto the same names now read it: the
 * rail's search panel over {@link SubjectOption}s, and the shares sheet's field
 * over {@link PlayerShare} rows. Those are different shapes carrying the same
 * kind of string, and a second copy of "prefix matches lead" is exactly the drift
 * `booleanFlag`/`booleanFilter` were split to stop — one of the copies gets a fix
 * and the other doesn't, and which door a reader came through changes what they
 * find.
 *
 * Pure, with no runtime imports at all, so both callers reach it with a relative
 * `.ts` import and the tests can run it directly.
 */

/**
 * The items whose name matches, best first, capped.
 *
 * Prefix matches lead, because someone typing "cha" means Chase before they mean
 * Christian McCaffrey — but a word-start match anywhere in the name counts as a
 * prefix, or a surname would be unreachable without the first name. Everything
 * else that contains the query follows in the input's own order, which every
 * caller has already sorted the way its list is read (most-held first).
 *
 * An empty query is a real state rather than an error: both doors open with
 * nothing typed and should show the head of the list. `limit` is what keeps that
 * from rendering several hundred rows into a floating panel — pass `Infinity`
 * where the whole list is the point, as the sheet does.
 */
export function rankByName<T>(
  items: readonly T[],
  name: (item: T) => string,
  query: string,
  limit: number,
): T[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return items.slice(0, limit);

  const leading: T[] = [];
  const rest: T[] = [];
  for (const item of items) {
    const haystack = name(item).toLowerCase();
    const at = haystack.indexOf(needle);
    if (at < 0) continue;
    // Start of the name, or the start of any word in it.
    if (at === 0 || haystack[at - 1] === " " || haystack[at - 1] === ".") {
      leading.push(item);
    } else {
      rest.push(item);
    }
    // Only the leading bucket can short-circuit: a full page of prefix matches
    // is the answer, where a full page of mid-name ones might still be beaten.
    if (leading.length >= limit) break;
  }
  return [...leading, ...rest].slice(0, limit);
}
