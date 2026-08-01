/**
 * The stat-column vocabulary, re-exported from where this feature's modules
 * already import it.
 *
 * It moved to `features/shared` when the trades tool grew a value column of its
 * own — a piece read by a second tool moves, it does not get imported across
 * features — and this file is the mover's other half: one canonical definition,
 * read under the name the catalogues and components here already use.
 *
 * The import is relative with an explicit `.ts` extension because the modules on
 * the far side of it are pure and tested, and Node's test runner doesn't know
 * the `@/*` aliases.
 */
export { metricPreview } from "../shared/metric-cell.ts";
export type { ColumnPreset, Metric, MetricCell } from "../shared/metric-cell.ts";
