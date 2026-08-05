/**
 * The dialog's public face, and deliberately only that.
 *
 * All three call sites reach it as
 * `import("@/features/shared/ui/league-filters-modal")`, so this file is what
 * that path resolves to now the modal is a folder — the dynamic import is
 * unchanged and the chunk is still split at the same seam. Nothing else in here
 * is exported: the sections are this folder's business, and an export the app
 * barrel could pick up is how a lazily-loaded part ends up back in the static
 * graph of every page (see `features/shared/index.ts`, and the drawer's own
 * `index.ts` next door for the same rule stated twice).
 *
 * The trigger's placeholder is **not** here — it stays in
 * `../league-filters-seat`, which is static precisely because this module is
 * not.
 */
export { LeagueFiltersModal } from "./league-filters-modal.tsx";
