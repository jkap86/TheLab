"use client";

import { useMemo, useState, type ReactNode } from "react";

import type { LeagueLineupEntry } from "@/shared/contract";

import { CONSOLE_KEY_PILL_SHELL } from "../../console-chrome";
import { formatInstantDate } from "../../format";
import {
  stopSummary,
  timelineCaveat,
  timelineEarlier,
  timelineMoveCount,
  timelineSeasonBoundaries,
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
 * breakdown and the same picks — over the roster set the rewind produces,
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

  const { payload, loading, error, loadEarlier, loadingEarlier, earlierError } =
    useTimeline(subject, opened);

  const moves = timelineMoveCount(payload);
  // Memoized so the entry below can take it as a dependency and be handed it:
  // a fresh stop object per render would be a memo that never held, and the
  // walk would run once here, once in the entry and once in the rosters on
  // every `input` of the range.
  const stop = useMemo(() => timelineStop(payload, back), [payload, back]);
  const players = payload?.players ?? EMPTY_PLAYERS;
  const boundaries = useMemo(() => timelineSeasonBoundaries(payload), [payload]);

  // **Offered only at the far end**, which is where it means something: a reader
  // who has dragged to the oldest stop this database holds is the one asking how
  // much further back it goes. `back >= moves` covers the league with no stored
  // moves at all, where the far end and the present are the same stop and the
  // strip says so — that league's earlier seasons are exactly the ones worth
  // fetching, and a key only reachable by scrubbing would be unreachable there.
  const earlier = timelineEarlier(payload);
  const offer = earlier !== null && stop.back >= moves;

  // Solved only where the reader has actually stepped back. At "now" this would
  // be the current rosters on the current boards — which the card already has,
  // from its own read — so computing it would be a solve of nothing for an
  // answer nobody shows.
  const past = useMemo(
    () =>
      stop.back > 0
        ? timelineEntry(payload, stop.back, managerRosterId, stop)
        : null,
    [payload, stop, managerRosterId],
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

          **It is one recess strip, not a well.** It was a 56px `CONSOLE_WELL`
          plus a 16px margin holding a rail that wrapped to three parts on a
          phone — ~94px of a 390px card before the first row of the table it
          sits over. It is a 32px strip now (30 on a phone), the same
          `--recess-bg` + `--track-shadow` the rail's own bay already wore,
          with every part of the rail on one line; see `TimelineRail` for the
          parts. The height is **fixed** rather than a floor, because a fixed
          height is what makes the five states one height, and a fixed 32px is
          what the `History` key had to shrink to fit (`py-[3px] px-3`, on the
          padding-free pill shell — appending a smaller padding to
          `CONSOLE_KEY_PILL`'s `px-4 py-2` is decided by Tailwind's emit order,
          the trap that shell exists to keep a key out of). */}
      <div
        className="mb-2 flex h-[30px] shrink-0 flex-nowrap items-center gap-1.5 rounded-full bg-[color:var(--recess-bg)] pl-2.5 pr-[5px] shadow-[var(--track-shadow)] sm:mb-2.5 sm:h-8 sm:gap-2.5 sm:pl-3.5 sm:pr-1.5 pointer-fine:[transform:translateZ(4px)]"
      >
        {!opened && (
          <>
            <button
              type="button"
              onClick={() => setOpened(true)}
              className={`${CONSOLE_KEY_PILL_SHELL} border-foreground/10 bg-[image:var(--key-bg)] px-3 py-[3px] text-foreground/80 shadow-[var(--key-shadow)] hover:text-readout`}
            >
              History
            </button>
            {/* **Dropped below `sm` rather than truncated**, the rule the theme
                key's legend and the standing plate's points rank both keep: at
                390 it breaks mid-word, and a sentence cut to "…through its
                stored …" reads as a rendering fault where the key beside it
                already says what it does. */}
            <span className="hidden min-w-0 truncate text-[length:var(--fs-12)] text-foreground/45 sm:inline">
              Rewind this league, priced at today&rsquo;s values
            </span>
          </>
        )}

        {opened && loading && (
          <span className="min-w-0 truncate font-mono text-[length:var(--fs-11)] uppercase tracking-[0.16em] text-readout-label">
            Reading history…
          </span>
        )}

        {opened && error !== null && (
          <span className="min-w-0 truncate text-[length:var(--fs-12)] text-error">
            {error}
          </span>
        )}

        {opened && !loading && error === null && moves === 0 && (
          <span className="min-w-0 truncate font-mono text-[length:var(--fs-11)] uppercase tracking-[0.16em] text-readout-label">
            No stored moves to rewind through
          </span>
        )}

        {moves > 0 && (
          <TimelineRail
            stop={stop}
            moves={moves}
            boundaries={boundaries}
            players={players}
            onChange={setBack}
          />
        )}
      </div>

      {/* **The three parts are the panel's own flex items**, which is what makes
          the capped panel a fixed-height column rather than a box with a
          scrollbar: this returns a fragment, so the rail, the browser and the
          caveat are laid out by the panel directly. The rail and the caveat
          hold their heights and the browser takes what is left — see `Pane` for
          the `min-h-0` that has to run all the way down or nothing scrolls. */}
      {shown && shown.teams.length > 0 ? (
        <LeagueTeams entry={shown} />
      ) : (
        <div className="shrink-0">{children}</div>
      )}

      {/* Under the table, where the card keeps everything that says how the
          numbers above it are known. It has to stay on screen with them, which
          is why it is not on the rail a scroll away — and the caveat is drawn
          only in the past, because at "now" there is nothing to caveat.

          The key beside it is the far end of the rail rather than a control over
          the card, which is why it sits here rather than on the strip: at 390
          the strip is four parts in 335px with nothing to spare, and this is the
          one place a sentence can say what pressing it will cost. */}
      {(past || offer) && (
        <div className="mt-4 flex shrink-0 flex-col gap-2">
          {past && (
            <p className="m-0 text-[length:var(--fs-11-2)] leading-relaxed text-foreground/45">
              {/* `null` rather than the formatter's own `date unknown`, which
                  reads as a broken sentence in the one place the two spellings
                  differ — a caveat has to stay a sentence. A season's end has no
                  date by construction; inside a season it is unreachable, since
                  the read that produced the event excludes undated rows. */}
              {timelineCaveat(
                stop,
                stop.at === null ? null : formatInstantDate(stop.at),
                stopSummary(stop, players),
              )}
            </p>
          )}

          {offer && (
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={loadEarlier}
                disabled={loadingEarlier}
                className={`${CONSOLE_KEY_PILL_SHELL} border-foreground/10 bg-[image:var(--key-bg)] px-3 py-[3px] text-foreground/80 shadow-[var(--key-shadow)] disabled:opacity-60 hover:text-readout`}
              >
                {loadingEarlier ? "Loading…" : "Load earlier season"}
              </button>
              <span
                className="min-w-0 text-[length:var(--fs-11-2)] leading-relaxed text-foreground/45"
                role={earlierError === null ? undefined : "status"}
              >
                {earlierError ??
                  `Fetch the season before ${earlier.beforeSeason} from Sleeper — this is as far back as it is stored.`}
              </span>
            </div>
          )}
        </div>
      )}
    </>
  );
}

/** A stable empty, so a render before the payload lands changes no identity. */
const EMPTY_PLAYERS = {};
