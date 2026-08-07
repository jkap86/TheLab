// The stat columns and the heading rail's cells. They moved to `features/shared`
// with the shares sheets and the subject rail that draw them — the lineup checker
// opens both — and are re-exported here for this feature's own consumers.
export {
  MetricColumn,
  MetricColumns,
  MetricHeadings,
} from "@/features/shared/ui/metric-column";
