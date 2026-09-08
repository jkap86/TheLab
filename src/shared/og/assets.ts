/**
 * What an Open Graph card needs off disk, and the one thing it needs off the
 * network.
 *
 * **`next/font` does not reach inside `ImageResponse`.** Satori is handed font
 * bytes or it renders nothing, so the two faces the cards use are read from
 * `public/og/` here rather than resolved through the loaders `layout.tsx`
 * configures. They are read **once at module scope**: neither depends on
 * request data, and a per-request read would be two disk hits on every scrape.
 *
 * The `ImageResponse` bundle — JSX, fonts, images and every other asset — is
 * capped at 500KB, which is why nothing in this folder is shipped at full
 * size. See {@link OG_FONTS} and {@link WORDMARK_34} for what each costs.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

const asset = (name: string) => join(process.cwd(), "public", "og", name);

/**
 * How long a card may be held, said to whoever is holding it.
 *
 * **`export const revalidate` does not reach the client, and on the league
 * card it does not cache anything either.** It governs Next's own ISR store,
 * and a metadata image route on a *dynamic* segment with no
 * `generateStaticParams` is not in that store at all — measured, with
 * identical code either side: a static-path image route with
 * `revalidate = 3600` served in 4ms on every hit after the first, and the same
 * route under `[id]` re-ran its full 800ms of work every time. Next then sends
 * `max-age=0, must-revalidate` regardless, which is the opposite of what an
 * unfurl wants.
 *
 * So the hour is stated here as well. It is safe for exactly the reason the
 * design gives for the number: nothing on either card is a reading. Add a live
 * figure and this comes down — and the card is still wrong in every message
 * already posted, which is the argument for not adding one.
 */
export const OG_CACHE_CONTROL =
  "public, max-age=3600, stale-while-revalidate=86400";

/**
 * Geist SemiBold and Geist Mono, subset and unhinted.
 *
 * **`.ttf`, where the handoff says `.woff`.** Next's own reference states the
 * preference — "only `ttf`, `otf` and `woff` font formats are supported. To
 * maximize the font parsing speed, `ttf` or `otf` are preferred over `woff`" —
 * and `woff2`, which is what `next/font` serves the app, is not supported at
 * all. So the source is the `geist` package's own TTFs.
 *
 * **The subset keeps Geist's whole character map and drops the hinting**,
 * which takes the pair from 277KB to 110KB. That is a wider subset than the
 * handoff's "latin" and it is the safer one, for the reason the handoff itself
 * gives when it asks for a system fallback behind the league name: the name is
 * user data. Satori has no system fallback — it knows the fonts it is handed
 * and nothing else — so a glyph outside the subset is not a substituted glyph,
 * it is a blank. Keeping the whole map makes the card's coverage the font's
 * own rather than a range list somebody chose, which is one fewer thing to be
 * wrong about. Hinting goes because Satori rasterises outlines and never reads
 * it.
 *
 * Emoji are not in Geist and do not need to be: `ImageResponse` resolves them
 * through its own `emoji` option, which defaults to Twemoji.
 */
export const OG_FONTS = [
  {
    name: "Geist",
    data: readFileSync(asset("geist-semibold.ttf")),
    weight: 600 as const,
    style: "normal" as const,
  },
  {
    name: "Geist Mono",
    data: readFileSync(asset("geist-mono-regular.ttf")),
    weight: 400 as const,
    style: "normal" as const,
  },
];

/**
 * The engraved wordmark, pre-rendered, as a data URI.
 *
 * **Only the type is baked, and that is narrower than the handoff's "pre-render
 * the wordmark plate".** What Satori cannot draw is precisely two things — the
 * chrome gradient clipped to the glyphs (`background-clip: text`) and the
 * `drop-shadow()` filters that give it depth — so those are what became an
 * asset. The plate, its bezel, the milled groove and the flask are gradients,
 * borders and inline SVG, all of which Satori renders, so they stay live and
 * composite against the housing they sit on.
 *
 * That split is also what keeps the card inside its budget. The whole plate
 * came to 276KB at the home card's size, because a plate is a large area of
 * smooth gradient and PNG compresses that badly; quantising it to 128 colours
 * got it to 42KB and put visible contour rings through the teal halo. The type
 * alone is 85KB for both sizes at full colour, because its alpha is nearly
 * binary.
 *
 * **The wide teal halo is not in the asset either** — it is the part that bands
 * — so the card draws it live as a radial gradient behind the type. What is
 * baked is the crisp half: the chrome face, the white top lip and the dark
 * extrusion steps.
 *
 * Each image carries a **12px bleed on every side** at 1×, because the lip and
 * the drop overflow the type's own layout box. A caller therefore draws the
 * image at {@link WORDMARK_34}`.width`/`.height` but reserves only
 * `.box` — the type's layout box — offsetting the image by `-BLEED`. Getting
 * that wrong puts the plate 12px out.
 *
 * **There is no script that regenerates these**, which is the trade the app
 * icon already makes and documents: a redrawn wordmark is a re-exported asset.
 * The tokens they bake — `--chrome-face`, `--chrome-extrude-shadow` and the
 * type's size and tracking — live in `globals.css` and `lab-wordmark.tsx`, and
 * a change there is silently absent from every unfurl until these are redone.
 * The recipe, which is four steps and two Chromium traps:
 *
 * 1. Take the wordmark markup from the design bundle's `og-card-3a.html` — the
 *    two stacked spans, extrusion under gradient-clipped face — at 34px and at
 *    96px, on a transparent body with 60px of padding. Drop the two *wide teal
 *    glows* (`0 0 34px` on the extrusion, `drop-shadow(0 0 22px)` on the face):
 *    they are what makes the PNG heavy and what bands when it is quantised, and
 *    the card draws that halo live instead.
 * 2. **Serve it over HTTP**, not `file://`. A `file://` page may not fetch a
 *    `file://` `@font-face`, and Chromium says nothing — the type renders in a
 *    fallback face or not at all.
 * 3. Screenshot with `--force-device-scale-factor=3 --window-size=1400,600
 *    --default-background-color=00000000 --hide-scrollbars`. **The window must
 *    stay well over ~300px wide**: below that headless Chromium paints an empty
 *    frame of the size asked for, again silently, so the asset cannot simply be
 *    rendered at its own dimensions.
 * 4. Crop to the type's layout box — which starts at the 120px of page padding,
 *    at 3× — expanded by the bleed, then downsample to 2×. The box is `.box`
 *    below; measure it by re-rendering the same span with an opaque background
 *    and taking the alpha bounding box.
 */
const WORDMARK_BLEED = 12;

const wordmark = (
  file: string,
  boxWidth: number,
  boxHeight: number,
  width: number,
  height: number,
) => ({
  /** A data URI: Satori resolves no relative path, having no origin to resolve it against. */
  src: `data:image/png;base64,${readFileSync(asset(file)).toString("base64")}`,
  /** What to draw the image at — the type's box plus the bleed on all four sides. */
  width,
  height,
  /** The type's own layout box, which is what the plate lays out around. */
  box: { width: boxWidth, height: boxHeight },
  /** How far to pull the image up and left of that box. */
  bleed: WORDMARK_BLEED,
});

/** "The Lab" at 34px — the picktracker card's foot plate. */
export const WORDMARK_34 = wordmark("wordmark-34.png", 162, 34, 186, 58);

/** "The Lab" at 96px — the identity card's hero plate. */
export const WORDMARK_96 = wordmark("wordmark-96.png", 456, 96, 480, 120);

/** How long a league avatar gets before the card gives up and draws the initial. */
const AVATAR_TIMEOUT_MS = 2_000;

/**
 * A league avatar as a data URI, or null.
 *
 * **Fetched here rather than handed to Satori as a URL**, and the timeout is
 * why. Satori will fetch an `<img src>` itself during render and gives no way
 * to bound how long it waits, so a Sleeper CDN that hangs would hang the card —
 * and a card that never renders is not a broken image, it is no preview at all.
 * Fetched here, a slow or missing avatar costs the card its picture and nothing
 * else: the caller draws the league's initial instead, which is
 * `LeagueMark`'s own documented fallback and is drawn *lit*, because an unlit
 * letter inside a lit ring reads as a failed image rather than as a league
 * with no avatar on file.
 *
 * Never throws, for the same reason.
 */
export async function readLeagueAvatar(
  url: string | null,
): Promise<string | null> {
  if (!url) return null;
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(AVATAR_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    const type = response.headers.get("content-type") ?? "image/png";
    if (!type.startsWith("image/")) return null;
    const bytes = Buffer.from(await response.arrayBuffer());
    return `data:${type};base64,${bytes.toString("base64")}`;
  } catch {
    return null;
  }
}
