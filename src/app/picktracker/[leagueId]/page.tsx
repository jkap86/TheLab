import type { Metadata } from "next";

import { ConsoleGround, PageShell } from "@/features/shared";
import { PicktrackerBoard } from "@/features/picktracker";
import { readPicktrackerCard } from "@/shared/picktracker";

export const dynamic = "force-dynamic";

/**
 * The words a client shows beside the card.
 *
 * `opengraph-image.tsx` wires `og:image` itself, so what is left here is the
 * title, the description and the Twitter card — and `summary_large_image`,
 * without which X crops the 1200 × 630 into a small square.
 *
 * **A league that cannot be read is titled without one**, never guessed. That
 * is the same rule the image route draws by: `readPicktrackerCard` answers
 * null for an unknown league, an unreachable Sleeper and a league with no
 * placeholder draft alike, and never throws — so this cannot take a page down
 * either.
 *
 * It is a second read of the same two Sleeper endpoints the image route makes,
 * which is two round trips per scrape, both through the process-wide limiter.
 * If that ever shows up, memoize `readPicktrackerCard` per request the way
 * `user/memoize-manager-lookup.ts` does — same shape, same reason.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ leagueId: string }>;
}): Promise<Metadata> {
  const { leagueId } = await params;
  const card = await readPicktrackerCard(leagueId);

  return {
    title: card ? `${card.league.name} — rookie pick tracker` : "Rookie pick tracker",
    description: card
      ? `Rookie picks tracked by kicker placeholder. ${card.season} draft, ` +
        `${card.teams} teams, ${card.rounds} ` +
        `${card.rounds === 1 ? "round" : "rounds"}.`
      : "Track rookie picks selected in a draft using kickers as placeholders.",
    twitter: { card: "summary_large_image" },
  };
}

export default async function PicktrackerLeaguePage({
  params,
}: {
  params: Promise<{ leagueId: string }>;
}) {
  const { leagueId } = await params;

  return (
    <>
      <ConsoleGround />
      <PageShell width="console">
        <h1 className="mb-6 font-mono text-[length:var(--fs-11)] uppercase tracking-[0.16em] text-foreground/60">
          Pick Tracker
        </h1>
        {/* **The key is load-bearing.** Navigating league to league remounts
            with a blank slate rather than transitioning one league's board
            into another's — the rule `LineupCheckerHome` applies to a changed
            account, one grain down. */}
        <PicktrackerBoard key={leagueId} leagueId={leagueId} />
      </PageShell>
    </>
  );
}
