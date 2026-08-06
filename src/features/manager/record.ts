// A manager's season summed across leagues. It moved to `features/shared` when
// the lineup checker's plate needed the same shape for a *projected* record —
// the header that draws both moved with it — and is re-exported here so this
// tool's own consumers (`share-metrics`, `leagues-view-layout`) keep the import
// they have always had. Relative with an explicit `.ts` extension, since
// `share-metrics` is under the test runner.
export { aggregateRecord, EMPTY_RECORD } from "../shared/record.ts";
export type { OverallRecord } from "../shared/record.ts";
