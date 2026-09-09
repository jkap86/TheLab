"use client";

import { useMemo, useState, type ReactNode } from "react";

import type {
  LeagueLineupEntry,
  LineupColumn,
  LineupSlot,
  ManagerLineupsPayload,
} from "@/shared/contract";

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
 *
 * **The key itself is no longer here, and the strip is no longer always.** Both
 * used to be one 32px recess with a 10px margin, drawn whether or not anybody
 * had ever asked for a history — 42px of a capped panel to hold one key and a
 * sentence. The key is `TimelineHistoryKey` now, hung on the card's own seam
 * (`ExpandedPanel`'s `seamEnd`), and this draws nothing at all until it is
 * pressed. What the panel gets back is two standings rows and a seat; what it
 * costs is that pressing grows the chrome once, by the strip, which is the one
 * moment there is a rail to put in it.
 *
 * **So `historyOpen` is a prop rather than state.** The key and the strip are
 * the two halves of one gate and they are now on either side of the seam, so
 * the latch lives above both — in the card's own detail component. The request
 * gate does not move with it: `useTimeline(subject, historyOpen)` is still read
 * here, which is what keeps "what the rail costs" beside the rail.
 */
export function TimelineView({
  subject,
  entry,
  column,
  ktc,
  slots,
  managerRosterId = null,
  historyOpen,
  children,
}: {
  /** Which league this replays, and which boards to price its past against. */
  subject: TimelineSubject;
  /** The card's own answer — what "now" is. Null while the solve is in flight. */
  entry: LeagueLineupEntry | null;
  /**
   * What the standings pane reads, forwarded — and, at a past stop, what this
   * has to answer.
   *
   * **A stop is solved here, so the column has to be too.** The card's present
   * comes priced from the route with that column's totals on it; a past stop is
   * the browser's own solve over rewound rosters, and it would carry the ten
   * whole-roster totals alone unless it were told which column to file beside
   * them. Then scrubbing back would blank the one column a reader is looking
   * at — see `timelineEntry`, whose parameter this is.
   *
   * **It is also why `subject` carries both board halves.** The payload holds
   * one price table per board and the solve here files it under the column's
   * own pricing, which is sound only because the request asked for that
   * pricing. The card is what keeps the two in step.
   */
  column: LineupColumn;
  /** Forwarded to the pane's own picker — see `LeagueTeams`. */
  ktc?: ManagerLineupsPayload["ktc"];
  /** Likewise. */
  slots?: readonly LineupSlot[];
  /**
   * Which roster is the reader's own, so the past table marks and ranks the
   * same team the present one does. Null until the lineups read lands.
   */
  managerRosterId?: number | null;
  /**
   * Whether the reader has pressed {@link TimelineHistoryKey}. One-way and
   * owned above the seam — see the note on this component.
   */
  historyOpen: boolean;
  /** What to draw where there is no table to draw — the card's empty state. */
  children: ReactNode;
}) {
  // How many of the league's newest moves are reversed. **Zero rather than a
  // stop index**, so it is meaningful before the payload lands: the card opens
  // at the present whether or not the timeline has answered, which is what makes
  // the rail additive rather than something the body has to wait for.
  const [back, setBack] = useState(0);

  const { payload, loading, error, loadEarlier, loadingEarlier, earlierError } =
    useTimeline(subject, historyOpen);

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
        ? timelineEntry(payload, stop.back, managerRosterId, column, stop)
        : null,
    [payload, stop, managerRosterId, column],
  );

  const shown = past ?? entry;

  return (
    <>
      {/* **Four states in one seat, and the seat is the same height in all of
          them**, so nothing moves under the reader once the history is up —
          which matters here more than it would anywhere else, because what
          sits under it is a twelve-row table they are in the middle of reading.

          There were five, and the fifth was the reason this strip was drawn at
          all times: an unopened seat holding a `History` key and a sentence
          about it. That key hangs on the card's seam now, so an unopened
          history has no strip — see this component's own note for what the
          panel gets back. What is left are the four states a press can produce.
          Reading says so, because the read is the heaviest one this page makes
          and a key that swallowed a press for a second would read as broken. A
          failure says so too, for the reason `useTimeline` reports it at all —
          a rail that opened onto nothing is otherwise indistinguishable from a
          league with no moves. Then a rail where there is something to scrub,
          and a word where there is not: a league nobody has moved a player in
          has no moves to reverse, and one whose rosters are not stored has
          nothing to rewind from. Drawing nothing for either would be right for
          something nobody had asked for and is wrong for an answer somebody
          has — a control that vanishes on press is worse than one that says it
          found nothing.

          **It is one recess strip, not a well.** It was a 56px `CONSOLE_WELL`
          plus a 16px margin holding a rail that wrapped to three parts on a
          phone — ~94px of a 390px card before the first row of the table it
          sits over. It is a 32px strip (30 on a phone), the same `--recess-bg`
          + `--track-shadow` the rail's own bay already wore, with every part of
          the rail on one line; see `TimelineRail` for the parts. The height is
          **fixed** rather than a floor, because a fixed height is what makes
          the four states one height. */}
      {historyOpen && (
        <div className="mb-2 flex h-[30px] shrink-0 flex-nowrap items-center gap-1.5 rounded-full bg-[color:var(--recess-bg)] pl-2.5 pr-[5px] shadow-[var(--track-shadow)] sm:mb-2.5 sm:h-8 sm:gap-2.5 sm:pl-3.5 sm:pr-1.5 pointer-fine:[transform:translateZ(4px)]">
          {loading && (
            <span className="min-w-0 truncate font-mono text-[length:var(--fs-11)] uppercase tracking-[0.16em] text-readout-label">
              Reading history…
            </span>
          )}

          {error !== null && (
            <span className="min-w-0 truncate text-[length:var(--fs-12)] text-error">
              {error}
            </span>
          )}

          {!loading && error === null && moves === 0 && (
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
      )}

      {/* **The three parts are the panel's own flex items**, which is what makes
          the capped panel a fixed-height column rather than a box with a
          scrollbar: this returns a fragment, so the rail, the browser and the
          caveat are laid out by the panel directly. The rail and the caveat
          hold their heights and the browser takes what is left — see `Pane` for
          the `min-h-0` that has to run all the way down or nothing scrolls. */}
      {shown && shown.teams.length > 0 ? (
        <LeagueTeams
          entry={shown}
          column={column}
          ktc={ktc}
          slots={slots}
        />
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

/**
 * The press that asks for a league's history, hung on the card's seam.
 *
 * **It is a component here rather than markup in the card** because the card is
 * not the only thing that knows what it does: the strip it opens is
 * {@link TimelineView}'s, and a key whose legend, chrome and sentence lived in
 * two cards would be two spellings of one control on two pages drawing one
 * league. Both cards fill `ExpandedPanel`'s `seamEnd` with this.
 *
 * **The sentence became the key's name rather than a span beside it.** On the
 * old strip it was a line of prose — dropped below `sm`, where it broke
 * mid-word — and on the seam there is no line to put it on at any width. It is
 * the accessible name and the tooltip instead, so what a reader gets by
 * pointing at the key or hearing it read is what the prose said, and what the
 * card gets back is the row that prose was sitting on.
 *
 * **One-way, and the latch is the caller's.** Once pressed there is nothing
 * left for this to do, so the caller stops rendering it and the strip below the
 * seam takes over.
 *
 * The chrome is the everyday key's, at a tighter gutter: `px-3 py-[3px]` on the
 * **padding-free** `CONSOLE_KEY_PILL_SHELL` rather than on `CONSOLE_KEY_PILL`,
 * whose own `px-4 py-2` would win the coin flip — two base utilities of the same
 * specificity are settled by Tailwind's emit order and the scale is emitted
 * ascending, so a key silently laid out at the standard gutter still looks like
 * a key. It is the trap that shell exists to keep a key out of.
 */
export function TimelineHistoryKey({ onOpen }: { onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      title={HISTORY_KEY_TITLE}
      className={`${CONSOLE_KEY_PILL_SHELL} border-foreground/10 bg-[image:var(--key-bg)] px-3 py-[3px] text-foreground/80 shadow-[var(--key-shadow)] hover:text-readout`}
    >
      History
      <span className="sr-only"> — {HISTORY_KEY_TITLE}</span>
    </button>
  );
}

const HISTORY_KEY_TITLE = "Rewind this league, priced at today\u2019s values";

/** A stable empty, so a render before the payload lands changes no identity. */
const EMPTY_PLAYERS = {};
