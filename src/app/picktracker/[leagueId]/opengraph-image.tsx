import { ImageResponse } from "next/og";

import { PicktrackerOgCard, IdentityOgCard } from "@/features/tools/og/card";
import { OG_CACHE_CONTROL, OG_FONTS, readLeagueAvatar } from "@/shared/og";
import { readPicktrackerCard } from "@/shared/picktracker";

export const alt = "Rookie pick tracker on The Lab";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/**
 * An hour, **because the card holds no reading**.
 *
 * That is the whole payoff of this design: with the next pick or a countdown
 * on it, this would have to be short-lived and would *still* be stale in every
 * message already posted, since a client scrapes an unfurl once and caches the
 * PNG against the URL. Everything the card draws is fixed when the draft is set
 * up. Adding a live figure means changing this number and accepting that the
 * number cannot save you.
 */
export const revalidate = 3600;

/**
 * `revalidate` above is the declaration; this is what actually reaches a
 * scraper. See {@link OG_CACHE_CONTROL} for why the two are both needed.
 */
const IMAGE = {
  ...size,
  fonts: OG_FONTS,
  headers: { "cache-control": OG_CACHE_CONTROL },
};

/**
 * The card for a tracked draft, or the app's identity card.
 *
 * **This route must never throw.** A 500 here is not a broken image — the
 * client shows no preview at all and falls back to a bare URL, which is
 * strictly worse than a card that names the app and not the league. So every
 * arm lands on {@link IdentityOgCard}: an unknown league, an unreachable
 * Sleeper and a league with no placeholder draft all come back null from
 * `readPicktrackerCard`, and anything else is caught here.
 *
 * The runtime is Node's, by default rather than by declaration. Nothing here
 * wants edge, the fonts are read off disk, and the default keeps this route in
 * the same environment as the rest of the app.
 */
export default async function Image({
  params,
}: {
  params: Promise<{ leagueId: string }>;
}) {
  try {
    const { leagueId } = await params;
    const card = await readPicktrackerCard(leagueId);
    if (card) {
      const avatar = await readLeagueAvatar(card.league.avatar_url);
      return new ImageResponse(
        <PicktrackerOgCard card={card} avatar={avatar} />,
        IMAGE,
      );
    }
  } catch (error) {
    console.error("[og] picktracker card failed; drawing the identity card", error);
  }

  return new ImageResponse(<IdentityOgCard />, IMAGE);
}
