import type { Metadata } from "next";
import { Geist } from "next/font/google";
import "./globals.css";

// The one loaded face, wired to `--font-display` in `globals.css`. Geist Mono
// was loaded here too and mapped by nothing — two families fetched, subset and
// preloaded on every page load for markup that never asked for a monospace.
const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "The Lab",
  description: "Fantasy football tools for Sleeper leagues.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
