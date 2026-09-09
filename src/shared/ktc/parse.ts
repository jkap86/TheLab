import type { KtcHistoryPoint, KtcPlayer, KtcSeriesPoint } from "./types.ts";

/**
 * Parsers for the JSON literals KeepTradeCut embeds in its pages.
 *
 * Deliberately free of network and database imports: these are the pieces most
 * likely to break (KTC can change its markup whenever it likes), so they are
 * kept pure and directly testable against saved HTML. `client.ts` does the
 * fetching and hands the HTML here.
 *
 * Ported whole from TheLabX. The reference sync in thelabbackground2026 does
 * this with a lazy regex (`/\[[\s\S]*?\]/`), which stops at the first `]` — one
 * bracket inside a player name away from parsing a fragment, silently.
 */

/** Coerce a scraped value to a whole number, or null if it isn't finite. */
export const int = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? Math.trunc(v) : null;

const CLOSING: Record<string, string> = { "[": "]", "{": "}" };

/**
 * Index of the bracket closing the one at `start`, or -1 if it never closes.
 * Brackets inside string literals are skipped. The embedded literals are plain
 * JSON but the pages run to megabytes, so walking beats a (backtracking-prone)
 * regex.
 */
function matchBracket(html: string, start: number): number {
  const open = html[start];
  const close = CLOSING[open];
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < html.length; i++) {
    const c = html[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === open) depth++;
    else if (c === close) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/**
 * How far past `var <name>` to look for the `getElementById` naming its island.
 * The call sits on the same line as the assignment; 200 characters is room for
 * that line and no room to wander into the next statement.
 */
const ISLAND_LOOKAHEAD = 200;

/** The id of the island `var <name> = JSON.parse(getElementById(…))` points at. */
function islandId(html: string, assign: number): string | null {
  const call = html.slice(assign, assign + ISLAND_LOOKAHEAD);
  return /getElementById\(\s*['"]([^'"]+)['"]\s*\)/.exec(call)?.[1] ?? null;
}

/**
 * The literal inside `<script … id="…">…</script>`, or null where no such
 * element exists. Located by the id attribute rather than by a tag pattern,
 * since the two islands this reads spell their attributes in opposite orders,
 * and closed by {@link matchBracket} rather than by the next `</script>` —
 * same argument as everywhere else here, and it costs nothing to keep one rule.
 */
function islandLiteral(html: string, id: string, open: "[" | "{"): string | null {
  const attr = html.indexOf(`id="${id}"`);
  if (attr === -1) return null;
  const tagEnd = html.indexOf(">", attr);
  if (tagEnd === -1) return null;
  const start = html.indexOf(open, tagEnd);
  if (start === -1) return null;
  const end = matchBracket(html, start);
  if (end === -1) throw new Error(`KTC: unterminated \`#${id}\` island`);
  return html.slice(start, end + 1);
}

/**
 * The literal `var <name>` holds, from wherever the page now keeps it.
 *
 * **KTC moved its data out of the assignment and into a JSON island**, which is
 * the change this exists to absorb. A board page carried
 * `var playersArray = [ … ];` inline; it now carries
 *
 * ```
 * <script type="application/json" id="ktc-players">[ … ]</script>
 * …
 * var playersArray = JSON.parse(document.getElementById('ktc-players').textContent);
 * ```
 *
 * and the island sits *before* the assignment — right after `<body>`, where the
 * old literal was two megabytes further down — so a forward scan from the
 * variable's name never reaches it. What that scan reaches instead is the next
 * `[` in the file, which on the live dynasty page is `var oneQBPlayers`, a
 * three-entry featured list. **That is the failure this is written against and
 * it is the quiet kind**: a syntactically perfect array of the wrong thing,
 * caught only because `validateKtcBoard` refused to reconcile a 500-player
 * board down to three. Player pages moved the same way, to `#pd-superflex`,
 * `#pd-oneqb` and `#pd-players`.
 *
 * The island is resolved **through the indirection the page itself declares** —
 * the id is read out of the `getElementById` call rather than spelled here — so
 * a renamed island needs no edit, and neither does a fourth one.
 *
 * The inline form is still read where it is genuinely present, so a revert
 * needs no edit either. **What the fallback now requires is that the bracket
 * belong to the assignment**: only `=` and whitespace may sit between the two,
 * because "the next `[` anywhere in the file" is exactly how a moved literal
 * came back as another variable's value. Absent is the honest answer there, and
 * an absent board is refused loudly one layer up where a wrong one was not.
 */
function varLiteral(html: string, name: string, open: "[" | "{"): string | null {
  const assign = html.indexOf(`var ${name}`);
  if (assign === -1) return null;

  const id = islandId(html, assign);
  if (id !== null) return islandLiteral(html, id, open);

  const start = html.indexOf(open, assign);
  if (start === -1) return null;
  if (!/^\s*=\s*$/.test(html.slice(assign + `var ${name}`.length, start))) {
    return null;
  }
  const end = matchBracket(html, start);
  if (end === -1) throw new Error(`KTC: unterminated \`${name}\` literal`);
  return html.slice(start, end + 1);
}

/** Parse the literal `var <name>` holds — island or inline — or null if absent. */
function extractVar<T>(html: string, name: string, open: "[" | "{"): T | null {
  const literal = varLiteral(html, name, open);
  return literal === null ? null : (JSON.parse(literal) as T);
}

/** Extract and parse the `playersArray` board from a KTC rankings page. */
export function extractPlayersArray(html: string): KtcPlayer[] {
  if (html.indexOf("var playersArray") === -1) {
    throw new Error("KTC: `playersArray` not found in page");
  }
  const literal = varLiteral(html, "playersArray", "[");
  if (literal === null) {
    throw new Error("KTC: could not reach the `playersArray` literal or island");
  }

  const parsed = JSON.parse(literal) as KtcPlayer[];
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error("KTC: parsed `playersArray` was empty");
  }
  return parsed;
}

/** The `{ d, v }` series a player page carries for one scoring format. */
type PlayerFormat = {
  overallValue?: KtcSeriesPoint[];
  overallRankHistory?: KtcSeriesPoint[];
  positionalRankHistory?: KtcSeriesPoint[];
};

/** `"260723"` -> `"2026-07-23"`; null for anything not a 6-digit date. */
function seriesDate(d: unknown): string | null {
  if (typeof d !== "string" || !/^\d{6}$/.test(d)) return null;
  return `20${d.slice(0, 2)}-${d.slice(2, 4)}-${d.slice(4, 6)}`;
}

/** Index a `{ d, v }` series by ISO date, dropping malformed points. */
function byDate(series: KtcSeriesPoint[] | undefined): Map<string, number | null> {
  const out = new Map<string, number | null>();
  for (const point of series ?? []) {
    const date = seriesDate(point?.d);
    if (!date) continue;
    out.set(date, int(point.v));
  }
  return out;
}

/**
 * Parse a player page's full value/rank history into one row per day.
 *
 * A player page embeds two independent board objects — `playerSuperflex` and
 * `playerOneQB` — each with parallel `{ d, v }` series for value, overall rank
 * and positional rank. They usually cover the same dates but not always (a
 * player can enter one board before the other), so the series are merged on
 * date and missing sides stay null. Rookie draft picks carry no positional rank
 * series at all.
 *
 * Values are the base series, matching the non-TE-premium numbers stored in
 * `ktc_values`; the page's `tep`/`tepp`/`teppp` blocks carry no history at all
 * (checked live: they hold only adjacent-player data), which is the argument
 * for storing the base value everywhere — it is the one number the daily row
 * and the backfilled series can agree on.
 */
export function extractPlayerHistory(html: string): KtcHistoryPoint[] {
  const sf = extractVar<PlayerFormat>(html, "playerSuperflex", "{");
  const oneQB = extractVar<PlayerFormat>(html, "playerOneQB", "{");
  if (!sf && !oneQB) {
    throw new Error("KTC: no `playerSuperflex`/`playerOneQB` found in page");
  }

  const sfValue = byDate(sf?.overallValue);
  const sfRank = byDate(sf?.overallRankHistory);
  const sfPositionRank = byDate(sf?.positionalRankHistory);
  const oneqbValue = byDate(oneQB?.overallValue);
  const oneqbRank = byDate(oneQB?.overallRankHistory);
  const oneqbPositionRank = byDate(oneQB?.positionalRankHistory);

  const dates = new Set([...sfValue.keys(), ...oneqbValue.keys()]);

  return [...dates].sort().map((date) => ({
    date,
    sfValue: sfValue.get(date) ?? null,
    sfRank: sfRank.get(date) ?? null,
    sfPositionRank: sfPositionRank.get(date) ?? null,
    oneqbValue: oneqbValue.get(date) ?? null,
    oneqbRank: oneqbRank.get(date) ?? null,
    oneqbPositionRank: oneqbPositionRank.get(date) ?? null,
  }));
}
