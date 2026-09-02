import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

// Two faces, both mapped: `--font-display` for everything, `--font-mono` for
// the account readout, the key legends and the section labels. Geist Mono was
// previously loaded here and mapped by nothing; it is wired up in
// `globals.css` now, so it is fetched for markup that asks for it.
const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "The Lab",
  description: "Fantasy football tools for Sleeper leagues.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
