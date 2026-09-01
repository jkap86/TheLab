// Superseded by `isPlausibleSeason` in `@/shared/season`, which also bounds the
// year — `/^\d{4}$/` alone accepts "0000". One rule for the season a caller may
// ask for and the season the resolver will accept. Nothing imports it any more;
// safe to delete.

export { isPlausibleSeason as isSeason } from "@/shared/season";
