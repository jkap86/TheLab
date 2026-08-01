import type { Metadata } from "next";
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
