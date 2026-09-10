"use client";

import { useId, useState } from "react";

import type { GametimeGame, GametimePlayer, GametimeSeat, GametimeSide } from "@/shared/contract";
import {
  CONSOLE_FIGURE_WELL,
  CONSOLE_ROW_WELL,
  DrawerBar,
  DrawerRow,
  DRAWER_BAR,
  DRAWER_BAR_HEIGHT,
  DRAWER_BARS,
  Pane,
  PaneDrawer,
  PaneGlass,
  PaneHead,
  PaneLedge,
  PaneLedgeTrack,
  PaneTotal,
  PANEL_BLEED,
  slotLabel,
  useLinkedScroll,
} from "@/features/shared";

import { gameClockLabel, gameScoreLabel } from "../helpers/live-record";

/**
 * The open card's week, live: your lineup against the one it plays, seat by
 * seat, with what each starter has scored, what he is on course for, and where
 * his game is.
 *
 * The lineup checker's `WeekPanes` with the checker's question taken out of
 * it. That view offers a seat's options behind a press, because a lineup a
 * reader can still set is what it is about; this is a scoreboard over a
 * lineup that is being played, so the seats are plain rows and the panes are
 * two lists read across — the same parts (`Pane`, `PaneLedge`, `PaneGlass`,
 * `CONSOLE_ROW_WELL`, a bench behind a pinned drawer bar), the same two row
 * heights, and the same linked scroll, so a reader walking from the checker to
 * here sees one card over one league.
 *
 * **Each seat carries three figures and the column is the reason a live page
 * exists.** `Pts` is what he has scored, `Live` is what he is on course for,
 * and the clock between the name and the figures says why the two differ —
 * `Q3 5:32` on a running game, `Final` on one that is over, the kickoff on one
 * to come. The live figure is inked accent while his game runs, which is what
 * a reader scanning the column is looking for.
 *
 * **The panes sit side by side at every width**, phones included, because the
 * comparison is the whole point; what turns at `lg` is the seat row, from one
 * line of columns to two.
 */
export function LivePanes({
  mine,
  opponent,
  board,
  teamName,
}: {
  mine: GametimeSide;
  opponent: GametimeSide | null;
  /** The week's scoreboard by NFL team — the payload's, once for every seat. */
  board: Readonly<Record<string, GametimeGame>>;
  /** What the reader calls their own team — the card's league row knows it. */
  teamName: string | null;
}) {
  const { left, right } = useLinkedScroll([opponent !== null]);

  return (
    <div className="flex min-h-0 flex-1 flex-col pointer-fine:[transform-style:preserve-3d]">
      {/* **The row runs to the housing wall**, the manager card's own bleed
          (`PANEL_BLEED`) rather than a second reading of it: the panel's side
          padding is what lines the *summary's* windows up, and the panes are
          the one thing under the seam with nothing above them to line up with.
          Bled, each pane takes the gutter's width back — 18px a side on a
          desktop, 14 on a phone — and the name column is what spends it, which
          at 390 is the difference between a readable name and an initial.

          The two lineups are read *across* each other, so what matters here as
          much as the width is that both panes gain the same: the row is one
          box and its gap does not move. */}
      <div
        className={`${PANEL_BLEED} relative flex min-h-0 flex-1 items-stretch gap-1.5 sm:gap-2.5 lg:gap-3.5 pointer-fine:[transform:translateZ(7px)]`}
      >
        <LineupPane
          legend="Yours"
          name={teamName ?? "Your lineup"}
          side={mine}
          board={board}
          scrollRef={left}
        />
        {opponent && (
          <LineupPane
            legend="Theirs"
            name={opponent.team_name ?? "Their lineup"}
            side={opponent}
            board={board}
            vs
            scrollRef={right}
          />
        )}
      </div>
    </div>
  );
}

/** A player's game off the board, or null for a bye or a team the feed did not name. */
function gameOf(
  player: GametimePlayer | null,
  board: Readonly<Record<string, GametimeGame>>,
): GametimeGame | null {
  if (!player || player.team === null) return null;
  return board[player.team] ?? null;
}

function LineupPane({
  legend,
  name,
  side,
  board,
  vs = false,
  scrollRef,
}: {
  legend: string;
  name: string;
  side: GametimeSide;
  board: Readonly<Record<string, GametimeGame>>;
  vs?: boolean;
  scrollRef: React.RefObject<HTMLDivElement | null>;
}) {
  const drawerId = useId();
  const [benchOpen, setBenchOpen] = useState(false);

  return (
    <Pane>
      <PaneLedge>
        <PaneLedgeTrack legend={legend}>
          <PaneTotal label="Pts" value={side.scored} />
          {/* The accent is not an alert — it is the reading the whole page is
              about, drawn in the ink the seat rows use for a running game. */}
          <PaneTotal label="Live" value={side.live} tone="accent" />
        </PaneLedgeTrack>
        <ColumnHeads name={name} vs={vs} />
      </PaneLedge>

      <PaneGlass className="flex flex-col overflow-hidden p-[3px]">
        <div
          ref={scrollRef}
          className="lab-scroll-glass relative min-h-0 flex-1 overflow-y-auto overflow-x-hidden pr-[9px]"
        >
          <ul className="m-0 list-none p-0">
            {side.lineup.map((seat, i) => (
              <SeatRow key={`${seat.slot}-${i}`} seat={seat} game={gameOf(seat.player, board)} />
            ))}
          </ul>

          {side.lineup.length === 0 && (
            <p className="relative m-0 px-2 py-2 font-mono text-[length:var(--fs-11)] uppercase tracking-[0.14em] text-readout-label">
              No lineup read for this week
            </p>
          )}
        </div>

        {side.bench.length > 0 && (
          <>
            <PaneDrawer id={drawerId} open={benchOpen} bars={DRAWER_BARS.bench}>
              <div className="lab-scroll-glass min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
                <ul className="m-0 list-none p-0">
                  {side.bench.map((player) => (
                    <BenchRow key={player.player_id} player={player} game={gameOf(player, board)} />
                  ))}
                </ul>
              </div>
            </PaneDrawer>

            <div className="relative z-[3] shrink-0">
              <button
                type="button"
                onClick={() => setBenchOpen((held) => !held)}
                aria-expanded={benchOpen}
                aria-controls={drawerId}
                className={`${DRAWER_BAR} ${DRAWER_BAR_HEIGHT.bench} ${
                  benchOpen
                    ? "text-[color:var(--billet-accent)]"
                    : "text-[color:var(--billet-name)]"
                }`}
              >
                <DrawerBar open={benchOpen} label={`Bench · ${side.bench.length}`} />
              </button>
            </div>
          </>
        )}
      </PaneGlass>
    </Pane>
  );
}

/**
 * The pane's column heads, in the rows' own widths — the checker's, with a
 * `Game` head where its `Kick` was and `Live` where its `Gap` was. Hidden below
 * `lg`, where the seat row is two lines and its cells sit under the name.
 */
function ColumnHeads({ name, vs }: { name: string; vs: boolean }) {
  const head =
    "hidden shrink-0 font-mono text-[length:var(--fs-10)] uppercase tracking-[0.1em] text-[color:var(--billet-label)] lg:block";

  return (
    <div className="mt-1.5 flex items-baseline gap-[9px] px-[3px] lg:mt-0 lg:px-1 lg:pb-px lg:pt-[7px]">
      <span aria-hidden className={`w-[38px] text-center tracking-[0.14em] ${head}`}>
        Slot
      </span>
      <PaneHead className="min-w-0 flex-1">
        {vs && (
          <span className="tracking-[0.14em] text-[color:var(--billet-label)]">vs </span>
        )}
        {name}
      </PaneHead>
      <span aria-hidden className={`w-[5.5rem] text-right ${head}`}>
        Game
      </span>
      <span aria-hidden className={`w-14 text-right ${head}`}>
        Pts
      </span>
      <span aria-hidden className={`w-14 text-right ${head}`}>
        Live
      </span>
    </div>
  );
}

/**
 * One seat, as a channel cut into the pane's glass — the checker's row with
 * its cells re-read: slot (1), name (2), game clock (3), points scored (4),
 * live projection (5). One node in two layouts, turned at `lg` by
 * `lg:contents` on the two wrapping spans, for that row's reason.
 *
 * **Below `lg` the name has its line to itself and the clock joins the
 * second**, which a render at 375 forced: the clock beside the name left the
 * name one character — `M…` — on every row, the failure this app has recorded
 * at four other grains. The second line is the slot, the clock (which
 * truncates, being the one cell that can lose its tail and still read), and
 * the two figures; and **the scored cell is dropped there while it has nothing
 * to say**, since an em dash before kickoff on every row of a phone pane is
 * thirty pixels the clock needs more.
 *
 * **The clock column is 88px and untracked at `lg`**, the checker's own
 * measurement of the widest string the kickoff formatter can produce;
 * `Q3 05:32` and `Final` are shorter, so the column sized for the kickoff
 * holds every other reading for free.
 *
 * **The scored figure is null before kickoff and prints an em dash**, on the
 * contract's grammar: nothing has happened yet, which is a different answer
 * from a game he has played and scored nothing in.
 */
function SeatRow({ seat, game }: { seat: GametimeSeat; game: GametimeGame | null }) {
  const player = seat.player;
  const clock = gameClockLabel(game);
  const score = gameScoreLabel(game);
  const title = score ? `${clock.text} · ${score}` : undefined;

  return (
    <li
      className={`${CONSOLE_ROW_WELL} relative mb-[3px] flex h-[52px] w-full flex-col justify-center gap-[5px] rounded-[7px] border border-transparent px-1.5 text-left lg:h-[38px] lg:flex-row lg:items-center lg:gap-[9px] lg:px-2.5`}
    >
      <span className="relative flex w-full min-w-0 items-center gap-1.5 lg:contents">
        <span className="min-w-0 flex-1 truncate font-mono text-[length:var(--fs-12)] text-readout-line lg:order-2 lg:text-[length:var(--fs-13)]">
          {player ? (player.name ?? player.player_id) : "Empty"}
        </span>
      </span>

      <span className="relative flex w-full items-center gap-1.5 lg:contents">
        <span className="shrink-0 font-mono text-[length:var(--fs-9)] tracking-[0.1em] text-readout/62 lg:order-1 lg:w-[38px] lg:overflow-hidden lg:rounded-[5px] lg:bg-[color:var(--figure-well-bg)] lg:px-1 lg:py-0.5 lg:text-center lg:text-[length:var(--fs-11)] lg:tracking-[0.12em] lg:shadow-[var(--figure-well-shadow)]">
          {slotLabel(seat.slot)}
        </span>

        <span
          title={title}
          className={`min-w-0 flex-1 truncate whitespace-nowrap font-mono text-[length:var(--fs-9)] uppercase lg:order-3 lg:flex-none lg:w-[5.5rem] lg:text-right lg:text-[length:var(--fs-10)] ${
            clock.live ? "text-readout" : "text-readout/50"
          }`}
        >
          {clock.text}
        </span>

        <span
          className={`${CONSOLE_FIGURE_WELL} shrink-0 px-[5px] py-0.5 text-right font-mono text-[length:var(--fs-12)] tabular-nums text-readout-line lg:order-4 lg:w-14 lg:text-[length:var(--fs-12-5)] ${
            player?.scored == null ? "hidden lg:inline-block" : ""
          }`}
        >
          {player?.scored == null ? "—" : player.scored.toFixed(1)}
        </span>

        <span
          className={`${CONSOLE_FIGURE_WELL} shrink-0 px-[5px] py-0.5 text-right font-mono text-[length:var(--fs-12)] tabular-nums lg:order-5 lg:w-14 lg:text-[length:var(--fs-12-5)] ${
            clock.live ? "text-readout [text-shadow:var(--readout-text-glow)]" : "text-readout-line"
          }`}
          title={
            player?.projected == null
              ? undefined
              : `Projected ${player.projected.toFixed(1)} before kickoff`
          }
        >
          {player?.live == null ? "—" : player.live.toFixed(1)}
        </span>
      </span>
    </li>
  );
}

/**
 * A bench player, in the drawer behind the bar — `DrawerRow`, the shared
 * bench row, with the live figure in the well and the game clock in the note
 * slot where the checker's puts the NFL team.
 */
function BenchRow({ player, game }: { player: GametimePlayer; game: GametimeGame | null }) {
  const clock = gameClockLabel(game);
  return (
    <DrawerRow
      lead={player.positions[0] ?? "—"}
      leadWidth="lg:w-[38px]"
      figure={player.live == null ? "—" : player.live.toFixed(1)}
      note={clock.text || player.team}
    >
      <span className="relative min-w-0 flex-1 truncate text-[length:var(--fs-13)] text-[color:var(--billet-name)] lg:order-3">
        {player.name ?? player.player_id}
      </span>
      {player.scored != null && (
        <span className="shrink-0 font-mono text-[length:var(--fs-9)] tabular-nums tracking-[0.08em] text-[color:var(--billet-label)] lg:text-[length:var(--fs-10)]">
          {player.scored.toFixed(1)} pts
        </span>
      )}
    </DrawerRow>
  );
}
