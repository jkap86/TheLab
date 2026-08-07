/** Small presentational pieces shared by the standings, roster and share views. */

// Moved to `features/shared` once the ADP drawer needed it there too;
// re-exported under its old name for this feature's own consumers
// (`player-shares`, `subject-parts`, `subject-rail`).
export { PositionBadge } from "@/features/shared/ui/position-badge";

// The two panel states went to `features/shared/ui/panel-message` with the league
// detail panel, which is what wrote them and which the trades board now opens a
// card into. `ErrorCard` followed them when the shares sheet moved. Re-exported
// under their old names because this feature's own consumers — the players and
// leaguemates tabs, the leagues layout — already import them from here.
export { PanelLoading, PanelMessage } from "@/features/shared/ui/panel-message";

// The chevron and the expanded share row went to `features/shared` with the
// shares sheets and the cards that draw them, once the lineup checker started
// opening the same two browses. Re-exported for this feature's own consumers.
export { Chevron } from "@/features/shared/ui/chevron";
export { SharedLeagueRow } from "@/features/shared/ui/shares/shared-league-row";

// `teamLabel`, `managerLabel` and `TeamAvatar` went with the league detail panel
// too, and leave no re-export behind: the standings table and the draft-pick
// chips were their only readers, and both moved.
