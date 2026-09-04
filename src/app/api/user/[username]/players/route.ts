import { NextResponse } from "next/server";

import type {
  ApiErrorPayload,
  ManagerPlayersPayload,
  PlayerShareSummary,
} from "@/shared/contract";
import { getKtcBoards, ktcBoardValue } from "@/shared/ktc";
import {
  parseKtcBoardChoice,
  resolveKtcCrossLeagueFormat,
} from "@/shared/ktc/board-choice";
import { getManagerRosters } from "@/shared/manager";
import { getPlayerShareRows, toPlayerShareSummary } from "@/shared/players";
import { getActiveSeason, parseRequestedSeason } from "@/shared/season";
import { resolveManagerUser } from "@/shared/user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Every roster the manager holds this season, plus a name, an age, a draft
 * class and a price for every player on one — the player shares drawer's whole
 * input.
 *
 * **It ships membership and never a count.** A share is folded on the client,
 * because the manager page narrows its league list five ways and a share has to
 * be counted over the leagues left; a `GROUP BY` here would answer a different
 * question and could not be re-asked without a round trip per filter press. See
 * `ManagerPlayersPayload`.
 *
 * **Postgres only — it never reaches Sleeper for a roster.** The leagues stream
 * is the one thing that fills this data, and a drawer that could trigger a sync
 * would put an ~11-request-per-league fan-out behind a key press that reads as
 * a panel opening. A manager with nothing stored gets an empty map, which the
 * drawer says in words.
 *
 * **`?ktc_board=` carries the reader's market choice**, the same parameter the
 * lineups route takes and the same stored preference behind it. It resolves
 * differently here and that is the point: a shares row spans leagues, so there
 * is no league for `auto` to resolve against and the panel fixes one board —
 * see `resolveKtcCrossLeagueFormat`. An unreadable board degrades to `ktc: null`
 * and a column of em dashes rather than failing the panel; the drawer's other
 * columns have nothing to do with KTC.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ username: string }> },
) {
  const { username } = await params;

  const resolved = await resolveManagerUser(username);
  if (!resolved.ok) {
    const error: ApiErrorPayload = { error: resolved.error };
    return NextResponse.json(error, { status: resolved.status });
  }

  // Three states, not two, as everywhere: `null` is "not asked" and is the only
  // one the resolver fills. Collapsing absent and invalid is how `?season=abc`
  // quietly becomes the current season.
  const url = new URL(request.url);
  const requested = parseRequestedSeason(url.searchParams.get("season"));
  if (requested && !requested.ok) {
    const error: ApiErrorPayload = { error: requested.error };
    return NextResponse.json(error, { status: 400 });
  }
  const season = requested?.season ?? (await getActiveSeason());

  try {
    const rosters = await getManagerRosters(resolved.user.user_id, season);

    // Deduped across leagues before the lookup: a player held in forty of them
    // is one row to fetch and one entry to send.
    const ids = [
      ...new Set(
        Object.values(rosters)
          .flat()
          // Sleeper pads roster slots with these; they are not players and must
          // not be looked up. The fold drops them again — this is only to keep
          // the query's parameter array honest.
          .filter((id) => id && id !== "0"),
      ),
    ];

    // Together: neither needs the other's answer, and the board read is a
    // process-local memo most of the time anyway.
    const [rows, market] = await Promise.all([
      getPlayerShareRows(ids),
      readKtcMarket(url.searchParams.get("ktc_board")),
    ]);

    const players: Record<string, PlayerShareSummary> = {};
    for (const [id, row] of Object.entries(rows)) {
      players[id] = toPlayerShareSummary(row, market.priceOf(id));
    }

    const payload: ManagerPlayersPayload = {
      season,
      rosters,
      players,
      ktc: market.answered,
    };
    return NextResponse.json(payload);
  } catch (error) {
    console.error(`[players] failed for ${username} ${season}:`, error);
    const payload: ApiErrorPayload = { error: "Failed to load rosters" };
    return NextResponse.json(payload, { status: 500 });
  }
}

/**
 * The one board this panel prices on, and a lookup into it.
 *
 * **The 1QB column, always**, which is the second half of the fixed-board rule
 * `ManagerPlayersPayload.ktc` states: which of KTC's two QB numbers a league
 * reads is a fact about *that league*, and a row held across a dozen leagues is
 * not one. Resolving it from the leagues in the counted pool was the
 * alternative and is worse than it looks — the pool moves with the reader's
 * filters, so a player's price would change when they narrowed to dynasty.
 *
 * **A failed read is not a failed panel.** The board is a memoized read that
 * evicts its own failures, and a valuation is an enhancement beside a list of
 * players, so an unreadable market answers `null` and every price with it —
 * which the drawer draws as em dashes, never zeroes.
 */
async function readKtcMarket(requested: string | null): Promise<{
  answered: ManagerPlayersPayload["ktc"];
  priceOf: (playerId: string) => number | null;
}> {
  const board = resolveKtcCrossLeagueFormat(parseKtcBoardChoice(requested));

  try {
    const boards = await getKtcBoards(board);
    return {
      answered: { board, superflex: false, updated_at: boards.updated_at },
      // Absent rather than zero: KTC's boards are a churning top few hundred
      // skill players, so an unpriced bench stash is the ordinary case and a 0
      // would be an opinion where the market has none. `ktcBoardValue` is what
      // keeps an off-the-board id and a nulled column reading the same way here
      // as they do on a league card.
      priceOf: (playerId) => ktcBoardValue(false, boards.values[playerId]),
    };
  } catch (error) {
    console.warn(`[players] KTC ${board} board unavailable:`, error);
    return { answered: null, priceOf: () => null };
  }
}
