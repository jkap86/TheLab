import type { Metadata, Viewport } from "next";
import "./globals.css";

import { AmbientBackdrop, SiteHeader } from "@/features/shared";
import { QueryProvider } from "./providers/query-provider";
// The three faces are self-hosted files rather than `next/font/google` calls,
// because that loader downloads them from Google on every build and a single
// 404 among the twelve files fails the deploy — which is what it did. The move
// is argued in `fonts/index.ts`, along with the two things it changed about the
// emitted CSS and the one that reads as tidiable and is not.
import { geistMono, geistSans, orbitron } from "./fonts";

/**
 * **Nothing here caps the scale, and the reason is that the bug it used to cap
 * is fixed at its source.**
 *
 * iOS Safari zooms the page in when a field is focused whose computed
 * `font-size` is under 16px, and it does not zoom back out — so tapping a filter
 * chip, a search box or a date lens left the reader scrolled sideways in a
 * magnified page, pinching their way back before the next press. This export
 * carried `maximumScale: 1` against that, which works by asking the browser not
 * to scale at all.
 *
 * That was a fix aimed at the symptom, and it billed the wrong reader. iOS
 * ignores the cap for a deliberate pinch and so kept its gesture; **Chrome for
 * Android honours it and loses pinch-zoom by default**, and Android has no focus
 * zoom to fix — so the one platform that paid the whole cost was the one with
 * nothing wrong with it, on a page written in 10px readouts. The old note
 * conceded that and argued the alternative was worse: a 16px floor would reflow
 * a set of instruments measured to the pixel, on exactly the widths the cap was
 * for.
 *
 * Measured rather than assumed, that turned out to be false. Every focusable
 * control is at 16px now and the boxes are within a pixel of where they were —
 * `features/shared/control-type.ts` is the floor, the table of before-and-after
 * heights, and the two places that had to give a padding back for it. So the
 * cap is gone: **`userScalable` unset and `maximumScale` unset means every
 * browser keeps pinch-zoom, and none of them has a reason to scale on its own.**
 *
 * The way this regresses is a new field written at `text-xs` because a row is
 * tight — which is why the floor is a named token with a test reading every
 * control in the tree back, rather than a habit.
 */
export const viewport: Viewport = {
  // Both restated because defining this export replaces Next's default meta
  // rather than extending it, and `width=device-width, initial-scale=1` is what
  // every layout in the app is drawn against.
  width: "device-width",
  initialScale: 1,
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
