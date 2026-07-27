import http from "@thelab/http";

import { extractPlayerHistory, extractPlayersArray } from "./parse";
import type { KtcHistoryPoint, KtcPlayer } from "./types";

/** Public dynasty rankings page; embeds `var playersArray = [ ... ];`. */
export const KTC_RANKINGS_URL = "https://keeptradecut.com/dynasty-rankings";

/** Per-player page; embeds `var playerSuperflex`/`playerOneQB` with history. */
export const ktcPlayerUrl = (slug: string): string =>
  `${KTC_RANKINGS_URL}/players/${encodeURIComponent(slug)}`;

/**
 * KTC serves bot-default clients a page without the embedded data, so every
 * request pretends to be a browser.
 */
const BROWSER_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/120.0 Safari/537.36",
  Accept: "text/html",
};

/**
 * Scrape the KTC dynasty rankings page and return the parsed player/pick array
 * (~500 entries). Parsing lives in `./parse`.
 */
export async function fetchKtcDynastyRankings(): Promise<KtcPlayer[]> {
  const { data } = await http.get<string>(KTC_RANKINGS_URL, {
    responseType: "text",
    headers: BROWSER_HEADERS,
  });
  return extractPlayersArray(data);
}

/**
 * Scrape one player's page and return their full daily history. These pages are
 * large (3–6MB — they inline the whole rankings board alongside the series),
 * which is why the backfill fetches only a handful per tick.
 */
export async function fetchKtcPlayerHistory(
  slug: string,
): Promise<KtcHistoryPoint[]> {
  const { data } = await http.get<string>(ktcPlayerUrl(slug), {
    responseType: "text",
    headers: BROWSER_HEADERS,
  });
  return extractPlayerHistory(data);
}
