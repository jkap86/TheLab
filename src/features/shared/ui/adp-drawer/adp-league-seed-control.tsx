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
      // No seating of its own. It used to right-align itself (`sm:ml-auto`),
      // which was right while it shared a row with the key that opened the
      // filters dialog and is wrong now the filters are drawn under it: alone in
      // its row it would sit against the far edge, reading as detached from the
      // panel it writes into. It also measured the *viewport*, in a drawer that
      // is 32rem wide on every screen wide enough for that class to fire.
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
