"use client";

import { useId, useState } from "react";

import type { GametimeGame, GametimePlayer, GametimeSeat, GametimeSide } from "@/shared/contract";
import {
  DrawerBar,
  drawerBarClass,
  Pane,
  PaneDrawer,
  PaneFoot,
  PaneGlass,
  PaneHead,
  PaneLedge,
  PaneLedgeTrack,
  PaneTotal,
  PaneWeekRow,
  PANEL_BLEED,
  opponentLabel,
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
 * `PaneWeekRow`, a bench behind a drawer key on the pane's foot), the same two
 * row heights, and the same linked scroll, so a reader walking from the checker to
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
          <PaneDrawer id={drawerId} open={benchOpen}>
            <div className="lab-scroll-glass min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
              <ul className="m-0 list-none p-0">
                {side.bench.map((player) => (
                  <BenchRow key={player.player_id} player={player} game={gameOf(player, board)} />
                ))}
              </ul>
            </div>
          </PaneDrawer>
        )}
      </PaneGlass>

      {side.bench.length > 0 && (
        <PaneFoot>
          <button
            type="button"
            onClick={() => setBenchOpen((held) => !held)}
            aria-expanded={benchOpen}
            aria-controls={drawerId}
            className={drawerBarClass(benchOpen)}
          >
            <DrawerBar open={benchOpen} label={`Bench · ${side.bench.length}`} />
          </button>
        </PaneFoot>
      )}
    </Pane>
  );
}

/**
 * The pane's column heads, in the rows' own widths — the checker's, with a
 * `Game` head where its `Kick` was and `Live` where its `Gap` was. Hidden below
 * `lg`, where the seat row is two lines and its cells sit under the name.
 */
function ColumnHeads({ name, vs }: { name: string; vs: boolean }) {
  return (
    <div className="mt-1.5 flex items-baseline gap-[9px] px-[3px] lg:mt-0 lg:px-1 lg:pb-px lg:pt-[7px]">
      <PaneHead className="min-w-0 flex-1">
        {vs && (
          <span className="tracking-[0.14em] text-[color:var(--billet-label)]">vs </span>
        )}
        {name}
      </PaneHead>
      {/* **One head where there were five**, and the row is why: it has four
          zones now and one of them is a column a head can name. The bay prints
          the seat and is its own label, the face is a picture of somebody, and
          the clock and the scored total are on a run of game facts rather than
          in columns.

          It names `Live` rather than `Pts`, which is the one thing this pane's
          heads say differently from the checker's: the hero cell carries what a
          starter is **on course for**, which is the reading this page exists
          for, and what he has scored so far rides the second line beside the
          clock it is a fact about. */}
      <span
        aria-hidden
        className="hidden w-[70px] shrink-0 text-right font-mono text-[length:var(--fs-10)] uppercase tracking-[0.1em] text-[color:var(--billet-label)] lg:block"
      >
        Live
      </span>
    </div>
  );
}

/**
 * One seat, as a {@link PaneWeekRow} — the checker's row with its cells re-read.
 *
 * **The hero figure is `live` and the scored total rides the second line**,
 * which reverses the two columns this row used to draw and is the page's own
 * hierarchy: what a starter is *on course for* is the reading gametime exists
 * for, and what he has scored so far is how far along he is. The card's own
 * plate already says it that way — its hero is the live projection and the
 * score sits beside it.
 *
 * **Neither figure is on the rank ramp**, which is the one thing this row does
 * not take from the checker's. A live figure has nothing on this card to be a
 * standing *against* — the pane opposite is a different roster, not a
 * distribution — so a colour there would be a verdict nobody computed. What the
 * accent says instead is that the game is **running**.
 *
 * **The clock takes the kickoff's place on the second line**, which is the same
 * cell one tense later: before kickoff `gameClockLabel` prints the kickoff, and
 * after it the quarter and the clock. So a reader walking from the checker to
 * here finds the same fact in the same place, saying what it now knows.
 *
 * **The scored figure is null before kickoff and prints an em dash**, on the
 * contract's grammar: nothing has happened yet, which is a different answer
 * from a game he has played and scored nothing in.
 */
function SeatRow({ seat, game }: { seat: GametimeSeat; game: GametimeGame | null }) {
  const player = seat.player;
  const clock = gameClockLabel(game);
  const score = gameScoreLabel(game);
  const name = player ? (player.name ?? player.player_id) : "Empty";

  return (
    <PaneWeekRow
      seat={{ label: slotLabel(seat.slot), position: player?.positions[0] ?? null }}
      face={{ playerId: player?.player_id ?? null, name: player ? name : "" }}
      name={name}
      shortName={player?.name ? shortName(player.name) : name}
      // Not on the wire — see `PaneRow`'s lamp.
      status={null}
      note={player?.team ?? null}
      opponent={opponentLabel(game?.opponent ?? null, game?.home ?? false)}
      meta={clock.text || null}
      figure={{
        text: player?.live == null ? "—" : player.live.toFixed(1),
        live: clock.live,
      }}
      second={player?.scored == null ? "—" : player.scored.toFixed(1)}
      marks={
        // The score sits on an `sr-only` sentence rather than on screen: it is
        // context for the clock, and a third reading on the second line is the
        // width this pane cannot spare.
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
 * A bench player, in the drawer behind the bar — the shared bench row with the
 * live figure in the hero cell and the scored total beside the clock, which is
 * the seat rows' own arrangement one list down.
 *
 * His NFL team is one press away on the seats above, so the second line spends
 * its width on the game: where it is, and where he stands in it.
 */
function BenchRow({ player, game }: { player: GametimePlayer; game: GametimeGame | null }) {
  const clock = gameClockLabel(game);
  const name = player.name ?? player.player_id;

  return (
    <PaneWeekRow
      ground="drawer"
      seat={{
        label: player.positions[0] ?? "—",
        position: player.positions[0] ?? null,
      }}
      face={{ playerId: player.player_id, name }}
      name={name}
      shortName={player.name ? shortName(player.name) : name}
      status={null}
      note={player.team}
      opponent={opponentLabel(game?.opponent ?? null, game?.home ?? false)}
      meta={clock.text || null}
      figure={{
        text: player.live == null ? "—" : player.live.toFixed(1),
        live: clock.live,
      }}
      second={player.scored == null ? "—" : player.scored.toFixed(1)}
    />
  );
}
