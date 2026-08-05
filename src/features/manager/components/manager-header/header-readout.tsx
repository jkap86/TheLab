import { firstKickoff } from "@/features/shared";

import { useKickoff } from "../../hooks/use-kickoff";
import { KickoffCountdown } from "./kickoff-countdown.tsx";
import { resolveKickoff } from "./manager-header.utils.ts";
import { useTick } from "./use-tick.ts";
import { WinPctGauge } from "./win-pct-gauge.tsx";

/**
 * The plate's right-hand readout: the countdown to kickoff while there is one,
 * the win-percentage dial once the season is running.
 *
 * They share the slot because they are never both worth drawing. Before kickoff
 * every league reports `0-0` and the dial is an em dash by rule — a win
 * percentage there is a claim about games nobody has played — while the clock is
 * the only moving number on the card; after kickoff the clock has nothing left
 * to count and the record is the season's own story. Giving the live one the
 * instrument is the same trade the plate already made when the season and the
 * headline count — both constants — went to its corner tabs.
 *
 * The two are the same box, so the swap costs the plate no height and the list
 * pinned under it does not jump when the season turns over. The dial is also
 * what stands in while the kickoff instant is still being resolved, which is
 * why nothing here renders a placeholder of its own.
 */
export function HeaderReadout({
  season,
  pct,
}: {
  season: string;
  pct: number | null;
}) {
  const kickoff = resolveKickoff(useKickoff(season), firstKickoff(season));
  const now = useTick(kickoff);

  if (kickoff === null || now === null || now >= kickoff)
    return <WinPctGauge pct={pct} />;

  return <KickoffCountdown msLeft={kickoff - now} />;
}
