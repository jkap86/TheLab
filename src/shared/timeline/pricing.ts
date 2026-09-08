import type {
  KtcBoardChoice,
  KtcLineupChoice,
  TimelinePickCellPayload,
  TimelinePricingPayload,
} from "@/shared/contract";
import { getKtcBoards, isSuperflexLineup, ktcBoardValue } from "@/shared/ktc";
import { resolveKtcFormat } from "@/shared/ktc/board-choice";
import { getManagerDraftAdp, leaguePickBoard, pickValue } from "@/shared/manager";
import type { DraftPickAsset, ManagerLeagueRow } from "@/shared/manager";
import { getRosProjections, restOfSeasonStart } from "@/shared/projections";
import type { RosProjections } from "@/shared/projections";
import { getNflState } from "@/shared/sleeper";

import type { TimelineSeason } from "./read";

/**
 * Today's boards, narrowed to one league chain and the players a timeline can
 * name.
 *
 * **This is the lineups route's own pipeline run for a single league**, and
 * that is the point rather than a coincidence: a past roster priced on a
 * different ADP board or a different KTC market than the card in front of the
 * rail is not a comparison, it is two numbers on two rulers. So the season, the
 * manager and the market choice all arrive from the same caller the card reads,
 * and every board is resolved the same way.
 *
 * **Every read degrades rather than failing.** A missing projections span, an
 * unreadable KTC market and an account with no synced drafts each leave their
 * own half of the pricing empty, and the client's solve reads an absent price as
 * "nothing to say" exactly as the lineups route already does — the all-zero rule
 * turns a wholly unpriced metric into dashes rather than into zeroes.
 */
export async function readTimelinePricing({
  seasons,
  playerIds,
  managerUserId,
  season,
  board,
  qbBoard,
}: {
  /** The league's seasons, newest first — the first of them is the ruler. */
  seasons: readonly TimelineSeason[];
  /** Every player the timeline can name — the union, not just today's rosters. */
  playerIds: ReadonlySet<string>;
  /** Whose ADP board this prices against; null skips the capital metrics. */
  managerUserId: string | null;
  season: string;
  board: KtcBoardChoice;
  /**
   * Which of the two QB columns both valuations read, or `auto` for the
   * league's own reading.
   *
   * **The axis `board` beside it always lacked.** A market is KeepTradeCut's
   * own; a QB board is a fact about how a league starts quarterbacks, and *both*
   * priced valuations split on it — the ADP fold aggregates superflex drafts
   * apart from standard ones. It is here because the card in front of this rail
   * can now force one, and a past stop priced on the league's own board beside
   * a present one priced on `sf` is the two-rulers reading this payload's whole
   * shape exists to prevent.
   */
  qbBoard: KtcLineupChoice;
}): Promise<{
  pricing: TimelinePricingPayload;
  /**
   * Who holds which pick cell at the start of each season's replay, by league
   * id — the grid that season's rewind starts from.
   *
   * It comes back from here rather than being laid again by the caller because
   * it has to be the *same* enumeration the price table is keyed by: a dynasty
   * league's grid is `dynastyPickGrid`'s three-season horizon and every other
   * format's is derived from its trades, so a second call with a different grid
   * argument would rewind cells the cards below cannot price.
   */
  owned: Map<string, Map<number, DraftPickAsset[]>>;
}> {
  // **The newest season is the ruler**, and every board below is resolved from
  // it — see `TimelinePricingPayload.league` for why a past season's own scoring
  // and lineup are deliberately not used to price it.
  const ruler: ManagerLeagueRow = seasons[0].league;
  // The reader's choice where they made one, the league's own reading
  // otherwise — which is what `auto` means on both axes everywhere else.
  const superflex =
    qbBoard === "auto"
      ? isSuperflexLineup(ruler.roster_positions)
      : qbBoard === "sf";

  const [projections, adp, ktc] = await Promise.all([
    readProjections(season),
    readAdp(managerUserId, season, superflex),
    readKtc(ruler, board, superflex),
  ]);

  // One pick table across the chain, resolved and priced per season. Each grid
  // is that season's own — its horizon, its draft order, its size — because a
  // slot and the board width it was drawn on are one fact: pricing a slot of 5
  // from a ten-team year against today's twelve would put it in the wrong third
  // of its round. Holder-independent by construction, which is what makes a
  // rewound portfolio a lookup — see `PickCell`.
  //
  // **Newest season first, and the first writer of a key wins.** Two adjacent
  // years enumerate some of the same future picks, and where they disagree about
  // a cell's origin name it is because a roster changed hands — in which case
  // today's name is the one the rest of the card already uses.
  const picks: Record<string, TimelinePickCellPayload> = {};
  const owned = new Map<string, Map<number, DraftPickAsset[]>>();
  for (const entry of seasons) {
    const grid = leaguePickBoard(entry.league, entry.season, (pick) =>
      ktc.pickPrice(pick, entry.league.total_rosters),
    );
    owned.set(entry.league.league_id, grid.owned);
    for (const [key, cell] of grid.cells) {
      if (key in picks) continue;
      picks[key] = {
        slot: cell.slot,
        origin_name: cell.origin_name,
        value: cell.value,
      };
    }
  }

  const pricing: TimelinePricingPayload = {
    league: {
      total_rosters: ruler.total_rosters,
      roster_positions: ruler.roster_positions,
      scoring_settings: ruler.scoring_settings,
    },
    projections: trimProjections(
      projections.board,
      playerIds,
      ruler.scoring_settings,
    ),
    adp: Object.fromEntries(
      [...playerIds].flatMap((id) => {
        const entry = adp.get(id);
        return entry ? [[id, { board: entry.board, adp: entry.adp }] as const] : [];
      }),
    ),
    ktc_values: Object.fromEntries(
      [...playerIds].flatMap((id) => {
        const value = ktc.values.get(id);
        return value === undefined ? [] : [[id, value] as const];
      }),
    ),
    picks,
    from_week: projections.fromWeek,
    ktc: ktc.answered,
  };

  return { pricing, owned };
}

/** The rest-of-season span, on the same three readings the lineups route takes. */
async function readProjections(
  season: string,
): Promise<{ board: RosProjections; fromWeek: number | null }> {
  const fromWeek = await restOfSeasonStart(season, getNflState);
  if (fromWeek === null) return { board: {}, fromWeek: null };
  try {
    return { board: await getRosProjections(season, fromWeek), fromWeek };
  } catch (error) {
    // The fallback's case, not the route's failure: every player prices on
    // draft capital and `from_week: null` says which lens answered.
    console.warn(`[timeline] projections unavailable for ${season}:`, error);
    return { board: {}, fromWeek: null };
  }
}

/**
 * The manager's own ADP board, on the superflex axis this league reads.
 *
 * Empty where the request named no manager — which is what a league-scoped
 * caller with no account in hand gets, and which leaves the three capital
 * metrics ranked null by the all-zero rule rather than priced from nothing. The
 * board is the manager's by construction (see `getManagerDraftAdp`), so there is
 * no account-free version of it to fall back to.
 */
async function readAdp(
  managerUserId: string | null,
  season: string,
  superflex: boolean,
) {
  if (managerUserId === null) return new Map<string, never>();
  try {
    const boards = await getManagerDraftAdp(managerUserId, season);
    return superflex ? boards.superflex : boards.standard;
  } catch (error) {
    console.warn(`[timeline] ADP unavailable for ${season}:`, error);
    return new Map<string, never>();
  }
}

/** This league's own KTC market and QB board, plus its rookie-pick rows. */
async function readKtc(
  league: ManagerLeagueRow,
  choice: KtcBoardChoice,
  superflex: boolean,
) {
  const format = resolveKtcFormat(choice, league.league_type);
  const empty = {
    values: new Map<string, number>(),
    answered: null,
    pickPrice: (): number | null => null,
  };

  let boards;
  try {
    boards = await getKtcBoards(format);
  } catch (error) {
    console.warn(`[timeline] KTC ${format} board unavailable:`, error);
    return empty;
  }

  const values = new Map<string, number>();
  for (const [id, value] of Object.entries(boards.values)) {
    // Absent rather than zero, on each board independently: KTC prices some
    // entries on one board and not the other, and a zero there would be a price
    // rather than the absence of one.
    const priced = ktcBoardValue(superflex, value);
    if (priced !== null) values.set(id, priced);
  }

  return {
    values,
    answered: { board: format, updated_at: boards.updated_at ?? null },
    // `pickValue` rather than a second reading of KTC's rows: one meeting of
    // the two pick vocabularies, so a past pick cannot be priced off a
    // different third of its round from the one the card shows.
    pickPrice: (
      pick: { season: string; round: number; slot: number | null },
      size: number,
    ) => pickValue({ values, picks: boards.picks, superflex }, size, pick),
  };
}

/**
 * Today's projections, trimmed twice.
 *
 * **To the players the timeline can name**, since the board is every player the
 * feed mentioned and a stop can only ever seat someone a roster held.
 *
 * **And to the stat keys this league scores**, which is exact rather than an
 * approximation: `scoreStatLine` is driven by the scoring settings, so a
 * category the league does not score is never read. On a typical league that is
 * twenty keys of a stat line's fifty, and it is the difference between a
 * payload a reader waits for and one they do not.
 *
 * `weeks` rides along whole, because its emptiness is what separates "no
 * projection" from "a projected zero" — the distinction the solve seats by.
 */
function trimProjections(
  board: RosProjections,
  playerIds: ReadonlySet<string>,
  scoring: Record<string, number> | null,
): TimelinePricingPayload["projections"] {
  const scored = scoring === null ? null : new Set(Object.keys(scoring));

  const out: TimelinePricingPayload["projections"] = {};
  for (const id of playerIds) {
    const line = board[id];
    if (!line) continue;

    const stats: Record<string, number> = {};
    for (const [key, value] of Object.entries(line.stats)) {
      if (scored === null || scored.has(key)) stats[key] = value;
    }
    out[id] = {
      player_id: line.player_id,
      stats,
      weeks: line.weeks,
      name: line.name,
      positions: line.positions,
      team: line.team,
    };
  }
  return out;
}
