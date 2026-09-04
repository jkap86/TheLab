"use client";

import { useMemo, useState, type ReactNode } from "react";

import type { LeagueLineupEntry } from "@/shared/contract";

import { CONSOLE_KEY_PILL } from "../../console-chrome";
import { formatInstantDate } from "../../format";
import {
  stopSummary,
  timelineCaveat,
  timelineMoveCount,
  timelineStop,
} from "../../timeline";
import { timelineEntry } from "../../timeline-entry";
import { useTimeline } from "../../use-timeline";
import type { TimelineSubject } from "../../use-timeline";
import { LeagueTeams } from "../league-teams";
import { TimelineRail } from "./timeline-rail";

/**
 * A league's present, with its past a drag away.
 *
 * **At "now" this is exactly the card's own browser**, which is the promise the
 * whole arrangement is arranged around: the rail opens at the present, the
 * table below it is the same table with the same numbers, and a reader who
 * never touches the slider sees no change at all.
 *
 * **Stepping back changes the rosters and nothing else.** The past is drawn by
 * the same `LeagueTeams` — the same metric column, the same lens, the same
 * breakdown and the same pick pills — over the roster set the rewind produces,
 * priced on **today's** boards. See `timelineEntry` for why that is the honest
 * question rather than a compromise: nothing here stores a past projection or a
 * past market, so "what was it worth then" cannot be answered, while "what
 * would it be worth now" is exactly what a reader scrubbing back is asking.
 *
 * **One element at one position, deliberately.** The browser is rendered here
 * rather than swapped for a second component, so React keeps its instance
 * across a scrub — the reader's metric, lens and selected team all survive
 * crossing "now", where two elements would reset all three on every move.
 *
 * **The log is not read until somebody asks for it.** A card's disclosure body
 * is rendered whether or not the card is open and there are a hundred of them
 * on the page, so mounting this must cost nothing: the rail is behind a
 * `History` key and `useTimeline` is disabled until it is pressed. Everything
 * after the press is what it always was, so a reader who opens the history twice
 * pays once.
 */
export function TimelineView({
  subject,
  entry,
  managerRosterId = null,
  children,
}: {
  /** Which league this replays, and which boards to price its past against. */
  subject: TimelineSubject;
  /** The card's own answer — what "now" is. Null while the solve is in flight. */
  entry: LeagueLineupEntry | null;
  /**
   * Which roster is the reader's own, so the past table marks and ranks the
   * same team the present one does. Null until the lineups read lands.
   */
  managerRosterId?: number | null;
  /** What to draw where there is no table to draw — the card's empty state. */
  children: ReactNode;
}) {
  // How many of the league's newest moves are reversed. **Zero rather than a
  // stop index**, so it is meaningful before the payload lands: the card opens
  // at the present whether or not the timeline has answered, which is what makes
  // the rail additive rather than something the body has to wait for.
  const [back, setBack] = useState(0);

  // Whether the reader has asked for the history at all — see the note above.
  // Local and one-way: once opened it stays open for the life of this card, so
  // scrubbing never re-arms a gate.
  const [opened, setOpened] = useState(false);

  const { payload, loading, error } = useTimeline(subject, opened);

  const moves = timelineMoveCount(payload);
  const stop = timelineStop(payload, back);
  const players = payload?.players ?? EMPTY_PLAYERS;

  // Solved only where the reader has actually stepped back. At "now" this would
  // be the current rosters on the current boards — which the card already has,
  // from its own read — so computing it would be a solve of nothing for an
  // answer nobody shows.
  const past = useMemo(
    () => (stop.back > 0 ? timelineEntry(payload, stop.back, managerRosterId) : null),
    [payload, stop.back, managerRosterId],
  );

  const shown = past ?? entry;

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
          found nothing.

          The 50px floor is measured rather than chosen: the `History` key's own
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
            {/* **Dropped below `sm` rather than truncated**, the rule the theme
                key's legend and the standing plate's points rank both keep: at
                390 it breaks mid-word, and a sentence cut to "…through its
                stored …" reads as a rendering fault where the key beside it
                already says what it does. */}
            <span className="hidden min-w-0 truncate text-[0.75rem] text-foreground/45 sm:inline">
              Rewind this league, priced at today&rsquo;s values
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

      {shown && shown.teams.length > 0 ? <LeagueTeams entry={shown} /> : children}

      {/* Under the table, where the card keeps everything that says how the
          numbers above it are known. It has to stay on screen with them, which
          is why it is not on the rail a scroll away — and it is drawn only in
          the past, because at "now" there is nothing to caveat. */}
      {past && (
        <p className="m-0 mt-4 text-[0.7rem] leading-relaxed text-foreground/45">
          {/* `this point` rather than the formatter's own `date unknown`, which
              reads as a broken sentence in the one place the two spellings
              differ — a caveat has to stay a sentence. Unreachable in practice,
              since the read that produced the event excludes undated rows, and
              cheap to be right about. */}
          {timelineCaveat(
            stop.at === null ? "this point" : formatInstantDate(stop.at),
            stopSummary(stop, players),
          )}
        </p>
      )}
    </>
  );
}

/** A stable empty, so a render before the payload lands changes no identity. */
const EMPTY_PLAYERS = {};
