/**
 * The drawer's public face, and deliberately only that.
 *
 * Both call sites reach it as `import("@/features/shared/ui/adp-drawer")`, so
 * this file is what that path resolves to now the drawer is a folder — the
 * dynamic import is unchanged and the chunk is still split at the same seam.
 * Nothing else in here is exported: the sections are this folder's business, and
 * an export the app barrel could pick up is how a lazily-loaded part ends up
 * back in the static graph of every page (see `features/shared/index.ts`).
 */
export { AdpDrawer } from "./adp-drawer";
