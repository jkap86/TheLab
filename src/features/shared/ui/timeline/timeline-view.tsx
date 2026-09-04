"use client";

import { useMemo, useState, type ReactNode } from "react";

import { CONSOLE_KEY_PILL } from "../../console-chrome";
import { formatInstantDate } from "../../format";
import {
  stopSummary,
  timelineCaveat,
  timelineMoveCount,
  timelineRosters,
  timelineStop,
} from "../../timeline";
import { useTimeline } from "../../use-timeline";
import { TimelineRail } from "./timeline-rail";
import { TimelineRosters } from "./timeline-rosters";

/**
 * A league's present, with its past a drag away.
 *
 * **At "now" this is exactly its `children`**, which is the promise the whole
 * arrangement is arranged around: the rail opens at the present, the panel
 * below it is the same panel with the same props, and a reader who never
 * touches the slider sees no change at all. Only stepping back swaps the body —
 * and it *swaps* rather than laying a past roster under the card's numbers,
 * because every one of those numbers is a fact about the league today. See
 * {@link TimelineRosters} for why that would be a claim rather than a reading.
 *
 * **The present body is a node rather than something this builds**, so the host
 * keeps its own — the card passes its teams browser, seeded on whatever the
 * reader had selected. It is unmounted while the reader is in the past, which
 * costs nothing: the payload behind it is already in hand, so returning to now
 * re-renders rather than re-reads.
 *
 * **The log is not read until somebody asks for it.** A card's disclosure body
 * is rendered whether or not the card is open and there are a hundred of them
 * on the page, so mounting this must cost nothing: the rail is behind a
 * `History` key and `useTimeline` is disabled until it is pressed. Everything
 * after the press is what it always was, so a reader who opens the history twice
 * pays once.
 */
export function TimelineView({
  leagueId,
  seedRosterId = null,
  children,
}: {
  /** The league this rail replays. */
  leagueId: string;
  /**
   * The roster the past half opens on — the reader's own team, where the card
   * knows it, so scrubbing back answers "what did *I* have" without a press.
   * Null falls back to the head of the list.
   */
  seedRosterId?: number | null;
  /** What "now" is — the panel the host draws. */
  children: ReactNode;
}) {
  // How many of the league's newest moves are reversed. **Zero rather than a
  // stop index**, so it is meaningful before the payload lands: the card opens
  // at the present whether or not the timeline has answered, which is what makes
  // the rail additive rather than something the body has to wait for.
  const [back, setBack] = useState(0);

  // Which manager the historical half is showing.
  //
  // **Held here rather than in the view, so it survives the rail moving.** The
  // roster list is rebuilt at every stop; a selection held inside it would reset
  // as the reader dragged, which is the one thing a timeline must not do — the
  // question being asked is what *this* manager held over time, so the manager
  // is what stays fixed while the moment moves. It is deliberately *not* shared
  // with the teams browser's own selection: that one is seeded the same way and
  // then owned by the browser, and reaching into it would mean the card
  // reporting a selection it currently keeps to itself.
  const [rosterId, setRosterId] = useState<number | null>(seedRosterId);

  // Whether the reader has asked for the history at all — see the note above.
  // Local and one-way: once opened it stays open for the life of this card, so
  // scrubbing never re-arms a gate.
  const [opened, setOpened] = useState(false);

  const { payload, loading, error } = useTimeline(leagueId, opened);

  const moves = timelineMoveCount(payload);
  const stop = timelineStop(payload, back);
  const players = payload?.players ?? EMPTY_PLAYERS;
  // Only where the reader has actually stepped back. At "now" this would be the
  // current rosters — which the body already draws, from its own read — so
  // computing it would be a rewind of nothing for an answer nobody shows.
  const rosters = useMemo(
    () => (stop.back > 0 ? timelineRosters(payload, stop.back) : []),
    [payload, stop.back],
  );

  return (
    <>
      {/* Five states in one seat, and the seat is **the same height in all of
          them**, so pressing `History` moves nothing under it — which matters
          here more than it would anywhere else, because what sits under it is a
          twelve-row table a reader is in the middle of looking at.

          Unopened is a key and nothing else: no request has been made, so there
          is nothing yet to say about whether this league has a history. Opened
          and still reading says so, because the read is the heaviest one this
          page makes and a key that swallowed a press for a second would read as
          broken. A failure says so too, for the reason `useTimeline` reports it
          at all — a rail that opened onto nothing is otherwise indistinguishable
          from a league with no moves.

          Then: a rail where there is something to scrub, and a word where there
          is not. A league nobody has moved a player in has no moves to reverse,
          and a league whose rosters are not stored has nothing to rewind from;
          both come back as no timeline. Drawing nothing at all would be right
          for something nobody had asked for and is wrong for an answer somebody
          has — a control that vanishes on press is worse than one that says it
          found nothing. */}
      {/* The 50px floor is measured rather than chosen: the `History` key's own
          row is 36px and the rail's is 35, so without it pressing the key would
          shift the whole table below by a pixel. */}
      <div className="mb-3.5 flex min-h-[3.125rem] items-center gap-3 border-b border-foreground/10 pb-3.5">
        {!opened && (
          <>
            <button
              type="button"
              onClick={() => setOpened(true)}
              className={`${CONSOLE_KEY_PILL} border-foreground/10 bg-[image:var(--key-bg)] px-3.5 py-1.5 text-foreground/80 shadow-[var(--key-shadow)] hover:text-readout`}
            >
              History
            </button>
            {/* **Dropped below `sm` rather than truncated**, the rule the
                theme key's legend and the standing plate's points rank both
                keep: at 390 it breaks mid-word, and a sentence cut to
                "…through its stored …" reads as a rendering fault where the
                key beside it already says what it does. */}
            <span className="hidden min-w-0 truncate text-[0.75rem] text-foreground/45 sm:inline">
              Rewind this league through its stored moves
            </span>
          </>
        )}

        {opened && loading && (
          <span className="font-mono text-[0.6875rem] uppercase tracking-[0.16em] text-readout-label">
            Reading history…
          </span>
        )}

        {opened && error !== null && (
          <span className="text-[0.75rem] text-error">{error}</span>
        )}

        {opened && !loading && error === null && moves === 0 && (
          <span className="font-mono text-[0.6875rem] uppercase tracking-[0.16em] text-readout-label">
            No stored moves to rewind through
          </span>
        )}

        {moves > 0 && (
          <TimelineRail
            stop={stop}
            moves={moves}
            players={players}
            onChange={setBack}
          />
        )}
      </div>

      {stop.back === 0 || !payload?.timeline ? (
        children
      ) : (
        <TimelineRosters
          rosters={rosters}
          players={players}
          selectedId={rosterId}
          onSelect={setRosterId}
          // `this point` rather than the formatter's own `date unknown`, which
          // reads as a broken sentence in the one place the two spellings
          // differ — a caveat has to stay a sentence. Unreachable in practice,
          // since the read that produced the event excludes undated rows, and
          // cheap to be right about.
          caveat={timelineCaveat(
            stop.at === null ? "this point" : formatInstantDate(stop.at),
            stopSummary(stop, players),
          )}
        />
      )}
    </>
  );
}

/** A stable empty, so a render before the payload lands changes no identity. */
const EMPTY_PLAYERS = {};
