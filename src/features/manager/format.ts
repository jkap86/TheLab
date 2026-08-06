/**
 * This module is a re-export shim and holds nothing of its own any more.
 *
 * Every formatter it once owned left under the same rule, in three waves: the
 * trades page took `ordinal` for a pick's round, the lineup checker took the four
 * the manager plate is written in, and the league detail panel took the last four
 * — `formatValue`, `shortPlayerName`, `weekCount` and `formatWeekRange` — when
 * that panel moved to `features/shared/ui/league-detail` for the trades board to
 * open a card into.
 *
 * It stays because this feature's own consumers already import them from here,
 * which is the mover's habit throughout: one canonical definition read under two
 * names beats a sweep through a dozen call sites.
 */
export { ordinal } from "../shared/format.ts";
export {
  countdownSegments,
  formatCountdown,
  formatPoints,
  formatRecord,
  formatValue,
  formatWeekRange,
  formatWinPct,
  shortPlayerName,
  weekCount,
} from "../shared/format.ts";
export type { CountdownSegment } from "../shared/format.ts";
