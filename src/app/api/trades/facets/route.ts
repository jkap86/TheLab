import { NextResponse } from "next/server";

import type { LeaguematePayload, TradeFacetsPayload } from "@/shared/contract";
import { isSeason } from "@/shared/query";
import { getActiveSeason } from "@/shared/season";
import { sleeperAvatarUrl } from "@/shared/sleeper";
import {
  getTradeFacets,
  getTradeManagers,
  lookupPlayers,
  parseTradeQuery,
} from "@/shared/trades";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The trade filter dialog's menus — see {@link TradeFacetsPayload}.
 *
 * **This route exists so the menus could stay what they were.** They are read
 * off the trades ("who can I filter by" has no honest answer but "whoever
 * traded"), which was free while the browser held the season and had to become
 * something when it stopped. A grouped aggregate over the same population is
 * that something: the option lists are identical, the counts are identical, and
 * the season no longer has to be in a browser for them to exist.
 *
 * Two things keep it affordable:
 *
 * - **It is only asked for while the dialog is open.** A reader who never opens
 *   it never pays, which is most readers on most visits — and that is what makes
 *   the dialog's dynamic import (it is lazy-loaded too) pay off twice.
 * - **The selection's own total is not computed here.** These counts cannot
 *   change when a checkbox is pressed — they are taken without the selection on
 *   purpose — so pairing them with the footer's number, which changes on every
 *   press, made a checkbox cost this whole aggregate. `/api/trades/count` is
 *   that number, and it is a `count(*)`.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const requested = url.searchParams.get("season");
  const season =
    requested && isSeason(requested) ? requested : await getActiveSeason();

  // The selection is lifted out whatever the caller sent, which is what keeps a
  // menu from collapsing to its own selection the moment one is made.
  const query = parseTradeQuery(url.searchParams, season);

  try {
    const facets = await getTradeFacets({
      ...query,
      players: [],
      picks: [],
      managers: [],
    });

    // Only the ids the menus will actually show need names. Picks need none —
    // their label is a pure formatting of the token beside it, and the client
    // owns that function already.
    const [players, managers] = await Promise.all([
      lookupPlayers(facets.players.map((f) => f.value)),
      getTradeManagers(facets.managers.map((f) => f.value)),
    ]);

    const resolvedManagers: Record<string, LeaguematePayload> = {};
    for (const [id, m] of managers) {
      resolvedManagers[id] = {
        user_id: id,
        display_name: m.display_name,
        avatar_url: sleeperAvatarUrl(m.avatar, "thumb"),
      };
    }

    const payload: TradeFacetsPayload = {
      season,
      managers: facets.managers,
      players: facets.players,
      picks: facets.picks,
      names: {
        players: Object.fromEntries(players),
        managers: resolvedManagers,
      },
    };

    return NextResponse.json(payload, {
      headers: { "Cache-Control": "private, max-age=60" },
    });
  } catch (error) {
    console.error("[trades] facets failed:", error);
    return NextResponse.json(
      { error: "Failed to load filter options" },
      { status: 500 },
    );
  }
}
