import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { RackControlsProvider, THEME_BOOT_SCRIPT } from "@/features/shared";
import { AppRack } from "@/features/tools";

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
    // `suppressHydrationWarning` covers exactly one attribute: `data-theme`,
    // which the boot script below writes onto this element before React sees
    // the document. Without it React treats the attribute it did not render as
    // a mismatch, and its recovery — client-rendering from the nearest
    // boundary — throws the script's work away along with the theme.
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
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
