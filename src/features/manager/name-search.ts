// The one ranking rule every name field in these tools uses. It moved to
// `features/shared` with the rail and the shares sheets that read it; re-exported
// here for this feature's own consumers.
export { rankByName } from "../shared/name-search.ts";
