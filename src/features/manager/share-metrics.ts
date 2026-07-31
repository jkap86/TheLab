import { leagueType } from "./filters.ts";
import { formatRecord, formatWinPct } from "./format.ts";
import type { Metric } from "./metric-cell.ts";
import { aggregateRecord } from "./record.ts";
import type { AdpPlayerPayload, ManagerLeague } from "./types";

/**
 * The metrics a share card can show in each of its stat columns, and how to read
 * one off the leagues behind a row.
 *
 * The third grain in the catalogue table, beside `league-metrics` (one league),
 * `standings-metrics` (one team) and `roster-metrics` (one player): here a row is
 * **a subject held across several of the manager's leagues** — a player he
 * rosters, a person he plays against. The shares views used to print two fixed
 * numbers for that subject, the count and the percentage, which answers how much
 * exposure without a word about *what kind*: eight leagues is a different position
 * when they are all dynasty, and a player owned in the leagues a manager is losing
 * is a different fact from one owned where he is winning. So a share card carries
 * the same four pickable slots a league card does, and this is what a slot holds.
 *
 * Both share views read this one catalogue rather than one apiece, because the
 * subject is the same shape either way — the only thing a player has that a
 * person does not is a price on the ADP board, and that is two extra metrics
 * ({@link PLAYER_SHARE_METRICS}) rather than a second grain. The leaguemates menu
 * simply never offers them, so the null they would read can't surface.
 *
 * Pure and free of runtime imports beyond the format helpers, {@link leagueType}
 * and {@link aggregateRecord} — everything from {@link ./types} arrives as an
 * erased `import type` — the same bar its three sibling catalogues hold.
 */

/** What a share metric reads from: the leagues behind one row, and its board price. */
export type ShareMetricContext = {
  /** The leagues this row is held or shared in, out of those counted. */
  leagues: readonly ManagerLeague[];
  /**
   * Leagues the share is out of — the denominator each view computes for itself
   * (rosters cached for a player share, member lists for a leaguemate share), and
   * never simply the number of leagues on screen.
   */
  leagueCount: number;
  /**
   * This player's entry on the ADP board the drawer selected, or null — for a
   * leaguemate row, and for a player the board didn't price. Only the player
   * metrics read it.
   */
  adp: AdpPlayerPayload | null;
};

export type ShareMetric = Metric<ShareMetricContext>;

/** How many of a row's leagues carry a given Sleeper type. */
function countType(leagues: readonly ManagerLeague[], type: number): number {
  return leagues.filter((league) => leagueType(league) === type).length;
}

/**
 * The share hover, naming the count, the denominator and the percentage once.
 * `tail` finishes the sentence, since the same shape reads "8 of 121 leagues" for
 * exposure and "5 of 8 are dynasty leagues" for the breakdown beneath it.
 */
function shareTitle(held: number, of: number, tail: string): string {
  const pct = of > 0 ? Math.round((held / of) * 100) : 0;
  return `${held} of ${of} ${tail} · ${pct}%`;
}

/**
 * The ADP hover, saying what the average rests on — the spread it was taken over,
 * how many drafts stood behind it and how wide they disagreed. The same "state the
 * population" habit the KTC and projection hovers keep on a league card.
 */
function adpTitle(entry: AdpPlayerPayload | null): string {
  if (!entry) return "not priced on this board";
  return `Picks ${entry.min_pick}–${entry.max_pick} · ${entry.picks} draft${
    entry.picks === 1 ? "" : "s"
  } · ±${entry.stdev.toFixed(1)}`;
}

/**
 * Every metric a share column can show, in the order the picker lists them: the
 * exposure it opened with — the count and that count as a percentage — then the
 * manager's season *in those leagues*, then what kind of leagues they are.
 *
 * The record metrics are the manager's own, not the row's: for a player they say
 * how the teams holding him are doing, and for a leaguemate how the manager fares
 * in the leagues they share. Both carry the two record rules the header does —
 * counted over leagues that report one, and no games is not `.000`.
 */
export const SHARE_METRICS: ShareMetric[] = [
  {
    key: "leagues",
    label: "Leagues",
    cell: ({ leagues, leagueCount }) => ({
      kind: "share",
      held: leagues.length,
      of: leagueCount,
      title: shareTitle(leagues.length, leagueCount, "leagues"),
    }),
  },
  {
    key: "share",
    label: "Share",
    cell: ({ leagues, leagueCount }) => ({
      kind: "value",
      text:
        leagueCount > 0
          ? `${Math.round((leagues.length / leagueCount) * 100)}%`
          : null,
      title: shareTitle(leagues.length, leagueCount, "leagues"),
    }),
  },
  {
    key: "record",
    label: "Record",
    cell: ({ leagues }) => {
      const record = aggregateRecord(leagues);
      return {
        kind: "value",
        // Preseason every league reports 0-0-0, and "0-0" there is a claim about
        // games nobody played — the same reading `pct` takes below.
        text: record.games > 0 ? formatRecord(record) : null,
        title:
          record.games > 0
            ? `${formatRecord(record)} across ${record.leagues} of these leagues`
            : "no games played in these leagues yet",
      };
    },
  },
  {
    key: "win_pct",
    label: "Win %",
    cell: ({ leagues }) => {
      const record = aggregateRecord(leagues);
      return {
        kind: "value",
        text: record.pct === null ? null : formatWinPct(record.pct),
        title:
          record.pct === null
            ? "no games played in these leagues yet"
            : `${formatWinPct(record.pct)} over ${record.games} games in ${
                record.leagues
              } of these leagues`,
      };
    },
  },
  {
    key: "dynasty",
    label: "Dynasty",
    cell: ({ leagues }) => {
      const held = countType(leagues, 2);
      return {
        kind: "share",
        held,
        of: leagues.length,
        title: shareTitle(held, leagues.length, "are dynasty leagues"),
      };
    },
  },
  {
    key: "redraft",
    label: "Redraft",
    cell: ({ leagues }) => {
      const held = countType(leagues, 0);
      return {
        kind: "share",
        held,
        of: leagues.length,
        title: shareTitle(held, leagues.length, "are redraft leagues"),
      };
    },
  },
  {
    key: "teams",
    label: "Teams",
    cell: ({ leagues }) => {
      if (leagues.length === 0) return { kind: "value", text: null, title: "no leagues" };
      const total = leagues.reduce((sum, league) => sum + league.total_rosters, 0);
      const avg = total / leagues.length;
      return {
        kind: "value",
        text: avg.toFixed(1),
        title: `${avg.toFixed(1)} teams on average across these leagues`,
      };
    },
  },
];

/**
 * The player-only metrics: the market's average draft position for him on the
 * board the ADP drawer selected, and the spread the picks landed across.
 *
 * A raw ADP rather than the draft-capital value a league card reads, because this
 * column is one player and not a roster — the inversion `adp-value` performs is
 * what makes positions summable, and there is nothing to sum here.
 */
export const PLAYER_ADP_METRICS: ShareMetric[] = [
  {
    key: "adp",
    label: "ADP",
    cell: ({ adp }) => ({
      kind: "value",
      text: adp ? adp.adp.toFixed(1) : null,
      title: adpTitle(adp),
    }),
  },
  {
    key: "adp_spread",
    label: "Picks",
    cell: ({ adp }) => ({
      kind: "value",
      text: adp ? `${adp.min_pick}–${adp.max_pick}` : null,
      title: adpTitle(adp),
    }),
  },
];

/** What a player row's picker offers: the shared metrics plus the two ADP ones. */
export const PLAYER_SHARE_METRICS: ShareMetric[] = [
  ...SHARE_METRICS,
  ...PLAYER_ADP_METRICS,
];

/** What a leaguemate row's picker offers — no board price to read for a person. */
export const LEAGUEMATE_SHARE_METRICS: ShareMetric[] = SHARE_METRICS;

/**
 * The four columns a player card opens with: the two numbers the table showed
 * before the slots were pickable, the ADP that was its third column, and the
 * manager's win rate where he is owned.
 */
export const DEFAULT_PLAYER_COLUMNS: string[] = [
  "leagues",
  "share",
  "adp",
  "win_pct",
];

/**
 * The four a leaguemate card opens with — the same two counts, then how the
 * manager is faring in the leagues they share.
 */
export const DEFAULT_LEAGUEMATE_COLUMNS: string[] = [
  "leagues",
  "share",
  "record",
  "win_pct",
];
