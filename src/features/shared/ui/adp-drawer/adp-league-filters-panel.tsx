"use client";

import { useCallback, useState } from "react";

import type { ManagerLeague } from "@/shared/manager";

import { type AdpControls, DEFAULT_ADP_ROUNDS } from "../../adp-controls";
import { DEFAULT_LEAGUE_FILTERS, type LeagueFilters } from "../../league-filters";
import { LeagueFiltersPanel } from "../league-filters-modal/league-filters-panel.tsx";
import type { LeagueFilterRow } from "../league-filters-modal/league-filters-modal.types.ts";
import { AdpLeagueSeedControl } from "./adp-league-seed-control";
import { ROUNDS_SEGMENT } from "./adp-drawer.constants.ts";
import { withLeagueFilters } from "./adp-drawer.utils.ts";

/**
 * Hoisted rather than written inline, so the array is one value across renders.
 */
const ADP_OMITTED_ROWS: readonly LeagueFilterRow[] = ["season", "type"];

/**
 * The board's league filters, in full, inside the drawer.
 *
 * **It was a key that opened the shared `<dialog>` over the whole page**, and the
 * bay it stood in held nothing else but the seed chip — so a rail of three keys
 * that each open a panel had one key that opened a panel containing a key that
 * opened something else. Worse, what it opened was a *modal*: the board these
 * filters narrow went inert behind a 1040px sheet, which is the one thing every
 * other bay is built not to do (see {@link AdpBay} — a bay is a panel and not a
 * dialog precisely because the board is what it exists to be watched against).
 * The panel is the same panel; what it lost is the second press and the modality.
 *
 * Three things about it are this host's rather than the panel's:
 *
 *   - **Both halves commit in one write.** The rules and the draft-kind row are
 *     two fields of one stored `AdpControls`, so applying them as two calls means
 *     the second closes over the store value the first hasn't landed in yet and
 *     reverts its field — which is what happened for as long as the row rode the
 *     dialog's `extra.onApply` beside `onChange`: changing a rule *and* the draft
 *     kind in one press applied the draft kind and silently dropped the rule.
 *   - **Apply closes the bay**, which is the dialog's own contract and is what
 *     the float is for here: the board is underneath, and the press that commits
 *     a narrowing is exactly the moment a reader wants to see it move.
 *   - **The seed chip is not a filter, so it stays outside and commits at once.**
 *     It *writes* filters, from a league the reader recognises by name, and it
 *     writes the season and the displayed board with them — neither of which is
 *     in this panel's draft. So it lands the whole thing immediately and re-seeds
 *     the draft from what it wrote, rather than leaving a pending edit that Apply
 *     would then paint over. An action that acts.
 */
export function AdpLeagueFiltersPanel({
  controls,
  leagues,
  seedLeagues,
  onChange,
  onApplied,
}: {
  controls: AdpControls;
  /**
   * The crawled leagues the rules run over — the panel's per-option counts, its
   * breakdown rows and its scoring-key menu are all read off this, and so is the
   * scope the board is actually narrowed by (which the *caller* resolves, since
   * it is what the fetch is keyed on).
   *
   * Empty while it loads, or where nothing has asked for it yet. That is the
   * honest state rather than a gap: with no leagues in hand the rules resolve to
   * no narrowing, so the board is the unnarrowed one and the counts are zeroes
   * until the list lands.
   */
  leagues: readonly ManagerLeague[];
  /** See {@link AdpDrawer}'s own prop — empty means no seed control at all. */
  seedLeagues: readonly ManagerLeague[];
  onChange: (controls: AdpControls) => void;
  /** Shut the bay, which Apply does and nothing else here does. */
  onApplied: () => void;
}) {
  // Seeded at mount, which is all this host needs: the bay unmounts when it
  // closes, so there is no open state for the applied selection to drift under.
  const [rules, setRules] = useState<LeagueFilters>(controls.leagueRules);
  const [rounds, setRounds] = useState<AdpControls["rounds"]>(controls.rounds);

  // The one cast, and it is at the edge the row hands its value back over: a
  // segment row's options are `{ value: string }`, and the three this one offers
  // are `ROUNDS_SEGMENT`'s. Cast here rather than at the commit so the draft is
  // the real type everywhere in between.
  const pickRounds = useCallback(
    (value: string) => setRounds(value as AdpControls["rounds"]),
    [],
  );

  const apply = useCallback(() => {
    onChange(withLeagueFilters(controls, rules, rounds));
    onApplied();
  }, [controls, rules, rounds, onChange, onApplied]);

  const reset = useCallback(() => {
    setRules(DEFAULT_LEAGUE_FILTERS);
    setRounds(DEFAULT_ADP_ROUNDS);
  }, []);

  // Seeding writes the season and the displayed board as well as the rules, so
  // it commits rather than drafting — and the draft follows it, or Apply would
  // hand back the rules from before the seed.
  const seed = useCallback(
    (seeded: AdpControls) => {
      onChange(seeded);
      setRules(seeded.leagueRules);
    },
    [onChange],
  );

  return (
    // Capped rather than left to run: the bay floats over the board, and the
    // board is what a reader is narrowing *towards* — a panel that grew with its
    // own rule list would cover the whole of it and then some. `svh` rather than
    // `dvh`, the leagues list's rule: the viewport with the browser's chrome
    // showing is the only unit that keeps the promise on a phone, and a box that
    // grew and shrank as that chrome hid would fight the finger scrolling inside
    // it.
    <div className="flex max-h-[min(66svh,32rem)] flex-col">
      {/* The guard is the wrapper's, not the chip's — that returns null for an
          empty list on its own, and what this avoids is a padded row standing
          empty above the panel on a page with no leagues of the reader's own. */}
      {seedLeagues.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 pb-2">
          <AdpLeagueSeedControl
            controls={controls}
            leagues={seedLeagues}
            onChange={seed}
          />
        </div>
      )}

      <LeagueFiltersPanel
        seat="bay"
        draft={rules}
        onChange={setRules}
        leagues={leagues}
        // Both rows this board answers with a control of its own: the board keys
        // choose the redraft or dynasty column, and the pinned block's own
        // season row decides which leagues are fetched at all.
        omit={ADP_OMITTED_ROWS}
        extra={ROUNDS_SEGMENT}
        extraDraft={rounds}
        onExtraChange={pickRounds}
        onReset={reset}
        onApply={apply}
      />
    </div>
  );
}
