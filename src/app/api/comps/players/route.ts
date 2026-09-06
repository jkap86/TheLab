import { NextResponse } from "next/server";

import type { ApiErrorPayload, CompPlayersPayload } from "@/shared/contract";
import { getKtcBoards } from "@/shared/ktc";
import { ktcBoardValue } from "@/shared/ktc/roster";
import { corpusBounds, getCompCorpus, toCompSubject } from "@/shared/player-seasons";
import type { CompCorpus } from "@/shared/player-seasons";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Every subject the comps page can run, and the corpus's own bounds.
 *
 * A separate route rather than a field on the comps answer, on the trades
 * board's line: it is asked for **once** where the comps are asked for on
 * every rail move, and it is the population the search narrows in the
 * browser — a dozen subjects today, a few hundred once the corpus is loaded,
 * and either is a list a search field filters without a round trip.
 *
 * **The KTC figure is the subject's today, and it is the one thing here that
 * is not the corpus's.** It reads the dynasty board's 1QB column, which is
 * the cross-league rule `resolveKtcCrossLeagueFormat` argues: there is no
 * league on this page for `auto` to resolve against. A board that cannot be
 * read costs the plate its figure and nothing else. The sample corpus carries
 * its own prices, since its ids are not Sleeper's.
 */
export async function GET() {
  let corpus: CompCorpus;
  try {
    corpus = await getCompCorpus();
  } catch (error) {
    console.error("[comps] corpus read failed:", error);
    const payload: ApiErrorPayload = { error: "Failed to load the comps corpus" };
    return NextResponse.json(payload, { status: 500 });
  }

  const priced = await priceSubjects(corpus);

  const payload: CompPlayersPayload = {
    source: corpus.source,
    subject_season: corpus.subject_season,
    corpus: corpusBounds(corpus),
    ktc_updated_at: priced.updated_at,
    players: corpus.subjects.map((s) =>
      toCompSubject(
        corpus.source === "stored" ? { ...s, ktc: priced.values(s.player_id) } : s,
        corpus.subject_season,
      ),
    ),
  };

  return NextResponse.json(payload, {
    headers: {
      // The list moves when the corpus is loaded and when KTC is scraped, the
      // slower of which is a year; the shorter of the two caches is the bound.
      "Cache-Control": "private, max-age=300",
    },
  });
}

/**
 * A stored subject's price off the dynasty board, or null throughout where
 * the board could not be read. The sample corpus is not priced here at all —
 * its ids are slugs, and a lookup that missed on every one of them would be
 * indistinguishable from a board that answered nothing.
 */
async function priceSubjects(corpus: CompCorpus): Promise<{
  values: (playerId: string) => number | null;
  updated_at: string | null;
}> {
  if (corpus.source !== "stored") return { values: () => null, updated_at: null };
  try {
    const boards = await getKtcBoards("dynasty");
    return {
      values: (playerId) => ktcBoardValue(false, boards.values[playerId]),
      updated_at: boards.updated_at,
    };
  } catch (error) {
    console.warn("[comps] KTC board unavailable:", error);
    return { values: () => null, updated_at: null };
  }
}
