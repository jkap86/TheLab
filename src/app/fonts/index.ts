import localFont from "next/font/local";

/**
 * **The three faces are self-hosted files in this folder, not `next/font/google`
 * calls, and the reason is that the build used to reach Google for them.**
 *
 * `next/font/google` is a *build-time* fetch: it asks `fonts.googleapis.com` for
 * the family's CSS and then downloads every `woff2` that CSS names. Twelve files
 * across these three families, on every deploy, and a single non-200 among them
 * fails the build outright — Turbopack reports the miss as
 * `Module not found: Can't resolve '@vercel/turbopack-next/internal/font/google/font'`,
 * which names nothing about fonts and sends you looking for a bad import.
 *
 * That is not hypothetical and it is not a network outage. Google served a
 * `woff2` URL for Orbitron that **404s** — the CSS was fetched successfully and
 * the file it pointed at did not exist. Which URL you get depends on the
 * `User-Agent`, and Google emits several spellings of the same face: two of them
 * answered 200 and the one the deploy was handed answered 404. So it is not
 * something a retry, a longer timeout or a pinned version fixes, and it can
 * recur on any of the twelve at any time, for a deploy carrying no font change
 * at all.
 *
 * Self-hosting is the whole fix: the files are in the repository, so a build
 * makes no request to anybody and the same commit produces the same bundle
 * whatever Google is serving that morning. It is also what `next/font/google`
 * was doing *for* us — it self-hosts the files it downloads, so nothing about
 * what the browser fetches changes. What changed is only *when* the download
 * happens: once, by hand, rather than on every build. `README.md` beside these
 * files records where each came from and how to refresh one.
 *
 * **The emitted CSS was diffed against the loader's, and Geist and Geist Mono
 * come out identical** — same five and six subsets, same `unicode-range`s, same
 * `100 900` axis, same `display: swap`, same one-preload-per-family. Two things
 * genuinely differ, and both are stated rather than smoothed over:
 *
 * - **Orbitron is one `@font-face` where it was three.** See its own note below;
 *   the three fixed weights were always three instances of one variable file.
 * - **The fallback metrics move by a point or two.** `next/font/google` reads
 *   `ascent-override`/`descent-override`/`size-adjust` from a table keyed on the
 *   *whole* family, and `next/font/local` measures the file it is given with
 *   fontkit — which here is the latin subset, so `size-adjust` comes out 104.76%
 *   → 106.28% for Geist, 134.59% → 131.49% for Geist Mono, 124.05% → 126.4% for
 *   Orbitron. Those numbers only scale the *fallback* face during the swap
 *   window, so what shifts is how closely Arial stands in for a millisecond
 *   before the real font paints. It is a wash rather than a regression — the
 *   measurement is of the glyphs actually being substituted — but it is a real
 *   difference and worth knowing before blaming a layout shift on something else.
 *
 * ---
 *
 * **Every option below is spelled as a literal, and that is a hard requirement
 * rather than a style.** Turbopack does not *run* this module to find the font
 * calls — it parses them, so an option whose value is an identifier is not
 * resolved to the identifier's value, it is **dropped**. A shared
 * `const LATIN = "U+0000-00FF, …"` referenced as `value: LATIN` reaches the
 * loader as `{"prop":"unicode-range"}` with no value at all, and the build fails
 * on `missing field \`value\`` pointing at a Turbopack-internal import. The same
 * goes for a helper that wraps `localFont()` and takes the ranges as arguments,
 * which is the obvious way to write this file and the first thing that has to be
 * undone.
 *
 * So the twelve calls are twelve literals, repetition and all. What keeps that
 * safe is `fonts.test.ts` beside this file: it reads this source and checks
 * every range against one table, so two spellings of one subset are a failing
 * test rather than a family that silently renders half its characters from the
 * fallback.
 *
 * ---
 *
 * **A face is named after the identifier it is assigned to, and the subsets have
 * to spell that identifier rather than the font's real name.** `next/font/local`
 * derives the `font-family` from the variable name at the call site — `export
 * const geistSans` makes the family `geistSans` — and, crucially, it points the
 * CSS variable at *that* name: `--font-geist-sans: "geistSans", "geistSans
 * Fallback"`. Declaring a prettier `font-family: "Geist"` on the call does
 * change the `@font-face`, and it does **not** change the variable, so the two
 * stop referring to the same thing and every body glyph on the site quietly
 * renders in Arial. It fails silently and it fails everywhere — the page still
 * lays out, the font is still downloaded, and nothing in the build says a word.
 *
 * The three primary calls therefore declare no `font-family` at all and let the
 * loader name them, and each subset declares that generated name to join the
 * family. What that costs is a devtools font panel reading `geistSans` instead
 * of `Geist`; what it buys is that the variable and the face cannot disagree.
 * The agreement between a primary's identifier and its subsets' declarations is
 * pinned in `fonts.test.ts`, since renaming an export is otherwise a silent way
 * to orphan four files.
 */

/**
 * The body face. `--font-geist-sans` is what `globals.css` resolves.
 *
 * Both body faces are variable fonts over Sleeper's whole weight axis
 * (`100 900`), which is what lets one file per subset serve every `font-*`
 * utility in the app.
 *
 * It declares no `font-family`, so the loader names the face `geistSans` after
 * this identifier and points `--font-geist-sans` at the same name — see the note
 * above on why declaring a prettier one silently breaks that link. The subsets
 * below spell `geistSans` to join it.
 */
export const geistSans = localFont({
  src: "./geist-latin.woff2",
  weight: "100 900",
  style: "normal",
  display: "swap",
  variable: "--font-geist-sans",
  declarations: [
    { prop: "unicode-range", value: "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD" },
  ],
});

/**
 * The non-latin subsets of Geist.
 *
 * Latin is the only one any of this app's own copy needs. These are here for
 * what Sleeper sends: a league name, a team name and a display name are all free
 * text somebody typed, so an account named in Polish or Cyrillic is a real row
 * on a real page.
 *
 * Three things each of them says, and each is the opposite of what the latin
 * call says. They are **not preloaded**, because a page that never renders one
 * of these characters must not spend a request finding that out — which is
 * exactly the split `subsets: ["latin"]` bought under the Google loader. They
 * **declare no variable and no fallback metrics** (`adjustFontFallback: false`),
 * because those are facts about the family and the latin call already states
 * them; a second set would be a second answer to one question. And they exist
 * only for their `@font-face`, which is global once this module's CSS is on the
 * page — nothing wears a class of theirs, since a subset is selected by
 * `unicode-range` and never by markup.
 *
 * **The `unicode-range`s are verbatim from Google's own CSS and are load-bearing
 * rather than decorative.** Two `@font-face` rules for one family, weight and
 * style with no range between them are not two subsets — they are the same
 * declaration twice, and the last one wins, so the browser would download
 * whichever file came last and render the other subset's characters from the
 * fallback.
 */
const geistLatinExt = localFont({
  src: "./geist-latin-ext.woff2",
  weight: "100 900",
  style: "normal",
  display: "swap",
  preload: false,
  adjustFontFallback: false,
  declarations: [
    { prop: "font-family", value: "geistSans" },
    { prop: "unicode-range", value: "U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF" },
  ],
});

const geistCyrillic = localFont({
  src: "./geist-cyrillic.woff2",
  weight: "100 900",
  style: "normal",
  display: "swap",
  preload: false,
  adjustFontFallback: false,
  declarations: [
    { prop: "font-family", value: "geistSans" },
    { prop: "unicode-range", value: "U+0301, U+0400-045F, U+0490-0491, U+04B0-04B1, U+2116" },
  ],
});

const geistCyrillicExt = localFont({
  src: "./geist-cyrillic-ext.woff2",
  weight: "100 900",
  style: "normal",
  display: "swap",
  preload: false,
  adjustFontFallback: false,
  declarations: [
    { prop: "font-family", value: "geistSans" },
    { prop: "unicode-range", value: "U+0460-052F, U+1C80-1C8A, U+20B4, U+2DE0-2DFF, U+A640-A69F, U+FE2E-FE2F" },
  ],
});

const geistVietnamese = localFont({
  src: "./geist-vietnamese.woff2",
  weight: "100 900",
  style: "normal",
  display: "swap",
  preload: false,
  adjustFontFallback: false,
  declarations: [
    { prop: "font-family", value: "geistSans" },
    { prop: "unicode-range", value: "U+0102-0103, U+0110-0111, U+0128-0129, U+0168-0169, U+01A0-01A1, U+01AF-01B0, U+0300-0301, U+0303-0304, U+0308-0309, U+0323, U+0329, U+1EA0-1EF9, U+20AB" },
  ],
});

/**
 * The mono face. Nothing reads `--font-geist-mono` today; it is kept because
 * dropping a registered variable is a change to the theme rather than to this
 * build fix.
 */
export const geistMono = localFont({
  src: "./geist-mono-latin.woff2",
  weight: "100 900",
  style: "normal",
  display: "swap",
  variable: "--font-geist-mono",
  declarations: [
    { prop: "unicode-range", value: "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD" },
  ],
});

/**
 * Geist Mono's non-latin subsets, on the same terms as Geist's above. It
 * publishes one Geist does not — `symbols2`, the box-drawing block — which is
 * kept for the reason the rest are: it is what the Google loader was shipping,
 * and this change is not the place to decide a face needs less of itself.
 */
const geistMonoLatinExt = localFont({
  src: "./geist-mono-latin-ext.woff2",
  weight: "100 900",
  style: "normal",
  display: "swap",
  preload: false,
  adjustFontFallback: false,
  declarations: [
    { prop: "font-family", value: "geistMono" },
    { prop: "unicode-range", value: "U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF" },
  ],
});

const geistMonoCyrillic = localFont({
  src: "./geist-mono-cyrillic.woff2",
  weight: "100 900",
  style: "normal",
  display: "swap",
  preload: false,
  adjustFontFallback: false,
  declarations: [
    { prop: "font-family", value: "geistMono" },
    { prop: "unicode-range", value: "U+0301, U+0400-045F, U+0490-0491, U+04B0-04B1, U+2116" },
  ],
});

const geistMonoCyrillicExt = localFont({
  src: "./geist-mono-cyrillic-ext.woff2",
  weight: "100 900",
  style: "normal",
  display: "swap",
  preload: false,
  adjustFontFallback: false,
  declarations: [
    { prop: "font-family", value: "geistMono" },
    { prop: "unicode-range", value: "U+0460-052F, U+1C80-1C8A, U+20B4, U+2DE0-2DFF, U+A640-A69F, U+FE2E-FE2F" },
  ],
});

const geistMonoVietnamese = localFont({
  src: "./geist-mono-vietnamese.woff2",
  weight: "100 900",
  style: "normal",
  display: "swap",
  preload: false,
  adjustFontFallback: false,
  declarations: [
    { prop: "font-family", value: "geistMono" },
    { prop: "unicode-range", value: "U+0102-0103, U+0110-0111, U+0128-0129, U+0168-0169, U+01A0-01A1, U+01AF-01B0, U+0300-0301, U+0303-0304, U+0308-0309, U+0323, U+0329, U+1EA0-1EF9, U+20AB" },
  ],
});

const geistMonoSymbols2 = localFont({
  src: "./geist-mono-symbols2.woff2",
  weight: "100 900",
  style: "normal",
  display: "swap",
  preload: false,
  adjustFontFallback: false,
  declarations: [
    { prop: "font-family", value: "geistMono" },
    { prop: "unicode-range", value: "U+2000-2001, U+2004-2008, U+200A, U+23B8-23BD, U+2500-259F" },
  ],
});

/**
 * Orbitron is the display face — the geometric, "instrument panel" letterform
 * every page's title and every named row wears (a tool card, a league, a share,
 * a trade's league). It stopped at the tools page once; carrying it into the
 * lists is what makes them read as the same instrument. Body copy stays on
 * Geist. Exposed as `--font-orbitron`, wired to `font-display` in globals.css.
 *
 * **One file and one range, where the Google loader wrote three rules.** It
 * asked for weights 500, 600 and 700, and Google answered with three
 * `@font-face` declarations pointing at the *same* variable `woff2` — so the
 * file was always one file and the three fixed weights were three instances cut
 * out of it. `500 700` is that range spelled once, and it renders those three
 * identically because they are the same instances of the same axis. The range
 * stops where the app's use of it stops rather than at the file's own 400–900,
 * which is what keeps a stray `font-black` clamping to 700 exactly as it did
 * before.
 *
 * Orbitron publishes only a latin subset, so it has no siblings.
 */
export const orbitron = localFont({
  src: "./orbitron-latin.woff2",
  weight: "500 700",
  style: "normal",
  display: "swap",
  variable: "--font-orbitron",
  declarations: [
    { prop: "unicode-range", value: "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD" },
  ],
});

/**
 * The subset faces are named here so nothing prunes the calls that emit their
 * `@font-face` rules, and so neither TypeScript nor eslint reads them as dead.
 * They carry no class of their own by design, which is exactly what makes them
 * look unused.
 */
export const SUBSET_FACES = [
  geistLatinExt,
  geistCyrillic,
  geistCyrillicExt,
  geistVietnamese,
  geistMonoLatinExt,
  geistMonoCyrillic,
  geistMonoCyrillicExt,
  geistMonoVietnamese,
  geistMonoSymbols2,
];
