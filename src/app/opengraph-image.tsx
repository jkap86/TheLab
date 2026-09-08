import { ImageResponse } from "next/og";

import { IdentityOgCard } from "@/features/tools/og/card";
import { OG_CACHE_CONTROL, OG_FONTS } from "@/shared/og";

export const alt = "The Lab — fantasy football tools for Sleeper leagues";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/**
 * The app's own card. Static — no read, no params, nothing that moves — so it
 * is generated once at build time and never revalidated.
 *
 * **It sits at the app root rather than under `/tools`**, which is what makes
 * it every page's card. A route segment inherits the nearest one above it, so
 * from here `/tools`, `/trades`, `/comps`, `/manager/…` and the rest all
 * unfurl as The Lab, and only `/picktracker/[leagueId]` — which declares its
 * own — does anything else. Under `/tools` it would cover one page.
 *
 * `/` itself is a 308 to `/tools` with no page of its own, so nothing scrapes
 * the root directly; the redirect is what a client follows to reach a card.
 */
export default function Image() {
  return new ImageResponse(<IdentityOgCard />, {
    ...size,
    fonts: OG_FONTS,
    headers: { "cache-control": OG_CACHE_CONTROL },
  });
}
