import { ALL, type LeagueFilters } from "../../league-filters";
import type { ManagerLeague } from "@/shared/manager";

import { FilterRail } from "./filter-rail.tsx";

/**
 * Which season's leagues the rest of the panel is narrowing within.
 *
 * **It is a band above the trough rather than a fourth row in it, and the
 * material is the argument.** Status, type and format are attributes of a
 * league; the season is the *population* those attributes are read against —
 * the distinction the ADP drawer is already built around ("the season is the
 * board's population; the window is a cut inside it"). Filed as a peer it reads
 * as a fourth attribute, and a reader never notices that changing it swaps the
 * corpus out from under every count below. A lit leading rail on a raised face
 * over the recessed trough is this app's existing grammar for "this is the thing
 * the rest is read against" — the same relationship the header plate has to the
 * list under it.
 *
 * It also makes the numbers underneath honest without a word of explanation.
 * Every count in the trough is probed against the rest of the draft, so once a
 * season is lit they are counts *within* that season; the band being visibly
 * upstream is what says so, and the note beside it says it in words.
 *
 * **Nothing is drawn where there is only one season to pick.** Every caller but
 * the ADP board's widest setting resolves a single season server-side, so the
 * row would be one key, permanently lit, reporting a fact rather than offering a
 * choice — which is the thing every other row in this panel was shortened to
 * stop doing. It turns itself on the day a caller widens its fetch, with no
 * change here: the options are read off the leagues in hand, the way the scoring
 * bay's key menu is.
 */
export function SeasonBand({
  draft,
  onChange,
  leagues,
  seasons,
}: {
  draft: LeagueFilters;
  onChange: (filters: LeagueFilters) => void;
  leagues: readonly ManagerLeague[];
  /**
   * The seasons on offer, derived by the modal beside the other two data-driven
   * menus rather than here — one place deriving all three is what keeps the
   * memoisation in one place, and it leaves this component hook-free and so
   * callable directly by the render tests.
   */
  seasons: readonly string[];
}) {
  // One season is no choice; none at all is a cold load, where a band of a
  // single "All seasons" key would be the same empty claim.
  if (seasons.length < 2) return null;

  const options = [
    { value: ALL, label: "All seasons" },
    ...seasons.map((season) => ({ value: season, label: season })),
  ];

  return (
    <div className="lab-plate relative flex flex-wrap items-center gap-x-3 gap-y-1.5 overflow-hidden rounded-xl py-1.5 pl-1 pr-3">
      {/*
        The plate's own mark. It is a sibling rather than a border so it runs the
        full height of a band that has wrapped to two lines on a phone.
      */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-0 left-0 w-[3px] bg-gradient-to-b from-[#c8fff9] to-active/70 shadow-[3px_0_14px_rgba(0,255,229,0.5)]"
      />
      <FilterRail
        label="Season"
        options={options}
        value={draft.season}
        leagues={leagues}
        probe={(season) => ({ ...draft, season })}
        onPick={(season) => onChange({ ...draft, season })}
      />
      {/*
        The sentence is the half a rail cannot say: which way the arrow points
        between this control and every count below it. It names the season rather
        than restating the key, since a line beside a control must not repeat
        what the control already says.
      */}
      <p className="min-w-0 flex-1 text-[11.5px] text-foreground/40">
        {draft.season === ALL
          ? "Every season on file. Everything below narrows across all of them."
          : `Everything below narrows within ${draft.season}.`}
      </p>
    </div>
  );
}
