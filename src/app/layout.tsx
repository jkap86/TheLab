import type { Metadata } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import { RackControlsProvider, THEME_BOOT_SCRIPT } from "@/features/shared";
import { AppRack } from "@/features/tools";
import { resolveSiteUrl } from "@/shared/og/site-url";

import "./globals.css";

// Two faces, both mapped: `--font-display` for the rank figures, the standing
// bays and the league names, `--font-mono` for every label, key legend and
// figure well. IBM Plex since the expanded-card pass — Geist before it — and
// nothing about the type *system* moved with the families: the components only
// ever name `--font-display` and `--font-mono`, so the swap is these two calls
// and the two `@theme inline` entries in `globals.css`.
//
// Plex Sans ships a variable face, so it takes no `weight` list and the 400,
// 500 and 600 the console sets come off one file. Plex Mono has no variable
// axis, so its two weights are named — a static Google face with no `weight`
// is a build error rather than a default.
//
// `src/shared/og/assets.ts` still renders the share images in Geist off the
// `geist` package's own TTFs. That is deliberate for now: `ImageResponse`
// reads font *files*, not `next/font`, and an OG card is not the console —
// see that file. The two move together when the OG image is redrawn.
const plexSans = IBM_Plex_Sans({
  variable: "--font-plex-sans",
  subsets: ["latin"],
});

const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  weight: ["400", "500"],
  subsets: ["latin"],
});

/**
 * The origin every generated URL in `metadata` is resolved against.
 *
 * **Without it Next emits a relative `og:image`**, and several scrapers —
 * iMessage among them — resolve that against the wrong origin and show no
 * preview at all. It is the one piece of metadata whose absence is invisible
 * from inside the app.
 *
 * **`SITE_URL` belongs in the build environment as much as the runtime one**:
 * a prerendered page writes its `<meta>` at build time, so the origin is baked
 * in then. `resolveSiteUrl` says so when it is missing.
 *
 * `resolveSiteUrl` is deep-imported rather than taken from `@/shared/og`,
 * which that barrel explains: the barrel reads the OG fonts off disk at module
 * scope, and this layout is on every page's path.
 */
const site = resolveSiteUrl(process.env, process.env.NODE_ENV === "production");
if (site.warning) console.warn(`[metadata] ${site.warning}`);

export const metadata: Metadata = {
  metadataBase: new URL(site.url),
  title: "The Lab",
  description: "Fantasy football tools for Sleeper leagues.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // `suppressHydrationWarning` covers exactly one attribute: `data-theme`,
    // which the boot script below writes onto this element before React sees
    // the document. Without it React treats the attribute it did not render as
    // a mismatch, and its recovery — client-rendering from the nearest
    // boundary — throws the script's work away along with the theme.
    <html
      lang="en"
      className={`${plexSans.variable} ${plexMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        {/* Runs during HTML parsing, before the first paint. See
            `features/shared/theme.ts` for why it cannot be a component. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
      </head>
      <body className="min-h-full flex flex-col">
        {/* The rack reads the controls; the pages publish into them. Both have
            to sit under one provider, which is why it wraps here rather than
            inside either. */}
        <RackControlsProvider>
          <AppRack />
          {children}
        </RackControlsProvider>
      </body>
    </html>
  );
}
