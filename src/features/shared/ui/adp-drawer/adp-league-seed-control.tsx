import type { ManagerLeague } from "@/shared/manager";

import type { AdpControls } from "../../adp-controls";
import { ChipSelect } from "./adp-filter-control";
import { withSeededLeague } from "./adp-drawer.utils.ts";

/**
 * "Match a league…" — the shortcut that fills the board's league settings from
 * one of the reader's own leagues.
 *
 * An action, not a selection: the value stays `""` so the chip re-arms after
 * use. It is drawn only where the caller has leagues the reader *plays in* —
 * see {@link AdpDrawer}'s `seedLeagues` prop for why an unfamiliar corpus is not
 * a longer list but a different control, and why an empty one draws nothing
 * rather than falling back to the crawled population.
 */
export function AdpLeagueSeedControl({
  controls,
  leagues,
  onChange,
}: {
  controls: AdpControls;
  leagues: readonly ManagerLeague[];
  onChange: (controls: AdpControls) => void;
}) {
  if (leagues.length === 0) return null;

  return (
    <ChipSelect
      value=""
      placeholder="Match a league…"
      ariaLabel="Match one of this manager's leagues"
      // Right-aligned where the row has room to spare, and simply next in
      // line where it wraps — `ml-auto` on a wrapped item strands it alone
      // on its own line with a hole to its left.
      className="sm:ml-auto"
      options={leagues.map((league) => ({
        value: league.league_id,
        label: league.name,
      }))}
      onChange={(leagueId) => {
        const seeded = withSeededLeague(controls, leagues, leagueId);
        if (seeded) onChange(seeded);
      }}
    />
  );
}
