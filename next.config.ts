import type { NextConfig } from "next";

/** Shared by the rewrite that answers these and the header that makes the
 *  answer stick; see the block above `headers()`. */
const LEGACY_AVATAR_ASSETS =
  "/_next/static/media/:name(league_avatar|user_avatar|player_avatar).:hash.:ext(png|jpeg)";

const nextConfig: NextConfig = {
  // node-pg-migrate loads migration files via a runtime `import(file://...)`,
  // which the bundler cannot statically resolve. Keep it (and pg) as native
  // Node modules so the on-boot migration runner in src/instrumentation.ts
  // works instead of being bundled. (pg is auto-externalized; listed for clarity.)
  serverExternalPackages: ["node-pg-migrate", "pg"],

  /**
   * Where TheLabX's URLs land.
   *
   * This app takes over that one's address, so every link a reader ever
   * bookmarked there arrives here. Most of them already answer — `/tools`,
   * `/trades`, `/comps`, `/picktracker` and `/picktracker/<id>` are the same
   * paths in both — and `/` is this app's own landing rather than anything
   * inherited. What is left is the four below, and `app/not-found.tsx` is the
   * backstop for anything this list has not thought of.
   *
   * **A manager's URL over there was always a tab.** `app/manager/[searched]/`
   * holds `leagues/`, `players/` and `leaguemates/` and no page of its own, so
   * there is no such thing as a bookmarked `/manager/<name>` from TheLabX —
   * every real one is three segments. All three are one page here: the leagues
   * grid, with players and leaguemates as its two drawers. So the tab segment
   * is dropped and the manager kept, which is what leaves the bookmark
   * answering the question it was made for rather than dumping its reader on a
   * search field with the name they came with thrown away.
   *
   * **`:tab+`, not `:tab*`, and that is the difference between a redirect and a
   * loop.** Redirects are checked *before* the filesystem, so a `*` — zero or
   * more — would match `/manager/<name>` itself and send it back to itself for
   * ever, taking the page this redirect exists to deliver readers to with it.
   *
   * **The two bare routes go to `/tools` because there is nothing to carry.**
   * Neither `/manager` nor `/lineupchecker` exists here by construction: a tool
   * about somebody's leagues names them in its path, and the tools page
   * resolves both off the stored account, so a reader who arrives with no name
   * is one press from the page they wanted.
   *
   * `permanent` is 308 throughout, because none of these four will be a page
   * here — the two bare routes are a deliberate absence and the tab segment has
   * no meaning left to recover. A 308 is cached by a browser for ever, which is
   * the right claim about a retired URL and the wrong one about a path this app
   * might yet serve; that is why the catch-all in `app/not-found.tsx` makes no
   * such claim, and why anything worth a 308 has to be named here.
   */
  async redirects() {
    return [
      {
        source: "/",
        destination: "/tools",
        permanent: true,
      },
      {
        source: "/manager/:username/:tab+",
        destination: "/manager/:username",
        permanent: true,
      },
      {
        source: "/manager",
        destination: "/tools",
        permanent: true,
      },
      {
        source: "/lineupchecker",
        destination: "/tools",
        permanent: true,
      },
    ];
  },

  /**
   * One dead asset from the pre-rewrite bundle, answered because a browser that
   * has already booted cannot be told to stop asking for it.
   *
   * TheLabX's `Avatar` reached for a bundled image inside `onError` when the
   * Sleeper CDN did not answer, and assigned `src` without latching first. This
   * app ships no such image, so the 404 re-entered that handler, which
   * reassigned the same `src` — and assigning `src` restarts the load even when
   * the value has not changed. That is a loop with no exit inside the page. One
   * tab left open on the old bundle held it at 26 requests a second, 98% of
   * everything this app served, and nothing deployed here could reach it: the
   * code doing it is cached in that browser under `immutable`. The only lever
   * left on this side is to stop the request from failing.
   *
   * **A rewrite in `beforeFiles`, and not a redirect, because `/_next` is
   * spoken for.** The note on `redirects()` above — checked before the
   * filesystem — is true of the paths this app routes and not of this one. Next
   * resolves `/_next/*` as its own reserved namespace ahead of user redirects,
   * so a redirect entry for this source never runs and the 404 stands. A
   * `beforeFiles` rewrite is the one hook that lands in front of it.
   *
   * **The destination has to decode.** A 404, a 410, or a 200 carrying an empty
   * body all arrive back in `onError` and the loop simply resumes; only a real
   * image ends it, which is what `public/legacy-avatar.png` — a single
   * transparent pixel — is for. It is invisible where it lands: the old markup
   * drew this behind a name at 30% opacity.
   *
   * **The header is the difference between asking once and asking forever.**
   * Rewritten to `public/`, the pixel would carry that directory's `max-age=0`
   * and be revalidated on every render of every avatar for as long as the tab
   * lives. `immutable` is honest here in a way it would not be about a page —
   * the bytes behind a retired content-hashed URL are never going to change —
   * and it is what makes this entry stop the traffic rather than merely make it
   * cheaper.
   *
   * The pattern is anchored to the three names that bundle shipped so it cannot
   * shadow anything this build emits into `_next/static/media` later.
   */
  async headers() {
    return [
      {
        source: LEGACY_AVATAR_ASSETS,
        headers: [
          { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
        ],
      },
    ];
  },

  async rewrites() {
    return {
      beforeFiles: [
        { source: LEGACY_AVATAR_ASSETS, destination: "/legacy-avatar.png" },
      ],
      afterFiles: [],
      fallback: [],
    };
  },
};

export default nextConfig;
