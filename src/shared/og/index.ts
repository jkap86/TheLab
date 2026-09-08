// What an Open Graph card needs loaded: the two font faces, the pre-rendered
// wordmark, and the league avatar.
//
// Server-only, on the `shared/ktc` barrel's terms — `assets.ts` reads the disk
// at module scope. Nothing here is UI: the cards themselves are
// `features/tools/og`, which takes what this hands it and draws.
//
// **`site-url.ts` is deliberately not re-exported here**, and it is the
// `shared/ktc/roster` exception argued from the other side. `layout.tsx` is its
// caller and imports `@/shared/og/site-url` relatively, so that the root layout
// — which every page in the app renders through — does not pull `assets.ts`'s
// module-scope disk reads into its own graph. Through the barrel, deleting a
// font from `public/og/` would take every page down rather than one image
// route.
export {
  OG_FONTS,
  OG_CACHE_CONTROL,
  WORDMARK_34,
  WORDMARK_96,
  readLeagueAvatar,
} from "./assets";
