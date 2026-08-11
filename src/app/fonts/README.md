# Self-hosted font files

These twelve `woff2` files are the app's three faces. They are checked in so a
build makes **no** request to Google — see the note at the top of `index.ts` for
why (short version: `next/font/google` downloads them at build time, and Google
served a `woff2` URL for Orbitron that 404s, which fails the whole build with an
error naming a Turbopack internal rather than a font).

They are byte-for-byte what `next/font/google` would have downloaded: the same
subset files off `fonts.gstatic.com`, split by the same `unicode-range`s.

## Where each file came from

Google serves a *different* set of URLs per `User-Agent`. The ones below are
what `next/font/google` itself asks for — it sends a fixed Chrome 104 string
(`node_modules/next/dist/compiled/@next/font/dist/google/fetch-resource.js`) to
be sure of getting `woff2` rather than `woff` or `ttf`.

```sh
UA='Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/104.0.0.0 Safari/537.36'

curl -A "$UA" 'https://fonts.googleapis.com/css2?family=Geist:wght@100..900&display=swap'
curl -A "$UA" 'https://fonts.googleapis.com/css2?family=Geist+Mono:wght@100..900&display=swap'
curl -A "$UA" 'https://fonts.googleapis.com/css2?family=Orbitron:wght@500;600;700&display=swap'
```

Each response is a run of `@font-face` blocks, one per subset, with the subset's
name in a comment above it and its `unicode-range` inside it. The file for a
subset is the `src: url(…)` of its block.

| File | Family | Subset | Source at the time of writing |
| --- | --- | --- | --- |
| `geist-latin.woff2` | Geist | latin | `…/s/geist/v5/gyByhwUxId8gMEwcGFWNOITd.woff2` |
| `geist-latin-ext.woff2` | Geist | latin-ext | `…/s/geist/v5/gyByhwUxId8gMEwSGFWNOITddY4.woff2` |
| `geist-cyrillic.woff2` | Geist | cyrillic | `…/s/geist/v5/gyByhwUxId8gMEwYGFWNOITddY4.woff2` |
| `geist-cyrillic-ext.woff2` | Geist | cyrillic-ext | `…/s/geist/v5/gyByhwUxId8gMEwRGFWNOITddY4.woff2` |
| `geist-vietnamese.woff2` | Geist | vietnamese | `…/s/geist/v5/gyByhwUxId8gMEwTGFWNOITddY4.woff2` |
| `geist-mono-latin.woff2` | Geist Mono | latin | `…/s/geistmono/v6/or3nQ6H-1_WfwkMZI_qYFrcdmhHkjko.woff2` |
| `geist-mono-latin-ext.woff2` | Geist Mono | latin-ext | `…/s/geistmono/v6/or3nQ6H-1_WfwkMZI_qYFrkdmhHkjkotbA.woff2` |
| `geist-mono-cyrillic.woff2` | Geist Mono | cyrillic | `…/s/geistmono/v6/or3nQ6H-1_WfwkMZI_qYFrMdmhHkjkotbA.woff2` |
| `geist-mono-cyrillic-ext.woff2` | Geist Mono | cyrillic-ext | `…/s/geistmono/v6/or3nQ6H-1_WfwkMZI_qYFrodmhHkjkotbA.woff2` |
| `geist-mono-vietnamese.woff2` | Geist Mono | vietnamese | `…/s/geistmono/v6/or3nQ6H-1_WfwkMZI_qYFrgdmhHkjkotbA.woff2` |
| `geist-mono-symbols2.woff2` | Geist Mono | symbols2 | `…/s/geistmono/v6/or3nQ6H-1_WfwkMZI_qYFg08vz7MhEIVVeA.woff2` |
| `orbitron-latin.woff2` | Orbitron | latin | `…/s/orbitron/v35/yMJRMIlzdpvBhQQL_Qq7dy1biN15.woff2` |

**Those URLs are not stable and are recorded as provenance, not as an
interface.** They carry a content hash and a family version (`v5`, `v6`, `v35`),
so Google retires them when it re-cuts a font — which is the same mutability
that broke the build in the first place. Re-derive them from the CSS above
rather than fetching a row of this table.

All three families are **variable** fonts over a weight axis, so one file per
subset covers every weight the app uses. Orbitron's three requested weights
(500/600/700) resolved to a single variable file even under `next/font/google`,
which is why `index.ts` declares the range once instead of three fixed weights.

## Refreshing them

Only worth doing when Google re-cuts a face and you want the new drawing —
nothing here goes stale on its own, and a build has no opinion about their age.

1. Re-run the three `curl`s above.
2. For each `@font-face` block, download its `src` URL to the filename in the
   table.
3. If a subset has appeared or gone, add or remove its `localFont()` call in
   `index.ts`; if a `unicode-range` changed, update the call **and** the table in
   `fonts.test.ts`. The ranges must stay exactly Google's, or characters fall to
   a file that does not contain them.
4. `npm test` — `fonts.test.ts` checks the files on disk against the
   declarations, the ranges against one table, the preload split, and that each
   family's subsets name the same face. Then `npm run build` and confirm the
   emitted rules:
   ```sh
   cat .next/static/chunks/*.css | tr '}' '}\n' | grep -o '@font-face{[^}]*}'
   ```

The `@font-face` names there are **`geistSans`, `geistMono` and `orbitron`**, not
the family names in the table above: `next/font/local` names a face after the
identifier it is assigned to, and it has to, because that is also the name the
CSS variable points at. The reasoning — and the silent way it breaks if you
"tidy" it — is at the top of `index.ts`.

## Licence

All three are under the [SIL Open Font License 1.1](https://openfontlicense.org),
which is what permits redistributing them in this repository. Geist and Geist
Mono are © Vercel; Orbitron is © Matt McInerney. The OFL requires the licence to
travel with the files — it is `OFL.txt` in each family's download on
[fonts.google.com](https://fonts.google.com), and the upstream sources are
[vercel/geist-font](https://github.com/vercel/geist-font) and
[theleagueof/orbitron](https://github.com/theleagueof/orbitron).
