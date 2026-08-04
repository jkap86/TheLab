/**
 * The ADP board vocabulary — moved to `features/shared` once the trades page
 * needed the same board and drawer the manager tool already had. Re-exported
 * here under its old name because every consumer in this feature (the filters
 * context, the Players tab, `manager-header`'s neighbours) already imports it
 * from `./adp-controls`, the same mover's rule `date-range` and `format`
 * followed out of this feature earlier.
 */
export * from "../shared/adp-controls.ts";
