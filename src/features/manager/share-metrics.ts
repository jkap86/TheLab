// The share cards' metric catalogue, re-exported from where this feature's own
// consumers (`manager-players`, `manager-leaguemates`) already import it. It
// moved to `features/shared` with the lists that read it, once the lineup
// checker started opening the same two shares sheets.
export {
  DEFAULT_LEAGUEMATE_COLUMNS,
  DEFAULT_PLAYER_COLUMNS,
  LEAGUEMATE_SHARE_METRICS,
  PLAYER_ADP_METRICS,
  PLAYER_SHARE_COLUMN_PRESETS,
  PLAYER_SHARE_METRICS,
  SHARE_COLUMN_PRESETS,
  SHARE_METRICS,
} from "../shared/share-metrics.ts";
export type { ShareMetric, ShareMetricContext } from "../shared/share-metrics.ts";
