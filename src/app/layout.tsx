import type { Metadata } from "next";
import { Geist, Geist_Mono, Orbitron } from "next/font/google";
import "./globals.css";

import { SiteHeader } from "@/features/shared";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Orbitron is the display face — the geometric, "instrument panel" letterform
// the tools page leads with (wordmark and tool names). Only the weights that
// page uses are loaded. Exposed as `--font-orbitron`, wired to the
// `font-display` utility in globals.css; body copy stays on Geist.
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
        {/* The bar takes no slot: it reads the route itself, names the tool you
            are in, and holds the menu that moves between them. */}
        <SiteHeader />
        {children}
      </body>
    </html>
  );
}
