import http from "@thelab/http";

import type { KtcPlayer } from "./types";

/** Public dynasty rankings page; embeds `var playersArray = [ ... ];`. */
export const KTC_RANKINGS_URL = "https://keeptradecut.com/dynasty-rankings";

/**
 * Extract and parse the `playersArray` literal embedded in a KTC rankings page.
 *
 * The array is a plain JSON literal assigned to a `var`, but the page is ~1.3MB,
 * so instead of a (backtracking-prone) regex we find the `[` that opens the
 * assignment and walk brackets to its match, skipping any inside string
 * literals. Exported so the parser can be tested against saved HTML without a
 * network call.
 */
export function extractPlayersArray(html: string): KtcPlayer[] {
  const assign = html.indexOf("playersArray");
  if (assign === -1) throw new Error("KTC: `playersArray` not found in page");
  const start = html.indexOf("[", assign);
  if (start === -1) throw new Error("KTC: `[` not found after `playersArray`");

  let depth = 0;
  let inString = false;
  let escaped = false;
  let end = -1;
  for (let i = start; i < html.length; i++) {
    const c = html[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === "[") depth++;
    else if (c === "]") {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  if (end === -1) throw new Error("KTC: unterminated `playersArray` literal");

  const parsed = JSON.parse(html.slice(start, end + 1)) as KtcPlayer[];
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error("KTC: parsed `playersArray` was empty");
  }
  return parsed;
}

/**
 * Scrape the KTC dynasty rankings page and return the parsed player/pick array
 * (~500 entries). Sends a browser-like User-Agent because KTC serves bot-default
 * clients a page without the embedded array.
 */
export async function fetchKtcDynastyRankings(): Promise<KtcPlayer[]> {
  const { data } = await http.get<string>(KTC_RANKINGS_URL, {
    responseType: "text",
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
        "(KHTML, like Gecko) Chrome/120.0 Safari/537.36",
      Accept: "text/html",
    },
  });
  return extractPlayersArray(data);
}
