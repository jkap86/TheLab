// Leaguemate shares moved to `features/shared` with the browse that reads them,
// on the same terms as `shares` beside it. Re-exported here for this feature's
// own consumers.
export { leaguemateShares } from "../shared/leaguemates.ts";
export type {
  LeaguemateShare,
  LeaguemateShares,
} from "../shared/leaguemates.ts";
