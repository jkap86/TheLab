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
 *
 * **The log is not read until somebody asks for it**, which is the one thing
 * about this that changed with the League Details split. Mounting a host used to
 * start `/api/league/:id/timeline` — the heaviest read either route makes,
 * described as such where it is defined — at exactly the moment the panel beside
 * it was making its own reads, so the two competed for the same pool for the
 * same reader, and a card opened to glance at the standings paid for a season of
 * moves nobody scrubbed. The rail is behind a `History` key now and the query is
 * disabled until it is pressed; everything after the press is what it always
 * was, cache included, so a reader who opens the history twice pays once.
 *
 * The key is drawn only where there is a source to ask about, so a closed sheet
 * still renders exactly its children and nothing else.
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

  // Whether the reader has asked for the history at all — see the note above.
  // Local and one-way: once opened it stays open for the life of this host, so
  // scrubbing never re-arms a gate, and closing the host is what resets it.
  const [opened, setOpened] = useState(false);

  // Null until then, which is how {@link useTimeline} spells "don't ask".
  const { data, loading } = useTimeline(opened ? source : null);

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
      {/* Four states in one seat, and the seat is the same height in all of
          them so opening the history moves nothing under it.

          Unopened is a key and nothing else — no request has been made, so
          there is nothing yet to say about whether this league has a history.
          Opened and still reading says so, because the read is the heaviest
          either host makes and a key that swallowed a press for a second would
          read as broken.

          Then: a rail where there is something to scrub, and a word where there
          is not. A trade Sleeper filed with no timestamp has no moment to
          rewind to, a league nobody has moved a player in has no moves to
          reverse, and a league whose rosters are not stored has nothing to
          rewind from — all three come back as no timeline. Before the key
          existed that drew nothing at all, which was right for something
          nobody had asked for and is wrong for an answer somebody has: a
          control that vanishes on press is worse than one that says it found
          nothing. */}
      {source !== null && !opened && (
        <TimelineSeat>
          <button
            type="button"
            onClick={() => setOpened(true)}
            className="lab-chip lab-chip-sm rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-foreground/55 transition-colors hover:text-active"
          >
            History
          </button>
          <span className="min-w-0 truncate text-[11px] text-foreground/45">
            rewind this league through its stored moves
          </span>
        </TimelineSeat>
      )}

      {opened && loading && (
        <TimelineSeat>
          <span className="text-[11px] text-foreground/45">Reading history…</span>
        </TimelineSeat>
      )}

      {opened && !loading && moves === 0 && (
        <TimelineSeat>
          <span className="text-[11px] text-foreground/45">
            No stored moves to rewind through.
          </span>
        </TimelineSeat>
      )}

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

/**
 * The band the rail occupies, worn by everything that stands in for it.
 *
 * The same box as {@link TimelineRail}'s own outer element, spelled once so the
 * key, the reading note and the rail cannot disagree about where the seam under
 * them sits — a seat that changed height on press would move the whole panel
 * below it at the moment a reader is looking at something else.
 */
function TimelineSeat({ children }: { children: ReactNode }) {
  return (
    <div className="flex shrink-0 items-center gap-2 border-b border-foreground/10 px-3 py-2 sm:px-4">
      {children}
    </div>
  );
}

/** Stable empties, so a render before the payload lands changes no identity. */
const EMPTY_PLAYERS = {};
const EMPTY_MANAGERS = {};
