// Both the module rather than the barrel, for `manager-summary`'s reason: this
// card lives inside `features/shared`, so its own index is a cycle from here.
import { FlaskLoader } from "../flask-loader";
import { firstKickoff } from "../../nfl-calendar";
import { useKickoff } from "../../use-kickoff";
import { KickoffCountdown } from "./kickoff-countdown.tsx";
import type { HeaderProgress } from "./manager-header.types.ts";
import { refreshingSuffix, resolveKickoff } from "./manager-header.utils.ts";
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
 *
 * **That trade is about the record, so a page counting a different record opts
 * out** (`countdown`, see {@link ManagerHeaderProps}). The lineup checker's is
 * the week ahead as it stands, which Sleeper projects months before kickoff, so
 * the em-dash premise simply does not hold there and the clock would be sitting
 * on the one number that page is for.
 */
export function HeaderReadout({
  season,
  pct,
  countdown,
  refreshing,
  progress,
}: {
  season: string;
  pct: number | null;
  /** Whether the clock may take the slot. */
  countdown: boolean;
  /** Whether a background refresh is in flight — see {@link SyncFlask}. */
  refreshing?: boolean;
  progress?: HeaderProgress | null;
}) {
  // A component boundary rather than a branch below the hooks, and that is what
  // it buys: a page that never draws the clock never mounts the query behind it,
  // so opting out costs no `/api/kickoff` request either.
  const readout = countdown ? (
    <KickoffReadout season={season} pct={pct} />
  ) : (
    <WinPctGauge pct={pct} />
  );

  if (!refreshing) return readout;

  return (
    // The flask is laid *over* whichever readout is in the slot rather than
    // replacing it, which is what keeps the swap free of layout: the readout
    // underneath still sizes the box, so the plate is the same height refreshing
    // or not, and the card never moves the list below it. Dimmed rather than
    // hidden, because what is under the flask is still the truth — it comes
    // back the moment the sync lands, and fading to nothing would read as the
    // number having been lost.
    <div className="relative flex-none">
      <div className="opacity-[0.12]" aria-hidden="true">
        {readout}
      </div>
      <SyncFlask progress={progress} />
    </div>
  );
}

/**
 * The refresh, as the one live thing on the card while it runs.
 *
 * **Why the slot rather than a badge**: the flask draws in a 120-unit box with
 * bubbles of radius 1.8–3.2 that rise 30 units, so at width `w` a bubble is
 * `w/120 × r` across. Below about 34px they are sub-pixel and what is left is a
 * static glass outline — a mark, not a loader. This slot is the only place on the
 * plate with room for a flask that actually bubbles, which is the whole reason
 * the refresh state was moved into it rather than badged onto an edge.
 *
 * 44px is the smallest size that reads, and it fits the slot at both widths: the
 * flask is `size × 1.25` tall, so 55px inside a 56px box on a phone and a 66px
 * one from `sm`.
 *
 * The count is `aria-hidden` and the flask's own `role="status"` says
 * "Refreshing" once. That is the rule the state line already kept, moved with
 * the state it belongs to: the tally ticks once per league, and a polite region
 * re-reading "Refreshing 41/121" every few hundred milliseconds talks over the
 * page it is describing.
 */
function SyncFlask({ progress }: { progress?: HeaderProgress | null }) {
  return (
    <span className="absolute inset-0 grid place-items-center">
      <FlaskLoader variant="pulse" size={44} label="Refreshing leagues" />
      {/* Below the flask's foot rather than inside it — the flask fills the
          slot, and the count is absolute, so it costs the box nothing. */}
      <span
        aria-hidden="true"
        className="absolute -bottom-1 left-1/2 -translate-x-1/2 whitespace-nowrap font-mono text-[9px] leading-none tracking-[0.04em] text-active/80"
      >
        {refreshingSuffix(progress).trim()}
      </span>
    </span>
  );
}

/** The readout where a clock is welcome — the half that has to ask the season. */
function KickoffReadout({ season, pct }: { season: string; pct: number | null }) {
  const kickoff = resolveKickoff(useKickoff(season), firstKickoff(season));
  const now = useTick(kickoff);

  if (kickoff === null || now === null || now >= kickoff)
    return <WinPctGauge pct={pct} />;

  return <KickoffCountdown msLeft={kickoff - now} />;
}
