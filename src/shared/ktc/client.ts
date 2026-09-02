import { http } from "@/shared/http";

import { extractPlayerHistory, extractPlayersArray } from "./parse";
import type { KtcFormat, KtcHistoryPoint, KtcPlayer } from "./types";

/**
 * KTC's two public boards, each embedding `var playersArray = [ ... ];`.
 *
 * Bare URLs, deliberately: the `page`, `filters` and `format` query params the
 * reference sync carries are display-only — checked live, `?page=1` and
 * `?filters=QB` return the same full array — and each entry already carries
 * *both* `superflexValues` and `oneQBValues`, so one request per format is the
 * whole current-values fetch.
 */
export const KTC_BOARDS: Record<KtcFormat, string> = {
  dynasty: "https://keeptradecut.com/dynasty-rankings",
  redraft: "https://keeptradecut.com/fantasy-rankings",
};

/** Per-player page; embeds `var playerSuperflex`/`playerOneQB` with history. */
export const ktcPlayerUrl = (format: KtcFormat, slug: string): string =>
  `${KTC_BOARDS[format]}/players/${encodeURIComponent(slug)}`;

/**
 * KTC has served bot-default clients a page without the embedded data, so every
 * request pretends to be a browser. Not required as of this port — a bare
 * request still gets the array — but the header costs nothing and the outage it
 * prevents is silent (the parser would just find no marker).
 */
const BROWSER_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/120.0 Safari/537.36",
  Accept: "text/html",
};

/**
 * Scrape one board's rankings page and return the parsed entry array — ~500
 * for dynasty (players plus rookie picks), ~370 for redraft. Parsing lives in
 * `./parse`.
 */
export async function fetchKtcRankings(format: KtcFormat): Promise<KtcPlayer[]> {
  const { data } = await http.get<string>(KTC_BOARDS[format], {
    responseType: "text",
    headers: BROWSER_HEADERS,
  });
  return extractPlayersArray(data);
}

/**
 * Scrape one player's page and return their full daily history for this
 * format's two boards. These pages are large (~3.5MB — they inline the whole
 * rankings board alongside the series), which is why the backfill paces itself.
 * A slug names a page only within its own format: the id it embeds is
 * per-board, so a dynasty slug on the redraft host is a 404, not a redirect.
 */
export async function fetchKtcPlayerHistory(
  format: KtcFormat,
  slug: string,
): Promise<KtcHistoryPoint[]> {
  const { data } = await http.get<string>(ktcPlayerUrl(format, slug), {
    responseType: "text",
    headers: BROWSER_HEADERS,
  });
  return extractPlayerHistory(data);
}
