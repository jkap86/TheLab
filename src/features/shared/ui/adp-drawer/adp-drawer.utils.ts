import type { AdpBoardStats, AdpBoardType, ManagerLeague } from "@/shared/manager";

import {
  type AdpControls,
  type AdpShownBoards,
  DEFAULT_ADP_ROUNDS,
  UNBOUNDED_ADP_RANGE,
  boardLabel,
  isDefaultAdpRange,
  previewAdpPool,
  seedFromLeague,
  steepnessSummary,
} from "../../adp-controls.ts";
import type { AdpPickRow, AdpPickStats } from "../../adp-picks.ts";
import { activeFilterCount } from "../../league-filters/summaries.ts";
import type { LeagueFilters } from "../../league-filters/types.ts";
import { ROUNDS_SEGMENT } from "./adp-drawer.constants.ts";

/**
 * The drawer's own pure arithmetic and wording: the strings its cells and
 * headings carry, and the small writes its controls make to {@link AdpControls}.
 *
 * It is deliberately *not* where the ADP vocabulary lives — the query string,
 * the value curve, the league seeding and the board sort all stay in
 * `adp-controls`, which is the canonical implementation and has its own tests.
 * What is here is the part that only ever existed inline in the drawer's markup,
 * where nothing could reach it.
 */

/** The ADP heading's hover: which drafts that column is averaged over. */
export function boardTitle(board: AdpBoardType, drafts: number | null): string {
  const population =
    board === "redraft"
      ? "drafts in redraft and keeper leagues"
      : "drafts in dynasty leagues";
  return drafts === null
    ? `Average draft position over ${population}`
    : `Average draft position over ${drafts.toLocaleString()} ${population}`;
}

/** The value headings' hover — one premise, however many columns state it. */
export function valueTitle(leagues: LeagueFilters): string {
  return `Draft capital under the value curve above, on a ${previewAdpPool(leagues)}-slot startable pool — the shape a league card's team value is summed from`;
}

/** The Taken heading's hover — a share, and the header is the only place to say of what. */
export function takenTitle(board: AdpBoardType): string {
  return `Share of the ${board} board’s drafts the player was taken in`;
}

/** Which of KTC's two boards a column reads. */
export type KtcBoard = "sf" | "oneqb";

/**
 * How each is spelled in a heading 40px wide — which is to say without the word
 * `KTC` in front of it.
 *
 * Measured rather than chosen: `KTC 1QB` with a sort caret is 56.1px, and buying
 * the pair that width costs 40px out of a name track that has 128 in the board's
 * densest state. The attribution moves to {@link ktcTitle}, which has room for
 * the source *and* for the caveat that matters more — see `BOARD_COLUMNS_ONE`
 * for the whole arithmetic.
 */
export const KTC_BOARD_NAMES: Record<KtcBoard, string> = {
  sf: "SF",
  oneqb: "1QB",
};

/**
 * A KTC heading's hover, and the one place the board's biggest caveat is stated.
 *
 * **KTC's board is a dynasty board, and these columns sit beside a redraft
 * average as readily as a dynasty one.** That is not a mismatch to hide — it is
 * a second lens on the player rather than a per-market price — but a reader
 * comparing a redraft ADP against a KTC number has to know the two are not
 * answering the same question, and the column is 44px of digits with nowhere to
 * say so. Hence here, on both headings, whichever markets are on screen.
 */
export function ktcTitle(board: KtcBoard): string {
  const lineup =
    board === "sf"
      ? "superflex (two-quarterback) leagues"
      : "single-quarterback leagues";
  return `KeepTradeCut’s dynasty trade value for ${lineup} — a dynasty board whichever ADP column it is read beside, and unpriced for kickers, defences and the deep end of every position`;
}

/**
 * A KTC cell's hover on a *pick* row: which of KTC's rows the number came off.
 *
 * A player's price needs no such line — KTC prices the player, and the heading
 * has already said which board. A pick is the case where the two vocabularies
 * only nearly line up: KTC publishes three thirds of a round for the drafts it
 * has an opinion about and one untiered row for the rest, so a number is
 * routinely read off a broader row than the pick being priced. Saying so is the
 * same "priced" against "priced exactly" distinction the trade card draws.
 */
export function ktcPickTitle(label: string, exact: boolean): string {
  const base = `KeepTradeCut’s own price for the ${label}`;
  return exact
    ? base
    : `${base}, estimated from a broader row than this pick’s own third of the round`;
}

/**
 * One ADP cell's hover: the spread behind the average, and the sample it was
 * taken over. It carries what the Taken column says in single-board mode, so
 * nothing is lost when both boards are up and that column has stepped aside.
 */
export function adpCellTitle(
  entry: AdpBoardStats,
  board: AdpBoardType,
  drafts: number | null,
): string {
  const taken = drafts ? ` of ${drafts.toLocaleString()}` : "";
  return `Picks ${entry.min_pick}–${entry.max_pick} · taken in ${entry.picks}${taken} ${board} draft${
    entry.picks === 1 ? "" : "s"
  } · ±${entry.stdev.toFixed(1)}`;
}

/**
 * The Taken column's own cell: of the drafts on *this* board, not of every draft
 * crawled — which is what makes it readable beside the ADP. An em dash wherever
 * either half of the fraction is missing, never a zero.
 */
export function takenShare(
  entry: AdpBoardStats | null,
  drafts: number | null,
): string {
  if (!entry || !drafts) return "—";
  return `${Math.round((entry.picks / drafts) * 100)}%`;
}

/**
 * One pick cell's hover: whose place on the board this is, and what the wait
 * cost it.
 *
 * A pick has no sample of its own to report — it was never taken in any of these
 * drafts — so what the cell owes a reader instead is the two things the number
 * rests on. The rung, because a pick priced off a rookie the reader can see a
 * few rows away is a claim they can check; and the discount, because a row
 * reading the same average as a current-year pick but a smaller value is
 * otherwise a contradiction on its face.
 */
export function pickCellTitle(stats: AdpPickStats, board: AdpBoardType): string {
  const rung = `Pick ${stats.overall} of the ${board} rookie ladder · stands on ${stats.player}`;
  if (stats.discount === 1) return rung;
  const share = Math.round(stats.discount * 100);
  const row = stats.discountExact ? "" : ", estimated from a broader KTC row";
  return `${rung} · ${share}% of a ${stats.base} pick on KTC${row}`;
}

/**
 * The Taken column for a pick: an em dash, always.
 *
 * Not a zero and not a blank cell. "Taken" is the share of this board's drafts a
 * player went in, and a pick went in none of them — it isn't a player and was
 * never on the board. The hover is what says so, since an em dash beside a real
 * ADP otherwise reads as a gap in the data rather than as a column that doesn't
 * apply.
 */
export const PICK_TAKEN_TITLE =
  "A pick isn’t drafted in these drafts — it stands on the rookie its rung took";

/**
 * The value cell's hover on a pick row, which is the board's premise plus the
 * one thing a pick adds to it.
 */
export function pickValueTitle(
  leagues: LeagueFilters,
  pick: AdpPickRow,
  stats: AdpPickStats,
): string {
  if (stats.discount === 1) return valueTitle(leagues);
  return `${valueTitle(leagues)} · discounted to ${Math.round(stats.discount * 100)}% for a ${pick.season} draft`;
}

/**
 * A sortable heading's accessible name: what the column is, how it is sorted,
 * and what pressing it will do.
 *
 * All three, because none of them is otherwise available. The visible label is
 * an abbreviation a 44px column has room for (`ADP D`, `1QB`), the sort state is
 * a caret glyph that is `aria-hidden` decoration, and what a press does is the
 * thing a reader cannot discover without making it. `aria-sort` is the usual
 * answer and is not available here: it belongs to a `columnheader`, and this
 * board is a list of `<li>` rather than a table — claiming a role the markup
 * doesn't have would be worse than spelling it out.
 */
export function sortHeadingLabel(
  name: string,
  direction: "asc" | "desc" | null,
): string {
  if (direction === null) return `${name} — activate to sort`;
  return direction === "asc"
    ? `${name}, sorted ascending — activate to sort descending`
    : `${name}, sorted descending — activate to sort ascending`;
}

/**
 * Which board the single-board columns read. Arbitrary (and unused) when both
 * are on screen, since each column names its own there.
 */
export function soleBoardOf(shown: AdpShownBoards): AdpBoardType {
  return shown === "dynasty" ? "dynasty" : "redraft";
}

/**
 * Move to another season, dropping the window with it.
 *
 * A date range is a cut *inside* a season, so the same dates against a different
 * one are a window that mostly isn't there — and silently returning an empty
 * board is worse than starting the new season whole.
 *
 * It resets to the *unbounded* window rather than to `DEFAULT_ADP_RANGE`, and
 * that difference is the whole of the rule above: the default is a relative
 * fortnight, which is exactly the window a season that ended a year ago does not
 * contain. Whole season, whichever season was picked.
 */
export function withSeason(controls: AdpControls, season: string): AdpControls {
  return { ...controls, season, range: UNBOUNDED_ADP_RANGE };
}

/**
 * Commit the Leagues bay: the rules a reader built, and the kind of draft to
 * average them over.
 *
 * **The point of it is that it is one write.** They are two fields of one stored
 * `AdpControls`, and they used to be applied as two calls — `onChange(rules)`
 * from the filters dialog, then that dialog's `extra.onApply(rounds)` — each
 * closing over the same store value, so the second landed
 * `{...controls, rounds}` on top of the first and took the rules back out with
 * it. Changing a rule *and* the draft kind in one press applied the draft kind
 * and silently dropped the rule; changing either alone worked, which is why it
 * survived. A function taking both is what makes that unrepresentable.
 */
export function withLeagueFilters(
  controls: AdpControls,
  leagueRules: LeagueFilters,
  rounds: AdpControls["rounds"],
): AdpControls {
  return { ...controls, leagueRules, rounds };
}

/**
 * The three bays of the pinned rail, and what each of their keys says while it
 * is shut.
 *
 * **A shut bay states its value, or the rail is three nouns and the reader has
 * to open all of them to find the one they meant.** That is the trades ledge's
 * mistake in a smaller box, and it is the whole reason this is a function with
 * tests rather than three strings in the markup: each value is the *same* wording
 * the board already uses elsewhere, derived from the same helpers, so a key can
 * never name a board the panel behind it would disagree with.
 *
 * **`narrowed` is not `open`.** It says this bay is moving the board away from
 * the default one everybody else sees, which is what the accent means everywhere
 * in this app — the app-bar trigger's bars run off the same question. Which bay
 * is *open* is said by the key sinking into the rail instead, so the two signals
 * never have to share the token. The curve is therefore never narrowed however
 * far it has been dragged: it reprices a population it does not change, which is
 * exactly why {@link adpNarrowingCount} leaves it out too.
 */
export type AdpBayId = "leagues" | "window" | "curve";

export type AdpBayState = {
  readonly id: AdpBayId;
  /** The field, engraved over the answer. */
  readonly label: string;
  /** What this bay is set to, in the board's own words. */
  readonly value: string;
  /** This bay is narrowing the board away from the default. */
  readonly narrowed: boolean;
};

export function adpBayStates(controls: AdpControls): AdpBayState[] {
  return [
    {
      id: "leagues",
      label: "Leagues",
      value: leaguesBayValue(controls),
      narrowed:
        activeFilterCount(controls.leagueRules) > 0 ||
        controls.rounds !== DEFAULT_ADP_ROUNDS,
    },
    {
      id: "window",
      label: "Window",
      value: boardLabel(controls.range, controls.season),
      narrowed: !isDefaultAdpRange(controls.range),
    },
    {
      id: "curve",
      label: "Curve",
      value: curveBayValue(controls.steepness),
      narrowed: false,
    },
  ];
}

/**
 * What the Leagues key says: the rules and the kind of draft, and only the ones
 * actually set.
 *
 * Naming a part that is not narrowing anything would put "All leagues · All
 * drafts" permanently on a rail whose whole reason for existing is that the old
 * block spent its height on controls reporting that nothing was set. With
 * neither half set there is nothing to state but the population, so it says that.
 */
function leaguesBayValue(controls: AdpControls): string {
  const rules = activeFilterCount(controls.leagueRules);
  const parts: string[] = [];
  if (rules > 0) parts.push(`${rules} rule${rules === 1 ? "" : "s"}`);
  if (controls.rounds !== "all") parts.push(roundsLabel(controls.rounds));
  return parts.length === 0 ? "All leagues" : parts.join(" · ");
}

/**
 * The draft-kind option, in the shorter spelling a key has room for.
 *
 * Derived from the dialog's own option table rather than written out beside it,
 * so the key cannot name a kind the row it opens doesn't offer: the parenthetical
 * is the round count, which is the *evidence* for the name and belongs in the
 * row where there is width for it.
 */
function roundsLabel(rounds: AdpControls["rounds"]): string {
  const option = ROUNDS_SEGMENT.options.find((o) => o.value === rounds);
  return (option?.label ?? rounds).replace(/\s*\(.*\)$/, "");
}

/**
 * What the Curve key says — {@link steepnessSummary}'s fraction without the
 * sentence around it.
 *
 * A rail key has room for the number and not for what it is a number *of*, and
 * the bay one press away spells it out whole. Taken off that function rather
 * than recomputed, because two spellings of one curve is the drift a shared
 * helper exists to stop.
 */
export function curveBayValue(halvings: number): string {
  return steepnessSummary(halvings).replace(/^last starter ≈ /, "");
}

/**
 * The density behind the Window key, as bar heights in `0..1`.
 *
 * The key carries a picture of the months it is cut from, which is what keeps a
 * shut window bay from being a bare label: the reader can see *where* the drafts
 * are without opening anything. It is the resting line the panel used to draw
 * before the window was seated permanently — honest again precisely because the
 * expanded channel is not also on screen, which is the thing that retired it.
 *
 * The last `bars` months, since the recent end is the one a window is usually
 * cut from. A month with drafts never rounds away to nothing (a bar the reader
 * cannot see is a month that reads as empty), and a month with none draws
 * nothing at all — that difference is the only thing the picture is for.
 */
export function densitySpark(
  months: readonly { readonly month: string; readonly drafts: number }[],
  bars = 8,
): number[] {
  const recent = [...months]
    .sort((a, b) => a.month.localeCompare(b.month))
    .slice(-bars);
  const peak = recent.reduce((max, m) => Math.max(max, m.drafts), 0);
  if (peak <= 0) return [];
  return recent.map((m) => (m.drafts === 0 ? 0 : Math.max(0.16, m.drafts / peak)));
}

/**
 * Seed the league settings from one of the offered leagues, by id. Null when the
 * id names nothing on the list — the seed chip re-arms rather than acting on a
 * league that isn't there, and the caller writes nothing.
 */
export function withSeededLeague(
  controls: AdpControls,
  leagues: readonly ManagerLeague[],
  leagueId: string,
): AdpControls | null {
  const league = leagues.find((l) => l.league_id === leagueId);
  return league ? seedFromLeague(controls, league) : null;
}
