import type { NextConfig } from "next";

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
};

export default nextConfig;
