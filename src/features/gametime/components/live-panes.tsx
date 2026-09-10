"use client";

import { useId, useState } from "react";

import type { GametimeGame, GametimePlayer, GametimeSeat, GametimeSide } from "@/shared/contract";
import {
  DrawerBar,
  DRAWER_BAR,
  DRAWER_BAR_HEIGHT,
  DRAWER_BARS,
  Pane,
  PaneDrawer,
  PaneGlass,
  PaneHead,
  PaneLedge,
  PaneLedgeTrack,
  PaneRow,
  PaneTotal,
  PANEL_BLEED,
  shortName,
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
 * `PaneRow`, a bench behind a pinned drawer bar), the same two row
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
      <span aria-hidden className={`w-[34px] text-center tracking-[0.14em] ${head}`}>
        Slot
      </span>
      {/* The face and the team code hold columns and have no head — there is
          nothing to call a picture of somebody, and three letters are their own
          label — but the heads need their widths, or each one sits left of the
          cell it names. */}
      <span aria-hidden className={`w-[22px] ${head}`} />
      <PaneHead className="min-w-0 flex-1">
        {vs && (
          <span className="tracking-[0.14em] text-[color:var(--billet-label)]">vs </span>
        )}
        {name}
      </PaneHead>
      <span aria-hidden className={`w-7 ${head}`} />
      <span aria-hidden className={`w-[88px] text-right ${head}`}>
        Game
      </span>
      <span aria-hidden className={`w-[70px] text-right ${head}`}>
        Pts
      </span>
      <span aria-hidden className={`w-14 text-right ${head}`}>
        Live
      </span>
    </div>
  );
}

/**
 * One seat, as a {@link PaneRow} — the checker's row with its cells re-read.
 *
 * **The row is the shared part now**, so the two heights, the two-line phone
 * arm, the cell order, the face this list did not draw and the sans name it did
 * not set are all that part's. What is this row's own is the clock and the
 * second figure.
 *
 * **`figure` is what he has scored and `second` is what he is on course for.**
 * They read left to right in the heads' own order, and neither is on the rank
 * ramp: a live figure has nothing on this card to be a standing *against* — the
 * pane opposite is a different roster, not a distribution — so a colour there
 * would be a verdict nobody computed. What the accent says instead is that the
 * game is **running**, which is the one thing a reader scanning the column is
 * looking for.
 *
 * **The clock column is 88px and untracked at `lg`**, the checker's own
 * measurement of the widest string the kickoff formatter can produce;
 * `Q3 05:32` and `Final` are shorter, so a column sized for the kickoff holds
 * every other reading for free. Below `lg` it takes the line's own slack and
 * truncates, which is where it already sat.
 *
 * **The scored figure is null before kickoff and prints an em dash**, on the
 * contract's grammar: nothing has happened yet, which is a different answer
 * from a game he has played and scored nothing in. It is drawn at both widths
 * now, where the phone arm used to drop it — the part gives the second line a
 * fixed shape, and a cell that came and went between rows is what made two
 * lineups stop reading across.
 */
function SeatRow({ seat, game }: { seat: GametimeSeat; game: GametimeGame | null }) {
  const player = seat.player;
  const clock = gameClockLabel(game);
  const score = gameScoreLabel(game);
  const name = player ? (player.name ?? player.player_id) : "Empty";

  return (
    <PaneRow
      lead={{ label: slotLabel(seat.slot), position: player?.positions[0] ?? null }}
      face={{ playerId: player?.player_id ?? null, name: player ? name : "" }}
      name={name}
      shortName={player?.name ? shortName(player.name) : name}
      // Not on the wire — see `PaneRow`'s lamp.
      status={null}
      note={player?.team ?? null}
      meta={clock.text || null}
      figure={{
        text: player?.scored == null ? "—" : player.scored.toFixed(1),
        percentile: null,
      }}
      second={{
        text: player?.live == null ? "—" : player.live.toFixed(1),
        live: clock.live,
      }}
      marks={
        // The score sits on the row's `title` rather than on screen: it is
        // context for the clock, and a second reading beside four figures is
        // the column this pane cannot spare.
        score ? (
          <span className="sr-only">
            {clock.text} · {score}
          </span>
        ) : undefined
      }
    />
  );
}

/**
 * A bench player, in the drawer behind the bar — the shared bench row, with the
 * live figure in the figure cell and the game clock where the checker's puts
 * the NFL team.
 *
 * The clock wins the note slot where there is one, because on a live page where
 * a bench player's game *is* is the reading, and his NFL team is one press from
 * the seat rows above. The scored figure rides `second`, which is the same cell
 * the seats put `Live` in — one column down the pane, whichever list is on it.
 */
function BenchRow({ player, game }: { player: GametimePlayer; game: GametimeGame | null }) {
  const clock = gameClockLabel(game);
  const name = player.name ?? player.player_id;

  return (
    <PaneRow
      ground="drawer"
      lead={{
        label: player.positions[0] ?? "—",
        position: player.positions[0] ?? null,
      }}
      face={{ playerId: player.player_id, name }}
      name={name}
      shortName={player.name ? shortName(player.name) : name}
      status={null}
      note={clock.text || player.team}
      figure={{
        text: player.scored == null ? "—" : player.scored.toFixed(1),
        percentile: null,
      }}
      second={{
        text: player.live == null ? "—" : player.live.toFixed(1),
        live: clock.live,
      }}
    />
  );
}
