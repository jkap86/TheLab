import type { KtcHistoryPoint, KtcPlayer, KtcSeriesPoint } from "./types";

/**
 * Parsers for the JSON literals KeepTradeCut embeds in its pages.
 *
 * Deliberately free of network and database imports: these are the pieces most
 * likely to break (KTC can change its markup whenever it likes), so they are
 * kept pure and directly testable against saved HTML. `client.ts` does the
 * fetching and hands the HTML here.
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

/** Parse the literal assigned to `var <name> = <open>…;`, or null if absent. */
function extractVar<T>(html: string, name: string, open: "[" | "{"): T | null {
  const assign = html.indexOf(`var ${name}`);
  if (assign === -1) return null;
  const start = html.indexOf(open, assign);
  if (start === -1) return null;
  const end = matchBracket(html, start);
  if (end === -1) throw new Error(`KTC: unterminated \`${name}\` literal`);
  return JSON.parse(html.slice(start, end + 1)) as T;
}

/** Extract and parse the `playersArray` literal from a KTC rankings page. */
export function extractPlayersArray(html: string): KtcPlayer[] {
  const assign = html.indexOf("playersArray");
  if (assign === -1) throw new Error("KTC: `playersArray` not found in page");
  const start = html.indexOf("[", assign);
  if (start === -1) throw new Error("KTC: `[` not found after `playersArray`");
  const end = matchBracket(html, start);
  if (end === -1) throw new Error("KTC: unterminated `playersArray` literal");

  const parsed = JSON.parse(html.slice(start, end + 1)) as KtcPlayer[];
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
 * A player page embeds two independent format objects — `playerSuperflex` and
 * `playerOneQB` — each with parallel `{ d, v }` series for value, overall rank
 * and positional rank. They usually cover the same dates but not always (a
 * player can enter one board before the other), so the series are merged on
 * date and missing sides stay null. Rookie draft picks carry no positional rank
 * series at all.
 *
 * Values are the base series, matching the non-TE-premium numbers stored in
 * `ktc_values`; the page's `tep`/`tepp`/`teppp` blocks hold premium variants we
 * don't track.
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
