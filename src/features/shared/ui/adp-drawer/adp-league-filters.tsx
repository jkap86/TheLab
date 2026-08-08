import dynamic from "next/dynamic";

import type { ManagerLeague } from "@/shared/manager";

import type { AdpControls } from "../../adp-controls";

/**
 * The Leagues bay's contents, split at the press that opens the bay.
 *
 * The rule bays, the presets, the match rail and the breakdown are ~55KB that a
 * reader who only ever reads the board never opens, so they stay out of the
 * chunk that draws it — the split the shared dialog already makes at both its
 * other call sites, kept at the same seam now that this host draws the panel
 * inline instead of opening that dialog.
 *
 * **The seam is a module boundary, which is the whole of why this file exists**:
 * a `dynamic()` sitting in the same module as the thing it opens splits nothing,
 * since the static import beside it has already pulled the graph in. Nothing
 * here imports the panel except through the call below, and the placeholder is
 * written out rather than taken from it for exactly that reason.
 */
const AdpLeagueFiltersPanel = dynamic(
  () =>
    import("./adp-league-filters-panel").then((m) => m.AdpLeagueFiltersPanel),
  { ssr: false, loading: () => <FiltersLoading /> },
);

export function AdpLeagueFilters(props: {
  controls: AdpControls;
  leagues: readonly ManagerLeague[];
  seedLeagues: readonly ManagerLeague[];
  onChange: (controls: AdpControls) => void;
  onApplied: () => void;
}) {
  return <AdpLeagueFiltersPanel {...props} />;
}

/**
 * What holds the bay's box while that chunk is in flight.
 *
 * A height and nothing else. The bay floats over the board and is drawn by a
 * press, so what a fallback owes is that the panel doesn't appear to grow out of
 * a line — not a sketch of controls, which at this size would read as the panel
 * having loaded wrong.
 */
function FiltersLoading() {
  return (
    <p className="flex h-40 items-center justify-center text-xs text-foreground/35">
      Loading filters…
    </p>
  );
}
