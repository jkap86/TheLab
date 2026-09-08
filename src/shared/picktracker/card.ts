/**
 * What the Open Graph card needs: the league, and the three fixed facts about
 * the draft it is running.
 *
 * **It is a separate read from {@link trackPlaceholderDraft}, deliberately.**
 * That one fetches the picks and the members because the board is made of
 * them; this one is two calls and never touches either, because a scraper
 * hitting the image route wants a league name and a shape, not a board. It
 * also reaches no database and takes no pool connection — two Sleeper reads
 * through the one client, so the process-wide bound in `sleeper/limiter.ts`
 * still applies.
 *
 * **Nothing here is a reading.** An unfurl is scraped once and cached hard
 * against the URL, so every field has to be fixed at draft setup — see
 * {@link PicktrackerCardPayload}, which is where that argument lives.
 *
 * No cache-busting token, for the same reason: the card is an hour stale by
 * design, so a CDN copy of the league is exactly what it wants. `fresh` is for
 * the one path a reader drives, and nobody drives this one.
 */
import { getLeague, getLeagueDrafts, sleeperAvatarUrl } from "@/shared/sleeper";
import type { PicktrackerCardPayload } from "@/shared/contract";

import {
  findPlaceholderDraft,
  leagueTeamCount,
  placeholderRounds,
} from "./picks";

/**
 * The card's facts for a league, or null where there is no card to draw.
 *
 * **Null is one answer with three causes, and the caller acts on all three the
 * same way** — it draws the identity card instead. An unknown league, a
 * Sleeper that cannot be reached, and a league with no placeholder draft are
 * different facts, but none of them lets this card make its claim, and a route
 * that told them apart would only be choosing between three ways to say
 * nothing. What it must never do is throw: a failed image route is not a
 * broken image, it is no preview at all.
 *
 * The third cause is the one worth stating. A league with no kicker slot has
 * nothing for this tool to decode, so naming it under a draft line that
 * describes no draft would be a confident card for a page that will show an
 * error. The league's name alone is true and is not what the design draws.
 */
export async function readPicktrackerCard(
  leagueId: string,
): Promise<PicktrackerCardPayload | null> {
  try {
    const [league, drafts] = await Promise.all([
      getLeague(leagueId),
      getLeagueDrafts(leagueId),
    ]);
    if (!league) return null;

    const draft = findPlaceholderDraft(drafts);
    if (!draft) return null;

    return {
      league: {
        name: league.name,
        // Full size: the card lights it at 112px in a ring, where the board's
        // managers are 20px thumbs.
        avatar_url: sleeperAvatarUrl(league.avatar),
      },
      season: draft.season,
      // Both readings live in `picks.ts` — pure, and therefore reachable by
      // Node's own test runner, which cannot resolve this file's `@/`
      // imports. Each carries the argument for why it is not the obvious
      // spelling: `leagueTeamCount` is not `draftTeamCount`, and
      // `placeholderRounds` is not `settings.rounds`.
      teams: leagueTeamCount(draft, league),
      rounds: placeholderRounds(draft),
    };
  } catch {
    return null;
  }
}
