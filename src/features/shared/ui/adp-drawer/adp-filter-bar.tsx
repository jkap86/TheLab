import dynamic from "next/dynamic";

import type { ManagerLeague } from "@/shared/manager";

import type { AdpControls } from "../../adp-controls";
import type { LeagueFilters } from "../../league-filters";
import { LeagueFiltersPlaceholder } from "../league-filters-seat";
import type { LeagueFilterRow } from "../league-filters-modal/league-filters-modal.types.ts";
import { AdpLeagueSeedControl } from "./adp-league-seed-control";
import { ROUNDS_SEGMENT } from "./adp-drawer.constants.ts";

/**
 * The board's league filters, behind the app's one league-filters dialog.
 *
 * **It was four chips of this drawer's own — scoring, superflex, best ball and
 * league size — and they are league rules now.** Each was a fixed question out
 * of a space readers arrive at a board with their own question in ("average the
 * drafts of leagues that start a linebacker", "half PPR with a TE bonus over
 * half a point"), and each already had an exact equivalent in the rule
 * vocabulary the manager tabs and the trades board have been narrowing with:
 * `qb+sf ≥ 2` *is* `isSuperflexLineup`, and the size chip is `teams = 12`. Two
 * filter languages a few pixels apart, one of them strictly weaker, was the
 * thing to fix — not the row's height.
 *
 * What the dialog gains for this caller is the **draft-kind row**, seated in its
 * trough as an {@link ExtraSegment}: what kind of draft to average is the one
 * thing left that a *league* rule cannot say, since it is a fact about the room.
 * It goes inside rather than beside, because a dialog and a stray chip is the
 * arrangement this replaced.
 *
 * What it loses is the **Type** row (`omitType`), which is the same trade the
 * board's own `league_type` parameter already made: every fetch answers the
 * redraft and dynasty markets side by side and the board keys choose which is
 * drawn, so on this page the league type is a display question and not a
 * population one. Left in, it was a second control over the one axis the display
 * already owns — narrow to dynasty leagues with the redraft column up and the
 * answer is an empty column with nothing on screen saying why.
 *
 * The seed control stays outside it and stays a chip. It is not a filter — it
 * *writes* filters, from a league the reader recognises by name — and the trades
 * board passes no leagues to it at all, which is what keeps it out of a dialog
 * that page also opens.
 *
 * `dynamic()` for the dialog itself, the split its two other call sites already
 * make: the drawer is behind a press and the dialog is behind a second one, so
 * the ~55KB of rule bays, presets and match rail has no business in the chunk
 * that draws the board. The placeholder comes from `league-filters-seat` and
 * never from the dialog's own module — an import of that module here would pull
 * it straight back into the static graph and split nothing.
 */
const LeagueFiltersModal = dynamic(
  () =>
    import("../league-filters-modal").then((m) => m.LeagueFiltersModal),
  { ssr: false, loading: () => <LeagueFiltersPlaceholder label="Leagues" /> },
);

/**
 * Hoisted rather than written inline, so the array is one value across renders —
 * it is a prop of a `dynamic()` component and a fresh literal each time would
 * defeat any memoisation downstream for a list that never changes.
 */
const ADP_OMITTED_ROWS: readonly LeagueFilterRow[] = ["season", "type"];

export function AdpFilterBar({
  controls,
  leagues,
  seedLeagues,
  onChange,
}: {
  controls: AdpControls;
  /**
   * The crawled leagues the rules run over — the dialog's per-option counts, its
   * breakdown rows and its scoring-key menu are all read off this, and so is the
   * scope the board is actually narrowed by (which the *caller* resolves, since
   * it is what the fetch is keyed on).
   *
   * Empty while it loads, or where nothing has asked for it yet. That is the
   * honest state rather than a gap: with no leagues in hand the rules resolve to
   * no narrowing, so the board is the unnarrowed one and the dialog's counts are
   * zeroes until the list lands.
   */
  leagues: readonly ManagerLeague[];
  /** See {@link AdpDrawer}'s own prop — empty means no seed control at all. */
  seedLeagues: readonly ManagerLeague[];
  onChange: (controls: AdpControls) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <LeagueFiltersModal
        label="Leagues"
        filters={controls.leagueRules}
        leagues={leagues}
        // Both rows this board answers with a control of its own: the board keys
        // choose the redraft or dynasty column, and the pinned block's own
        // season row decides which leagues are fetched at all.
        omit={ADP_OMITTED_ROWS}
        onChange={(next: LeagueFilters) =>
          onChange({ ...controls, leagueRules: next })
        }
        extra={{
          ...ROUNDS_SEGMENT,
          value: controls.rounds,
          onApply: (rounds: string) =>
            onChange({ ...controls, rounds: rounds as AdpControls["rounds"] }),
        }}
      />

      <AdpLeagueSeedControl
        controls={controls}
        leagues={seedLeagues}
        onChange={onChange}
      />
    </div>
  );
}
