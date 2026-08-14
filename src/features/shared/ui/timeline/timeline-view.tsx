"use client";

import { useMemo, useState, type ReactNode } from "react";

import { formatInstantDate } from "../../format";
import {
  timelineCaveat,
  timelineMoveCount,
  timelineOrigin,
  timelineRosters,
  timelineStop,
} from "../../timeline";
import type { TimelineSource } from "../../timeline-query";
import { useTimeline } from "../../use-timeline";
import { TimelineRail } from "./timeline-rail";
import { TimelineRosters } from "./timeline-rosters";

/**
 * A league's present, with its past a drag away.
 *
 * **The rail and the swap, once, for both hosts.** The trades board's sheet opens
 * from a trade card and anchors its rail on that trade; the leagues list's card
 * opens from nothing in particular and runs its rail all the way back. Those are
 * two {@link TimelineSource}s and *nothing else* differs — the state, the stop
 * arithmetic, which body is drawn, the caveat and the rules below are shared, so
 * a change to any of them lands on both screens rather than on whichever was
 * edited.
 *
 * **At "now" this is exactly its `children`**, which is the promise the whole
 * arrangement is arranged around: the rail opens at the present, the panel below
 * it is the same panel with the same props, and a reader who never touches the
 * slider sees no change at all. Only stepping back swaps the body — and it
 * *swaps* rather than laying a past roster under the panel's numbers, because
 * every one of those numbers is a fact about the league today. See
 * {@link TimelineRosters} for why that would be a claim rather than a reading.
 *
 * **The present body is a node rather than something this builds**, so the two
 * hosts keep their own: the sheet passes a panel seeded on the roster that dealt,
 * the card passes one seeded on whatever it was opened with. Both are unmounted
 * while the reader is in the past, which costs nothing — the detail is a cached
 * query by then, so returning to now re-reads the cache rather than the network.
 */
export function TimelineView({
  source,
  seedRosterId = null,
  children,
}: {
  /**
   * Which walk this rail replays, or null where there is nothing to ask about —
   * a closed host, or one opened from somewhere with no league in hand. Null
   * costs no request, which matters because this is the heaviest read either host
   * makes.
   */
  source: TimelineSource | null;
  /**
   * The roster the past half opens on. The sheet knows the one that dealt; the
   * leagues card knows the reader's own where it has one, and passes nothing
   * where it does not — which falls back to the head of the list.
   */
  seedRosterId?: number | null;
  /** What "now" is — the detail panel each host draws. */
  children: ReactNode;
}) {
  // How many of the league's newest moves are reversed. **Zero rather than a
  // stop index**, so it is meaningful before the payload lands: a host opens at
  // the present whether or not the timeline has answered, which is what makes the
  // rail additive rather than something the body has to wait for.
  const [back, setBack] = useState(0);

  // Which manager the historical half is showing.
  //
  // **Held here rather than in the view, so it survives the rail moving.** The
  // roster list is rebuilt at every stop; a selection held inside it would reset
  // as the reader dragged, which is the one thing a timeline must not do — the
  // question being asked is what *this* manager held over time, so the manager is
  // what stays fixed while the moment moves. It is deliberately *not* shared with
  // the detail panel's own selection: that one is seeded the same way and then
  // owned by the panel, and reaching into it would mean the shared panel
  // reporting a selection it currently keeps to itself.
  const [rosterId, setRosterId] = useState<number | null>(seedRosterId);

  const { data } = useTimeline(source);

  const moves = timelineMoveCount(data);
  const stop = timelineStop(data, back);
  const origin = timelineOrigin(data);
  // Only where the reader has actually stepped back. At "now" this would be the
  // current rosters — which the body already draws, from its own read — so
  // computing it would be a rewind of nothing for an answer nobody shows. It
  // matters more here than it did on the sheet: an unanchored rail carries a
  // season of moves, so the walk it skips is the whole log.
  const rosters = useMemo(
    () => (stop.back > 0 ? timelineRosters(data, stop.back) : []),
    [data, stop.back],
  );

  return (
    <>
      {/* No rail where there is nothing to scrub: a trade Sleeper filed with no
          timestamp has no moment to rewind to, a league nobody has moved a player
          in has no moves to reverse, and a league whose rosters are not stored has
          nothing to rewind from. All come back as no timeline, and all leave the
          host exactly as it was before this existed — which is a better answer
          than a dead slider explaining itself. A timeline with one move is still a
          rail, since "before it" is a stop. */}
      {moves > 0 && (
        <TimelineRail
          stop={stop}
          moves={moves}
          origin={origin}
          players={data?.players ?? EMPTY_PLAYERS}
          onChange={setBack}
        />
      )}

      {stop.back === 0 ? (
        children
      ) : (
        <TimelineRosters
          rosters={rosters}
          players={data?.players ?? EMPTY_PLAYERS}
          managers={data?.managers ?? EMPTY_MANAGERS}
          selectedId={rosterId}
          onSelect={setRosterId}
          // `this point` rather than the formatter's own `date unknown`, which
          // reads as a broken sentence in the one place the two spellings differ:
          // the rail can print "date unknown" as a *label* and a caveat has to
          // stay a sentence. Unreachable in practice — an event carries a
          // timestamp by construction, since the read that produced it excludes
          // undated rows — and cheap to be right about.
          caveat={timelineCaveat(
            stop.at === null ? "this point" : formatInstantDate(stop.at),
          )}
        />
      )}
    </>
  );
}

/** Stable empties, so a render before the payload lands changes no identity. */
const EMPTY_PLAYERS = {};
const EMPTY_MANAGERS = {};
