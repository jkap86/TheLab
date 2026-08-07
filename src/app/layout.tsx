import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Orbitron } from "next/font/google";
import "./globals.css";

import { AmbientBackdrop, SiteHeader } from "@/features/shared";
import { QueryProvider } from "./providers/query-provider";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Orbitron is the display face — the geometric, "instrument panel" letterform
// every page's title and every named row wears (a tool card, a league, a share,
// a trade's league). It stopped at the tools page once; carrying it into the
// lists is what makes them read as the same instrument. Body copy stays on
// Geist. Exposed as `--font-orbitron`, wired to `font-display` in globals.css.
const orbitron = Orbitron({
  variable: "--font-orbitron",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
});

/**
 * `maximumScale: 1` is here for one reason: iOS Safari zooms the page in when a
 * field is focused whose font-size is under 16px, and it does not zoom back out
 * — so tapping a filter chip, a search box or a date lens left the reader
 * scrolled sideways in a magnified page, having to pinch their way back before
 * the next press.
 *
 * The other cure is a 16px floor on every form control, and it is the wrong one
 * *here* rather than in general. These fields are measured instruments: the
 * lookback panel's two lenses come to 282px of the 332 a 390px screen leaves
 * (the arithmetic is written out beside them, per device-pixel-ratio, because a
 * native date control moves ~6px a step), a rule row's value field is a 52px
 * box in a half-bay, and the drawer's filter row is a wrap of `text-xs` chips
 * sized to leave the board room. A floor would reflow all of it on exactly the
 * width the cap exists for, so the type stays as drawn and the page declines to
 * scale instead.
 *
 * What it costs is stated plainly: `userScalable` is deliberately left unset —
 * this asks browsers not to scale *on their own*, never to refuse the reader —
 * and iOS has honoured pinch-zoom past `maximum-scale` since iOS 10, so the
 * gesture survives where the bug was. Chrome on Android does respect the cap
 * and loses pinch-zoom by default (its "Force enable zoom" setting overrides
 * it), and Android has no focus zoom to fix, so that browser pays for a fix it
 * did not need. On a page of 10px readouts that is a real trade, and the way
 * out if it ever matters is scoping the cap to the platform that zooms — which
 * needs either a dynamic render (`headers()`, which would un-prerender every
 * page here) or UA sniffing whose misses are invisible until someone reports
 * the zoom again. Neither is worth it for a cap the affected platform ignores
 * when a reader pinches.
 */
export const viewport: Viewport = {
  // Both restated because defining this export replaces Next's default meta
  // rather than extending it, and `width=device-width, initial-scale=1` is what
  // every layout in the app is drawn against.
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export const metadata: Metadata = {
  title: {
    default: "The Lab",
    template: "%s · The Lab",
  },
  description:
    "Fantasy football tools for Sleeper leagues: manager league views, " +
    "rosters and standings, and KeepTradeCut dynasty values.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${orbitron.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {/* One query cache for the session, wrapped here rather than around the
            manager tabs: navigating out to another tool and back would otherwise
            discard everything those tabs had loaded. */}
        <QueryProvider>
          {/* Behind every page rather than behind the tools page alone: the glows
              are what made that grid read as a different app from the tool it
              opened. Fixed and at `-z-10`, so nothing is laid out against it. */}
          <AmbientBackdrop />
          {/* The bar takes no slot: it reads the route itself, names the tool you
              are in, and holds the menu that moves between them. */}
          <SiteHeader />
          {children}
        </QueryProvider>
      </body>
    </html>
  );
}
