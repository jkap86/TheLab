"use client";

import { useId, useState, type ReactNode, type RefObject } from "react";

import type { LineupCheckLeague, LineupCheckPlayer, LineupCheckSeat } from "@/shared/contract";
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
  PaneTotal,
  PaneWeekRow,
  PANEL_BLEED,
  opponentLabel,
  shortName,
  slotLabel,
  useLinkedScroll,
} from "@/features/shared";

import {
  irMarkFor,
  irMoves,
  kickoffTime,
  type IrMark,
  type IrMoves,
} from "../helpers/lineup-check-metrics";
import {
  seatGap,
  seatOptions,
  type SeatOption,
  type SeatPick,
  type Side,
} from "../helpers/seat-options";

/**
 * The open card's week: your lineup against the one it plays, seat by seat,
 * and the slot options behind any seat you press.
 *
 * **It is the manager card's browser with two lineups in it.** The week view
 * was an inner housing holding two bare `<div>`s, one scroller for the lot, a
 * full-width control bar and rows drawn as lit pressable windows; the manager
 * card's is two *parts* — a billet carrying a ledge and a sheet of glass — with
 * its rows cut as channels into that glass. The two pages list the same leagues
 * and draw the same card, so the open half is the same object too: `Pane`,
 * `PaneLedge`, `PaneGlass`, `PaneWeekRow` and a bench behind a pinned
 * drawer bar, all of them the shared parts rather than a second spelling.
 *
 * **The state lives here rather than on the card**, which is what keeps
 * `LineupCheckCard` hook-free — its own stated design, and `LeagueSyncKey`'s
 * precedent one file over. It also gets the per-card scoping for free: a pick
 * is an *index into one lineup* and means nothing outside it, so a second
 * league opening must not inherit the first's, and a component mounted per
 * card cannot.
 *
 * **The options land in the pane opposite the seat that was pressed, and they
 * belong to the side that was pressed.** Pressing your own RB shows *your*
 * alternatives at RB where the opponent's lineup was; pressing theirs shows
 * theirs where yours was. The lineup being reasoned about never moves out from
 * under the press — only the far pane changes — and the ledge names whose
 * options they are rather than leaving it to be read off position.
 *
 * **The panes sit side by side at every width**, phones included, because the
 * comparison is the whole point of the view. The seat row is two lines at both
 * widths now — the phone's shape taken up to the desktop rather than the other
 * way about — and what turns at `lg` is how much of the game fits on the second
 * of them, plus whether the face and the figure are cells of the row or of the
 * name's own line. See {@link PaneWeekRow}, which owns all of it.

 * **The two-track gap meter is gone**, and with it the 28px team cell and the
 * 88px kickoff cell: the first is the figure's own ink and the other two are on
 * the second line. What that buys is the row's subject — the name goes from
 * about 101px to about 231px at a 1180px card, which is the whole of the pass
 * that replaced the row.
 *
 * **Equal-width panes, where the two used to split 1 / 0.78.** That split
 * existed because the right pane drew no gap column; with the totals moved onto
 * each pane's own ledge both panes hold the same cells, and an uneven split
 * reads as one of them cut short — `Pane`'s own note about the standings and
 * roster panes, one card over.
 *
 * **The two glass scrollers are linked**, which is the one thing this view adds
 * to the grammar it adopts: its two lineups are read *across* — a seat row
 * against the seat row opposite — and per-pane scrollers are what would put
 * them out of step. See {@link useLinkedScroll}.
 *
 * Every figure is stated once and derived in one place: the seat gaps come off
 * the two lineups through `seatGap`, an option's delta off the seat it would
 * replace through `seatOptions`, and the four totals off the payload the card
 * above already reads. Both gaps are read for their **sign** alone — the figure
 * they ink is where the comparison lives now.
 *
 * **The IR marks read the same `irMoves` the roster tile does**, so a tile
 * saying `1 to IR` and a bench wearing two `→ IR` chips cannot be two readings
 * of one league. They are drawn on the reader's rows alone: the opponent's
 * reserve is not on the wire, and a move only the reader can make is not a
 * mark to put on somebody else's roster — `move_to`'s own argument. One grain
 * to know about: the reading is the **live** roster's and the rows are the
 * **week's**, so on a stepped past week a listed player with no row draws
 * nothing, and a starter can wear `IR` because he is on IR *today* — the same
 * "as set now" caveat the card already prints for a lineup it read live.
 */
export function WeekPanes({
  entry,
  teamName,
}: {
  entry: LineupCheckLeague;
  /** What the reader calls their own team — the card's league row knows it. */
  teamName: string | null;
}) {
  const [pick, setPick] = useState<SeatPick | null>(null);

  const theirs = entry.opponent_lineup;
  const clear = () => setPick(null);
  const press = (side: Side, index: number) =>
    setPick((held) =>
      held && held.side === side && held.index === index
        ? null
        : { side, index },
    );

  // **Best ball has no seat to offer options for.** Sleeper seats the lineup
  // itself after the games, so every alternative is a move nobody makes — the
  // same reason the gap and kickoff tiles answer nothing there. The seats
  // render as plain rows rather than as keys that would do something.
  const pressable = !entry.best_ball;

  const moves = irMoves(entry);

  const mine: PaneLineup = {
    title: teamName,
    fallback: "Your lineup",
    set: entry.current_points,
    optimal: entry.optimal_points,
    lineup: entry.lineup,
    bench: entry.bench,
    promoted: entry.start,
    demoted: entry.sit,
    ir: moves,
  };

  const opponent: PaneLineup | null =
    theirs === null
      ? null
      : {
          title: entry.opponent_team_name,
          fallback: "Their lineup",
          set: entry.opponent_points,
          optimal: entry.opponent_optimal_points,
          lineup: theirs,
          bench: entry.opponent_bench ?? [],
          // The optimal lineup's moves are answers about a lineup the reader
          // can set. Marking the opponent's would suggest moves nobody here
          // makes — the same argument that leaves `move_to` null on their seats.
          promoted: [],
          demoted: [],
          ir: null,
        };

  // With no opponent there is one lineup and nothing to compare it to, so the
  // second pane exists only once a press has something to put in it. The
  // alternative — replacing the single pane — would move the lineup out from
  // under the press, which is the one thing this interaction is arranged not to
  // do.
  const second = opponent !== null || pick !== null;
  const { left, right } = useLinkedScroll([pick, second]);

  return (
    // `preserve-3d` is what carries the panel's perspective down to the two
    // parts below: a perspective projects an element's *direct* children only,
    // so without it the panes' `translateZ` would compute to an identity
    // transform — no error, and no depth. It is safe here for the reason it is
    // not on the card's summary: nothing in this subtree clips.
    //
    // **It is a column that fills whatever height it is given**, which is what
    // lets the card cap its expanded half to the viewport: `min-h-0 flex-1`
    // here and on the row below hands the panes the panel's remaining height,
    // and they scroll their own lists inside it. Without the `min-h-0` a flex
    // item refuses to go below its content, the cap has nothing to bite on, and
    // two full lineups push the page exactly as they did before.
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
        {pick?.side === "theirs" && opponent ? (
          <OptionsPane
            side="theirs"
            seat={opponent.lineup[pick.index]}
            bench={opponent.bench}
            // The optimal lineup's moves are answers about a lineup the reader
            // can set — `PaneLineup.promoted`'s own argument, one pane over.
            promoted={[]}
            ir={null}
            onBack={clear}
            scrollRef={left}
          />
        ) : (
          <LineupPane
            side="mine"
            pane={mine}
            opposite={opponent?.lineup}
            gaps
            onPress={pressable ? press : undefined}
            pick={pick}
            scrollRef={left}
          />
        )}

        {pick?.side === "mine" ? (
          <OptionsPane
            side="mine"
            seat={entry.lineup[pick.index]}
            bench={entry.bench}
            promoted={entry.start}
            ir={moves}
            onBack={clear}
            scrollRef={right}
          />
        ) : (
          opponent && (
            <LineupPane
              side="theirs"
              pane={opponent}
              opposite={entry.lineup}
              vs
              onPress={pressable ? press : undefined}
              pick={pick}
              scrollRef={right}
            />
          )
        )}
      </div>
    </div>
  );
}

// The two glass scrollers are linked through `useLinkedScroll`, shared since
// the gametime panes read across each other the same way — see that hook for
// the guard that is the whole of it.

/** One roster, as a pane draws it. */
type PaneLineup = {
  /** Null where nobody has been named — the fallback is used and says so. */
  title: string | null;
  fallback: string;
  set: number | null;
  optimal: number | null;
  lineup: LineupCheckSeat[];
  bench: LineupCheckPlayer[];
  promoted: string[];
  demoted: string[];
  /** The IR moves this roster wants, or null for a roster nobody here moves. */
  ir: IrMoves | null;
};

/**
 * A roster's lineup, seat by seat, as a part.
 *
 * **Only the left pane's figures are inked, and that is the two-track meter's
 * own rule with the column gone.** A gap drawn on both sides is the same fact
 * twice with the second copy mirrored — the opponent's gap *is* the reader's
 * with the sign flipped — so the pane being played against keeps the neutral
 * figure ink at every width. What the reader loses by it is nothing: the same
 * comparison is on the row opposite, which is the row they are reading it
 * against.
 *
 * That replaces a column and two of its arguments. The meter was 98px of tracks
 * at `lg` and a signed figure below it, reserved-but-blank on the right pane
 * above `lg` and drawn on it below — three readings of one measurement, and the
 * reason the two panes could not simply be the same. They are now, and the
 * figure they both end with is the one place the comparison lives.
 */
function LineupPane({
  side,
  pane,
  opposite,
  gaps = false,
  vs = false,
  onPress,
  pick,
  scrollRef,
}: {
  side: Side;
  pane: PaneLineup;
  opposite: LineupCheckSeat[] | undefined;
  /** Ink the figures by their gap. The left pane only — see the note above. */
  gaps?: boolean;
  /** The pane is the one being played *against*, and says so before the name. */
  vs?: boolean;
  onPress?: (side: Side, index: number) => void;
  pick: SeatPick | null;
  scrollRef: RefObject<HTMLDivElement | null>;
}) {
  const drawerId = useId();
  const [benchOpen, setBenchOpen] = useState(false);

  // **A figure is inked only where there is something to compare it to.** A
  // pane with no lineup opposite it — a future week, an unpaired one — has no
  // gap, and a green figure over a comparison nobody made is a claim.
  const compares = opposite !== undefined;
  const starts = pane.bench.filter((p) => pane.promoted.includes(p.player_id)).length;

  return (
    <Pane>
      <PaneLedge>
        <PaneLedgeTrack legend={side === "mine" ? "Yours" : "Theirs"}>
          <PaneTotal label="Set" value={pane.set} />
          {/* The error tone on `Opt` is not an alert — it is the figure the set
              lineup is being measured against, drawn in the same ink the gap
              window above the card draws its shortfall in, so the two read as
              one claim. A pane whose set total already equals it is simply
              level.

              **It is drawn at every width now, where it used to drop below
              `lg`.** That drop was a measurement — a pane is ~165px at 390
              and the labelled pair was 160px of a ~148px track — and it was
              made on the argument that the card's `Vs optimal` window above
              already reports the reader's own `Opt`. That window folds away
              while the card is open now, so the ledge is the one place the
              figure survives, and the track was re-cut to hold both: see
              `PaneLedgeTrack` and `PaneTotal` for the phone's tighter padding,
              gaps and tracking, which is what fits the pair in. */}
          <PaneTotal label="Opt" value={pane.optimal} tone="error" />
        </PaneLedgeTrack>

        <ColumnHeads name={pane.title ?? pane.fallback} vs={vs} />
      </PaneLedge>

      {/* A frame rather than a scroller: the seats scroll inside it, the bench
          drawer rises inside it, and its bar is pinned to the floor.
          `overflow-hidden` is what keeps the drawer's own corners inside the
          glass's radius and what stops a mid-animation drawer painting over the
          pane's edge. */}
      <PaneGlass className="flex flex-col overflow-hidden p-[3px]">
        {/* `pr-[9px]`: the scrollbar's gutter, so a figure's last digit clears
            the thumb — the manager card's roster pane makes the same
            measurement, and this scroller sits 3px inside a frame that already
            spends some of it. */}
        <div
          ref={scrollRef}
          className="lab-scroll-glass relative min-h-0 flex-1 overflow-y-auto overflow-x-hidden pr-[9px]"
        >
          <ul className="m-0 list-none p-0">
            {pane.lineup.map((seat, i) => (
              <SeatRow
                key={`${seat.slot}-${i}`}
                slot={seat.slot}
                player={seat.player}
                moveTo={seat.move_to}
                gap={gaps && compares ? seatGap(seat, opposite[i]) : null}
                demoted={
                  seat.player ? pane.demoted.includes(seat.player.player_id) : false
                }
                irMark={seat.player ? irMarkFor(seat.player.player_id, pane.ir) : null}
                selected={pick?.side === side && pick.index === i}
                onPress={onPress ? () => onPress(side, i) : undefined}
              />
            ))}
          </ul>

          {pane.lineup.length === 0 && (
            <p className="relative m-0 px-2 py-2 font-mono text-[length:var(--fs-11)] uppercase tracking-[0.14em] text-readout-label">
              No lineup read for this week
            </p>
          )}
        </div>

        {pane.bench.length > 0 && (
          <>
            <PaneDrawer id={drawerId} open={benchOpen} bars={DRAWER_BARS.bench}>
              <div className="lab-scroll-glass min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
                <ul className="m-0 list-none p-0">
                  {pane.bench.map((player) => (
                    <BenchRow
                      key={player.player_id}
                      player={player}
                      promoted={pane.promoted.includes(player.player_id)}
                      irMark={irMarkFor(player.player_id, pane.ir)}
                    />
                  ))}
                </ul>
              </div>
            </PaneDrawer>

            {/* Above the drawer, so a drawer at full height stops at the bar
                rather than under it. */}
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
                <DrawerBar open={benchOpen} label={`Bench · ${pane.bench.length}`}>
                  {starts > 0 && (
                    // How many of them the optimal lineup would start, which is
                    // the one thing the bar can say that the count cannot.
                    //
                    // **Dropped below `lg`**, which the manager card's own bar
                    // does with its total for the same reason and is a
                    // measurement here: this pane is half that card's, so the
                    // bar is ~155px at 390 and a 62px chip leaves `Bench · 7`
                    // fifty of the seventy it needs — the count the bar is read
                    // for, truncated. Nothing is lost that is not one press
                    // away: every promoted player carries a `start` chip on his
                    // own row inside the drawer.
                    <span className="hidden shrink-0 whitespace-nowrap rounded-full border border-active/40 px-1.5 py-0.5 font-mono text-[length:var(--fs-9)] tracking-[0.1em] text-[color:var(--billet-accent)] lg:inline-flex">
                      {starts} start
                    </span>
                  )}
                </DrawerBar>
              </button>
            </div>
          </>
        )}
      </PaneGlass>
    </Pane>
  );
}

/**
 * One slot's options: everyone on that roster who may legally sit there.
 *
 * **A locked seat answers with the note and an empty list**, which is the whole
 * reason this pane has two states — his game has kicked off, Sleeper will
 * refuse the move, and a list of alternatives under a name that cannot move is
 * a claim the reader would act on. `seatOptions` returns nothing for one, so
 * the two halves cannot come apart.
 *
 * **The man in the seat is not on the list.** He was its first row, selected
 * and chipped `in seat` — a row that answers nothing, since pressing his seat
 * is what opened the pane and the lineup opposite is still showing him. Every
 * delta here is measured against his figure, which is on screen throughout.
 *
 * **The rows are the bench drawer's**, ground and all, because that is what
 * they are: the same players, one press away. A **locked** candidate stays on
 * the list with the padlock in his bay saying why, where an absence reads as a
 * player the app has lost — the other half of `seatOptions`' own rule.
 *
 * There are no `Set`/`Opt` totals here: an option list is not a lineup and has
 * nothing to total. The ledge's track carries the `Back` key in their place,
 * which is the row a reader's eye is already on.
 */
function OptionsPane({
  side,
  seat,
  bench,
  promoted,
  ir,
  onBack,
  scrollRef,
}: {
  side: Side;
  /** Undefined only if a payload shortened under an open pick — treated as none. */
  seat: LineupCheckSeat | undefined;
  bench: readonly LineupCheckPlayer[];
  /** Who the optimal lineup would seat — the same chip the bench drawer draws. */
  promoted: readonly string[];
  /** The reader's IR moves — an option on IR is one Sleeper will not seat. */
  ir: IrMoves | null;
  onBack: () => void;
  scrollRef: RefObject<HTMLDivElement | null>;
}) {
  const options = seat ? seatOptions(seat, bench) : [];
  const locked = seat?.player?.locked === true;
  const held = seat?.player;

  return (
    <Pane>
      <PaneLedge>
        <PaneLedgeTrack legend={side === "mine" ? "Yours" : "Theirs"}>
          <button
            type="button"
            onClick={onBack}
            // **No touch floor, which is the manager card's own geometry for a
            // control on a pane ledge**: its column key and its lens select take
            // the track's height and nothing more. A 44px key here would make
            // the options ledge taller than the lineup ledge opposite it, and
            // the two panes' rows would stop reading across — which is the one
            // thing this view is arranged for.
            className="shrink-0 rounded-full border border-active/40 px-2.5 py-[3px] font-mono text-[length:var(--fs-9)] uppercase tracking-[0.14em] text-active transition-colors hover:border-active/70 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-active/60"
          >
            Back
          </button>
        </PaneLedgeTrack>

        <ColumnHeads
          // Whose options, said rather than left to position: the pane they
          // land in is the *opposite* one, so a reader with only the column to
          // go on would read them as the other side's.
          name={
            locked
              ? `Locked — ${held?.name ?? held?.player_id} has kicked off`
              : `${side === "mine" ? "Your" : "Their"} options · ${seat ? slotLabel(seat.slot) : "—"}`
          }
        />
      </PaneLedge>

      <PaneGlass className="flex flex-col overflow-hidden p-[3px]">
        <div
          ref={scrollRef}
          className="lab-scroll-glass relative min-h-0 flex-1 overflow-y-auto overflow-x-hidden pr-[9px]"
        >
          <ul className="m-0 list-none p-0">
            {options.map((option) => (
              <SeatRow
                key={option.player.player_id}
                ground="drawer"
                // His own position, not the seat's: these are the bench's rows,
                // and what a reader is choosing between is players rather than
                // seats. The seat is named once, on the ledge above them.
                slot={option.player.positions[0] ?? "—"}
                player={option.player}
                option={option}
                promoted={promoted.includes(option.player.player_id)}
                irMark={irMarkFor(option.player.player_id, ir)}
              />
            ))}
          </ul>

          {options.length === 0 && !locked && (
            <p className="relative m-0 px-2 py-2 font-mono text-[length:var(--fs-11)] uppercase tracking-[0.14em] text-readout-label">
              Nobody else can sit here
            </p>
          )}
        </div>
      </PaneGlass>
    </Pane>
  );
}

// The ledge's track and its totals are `PaneLedgeTrack` and `PaneTotal`,
// shared with the gametime panes — see `features/shared/ui/pane.tsx`, which
// carries the phone re-cut that lets both totals sit in a 390px track.

/**
 * The pane's column heads, in the rows' own widths.
 *
 * **Two of them, where there were six.** The row has four zones now and only
 * one of them is a column a head can name: the bay prints the seat and is its
 * own label, the face is a picture of somebody, and the second line is a run of
 * game facts rather than a column. What is left is the pane's name and the
 * figure, which is the design's own head row.
 *
 * The inks are the **billet family**, not the readout's mint: a label stamped
 * into machined metal is not type on lit glass. The name takes {@link PaneHead},
 * which is that rule for the one head that names something.
 *
 * `aria-hidden` on the figure's head and not on the name's, because the name is
 * the one that carries a *sentence* in the options state (`Locked — … has
 * kicked off`): `Pts` restates what the cell under it already says, where the
 * locked note is the pane's whole answer.
 *
 * Hidden below `lg`, where the row's figure sits on the name's own line rather
 * than in a column — a head over a column that is not there names nothing.
 */
function ColumnHeads({ name, vs = false }: { name: string; vs?: boolean }) {
  return (
    <div className="mt-1.5 flex items-baseline gap-[9px] px-[3px] lg:mt-0 lg:px-1 lg:pb-px lg:pt-[7px]">
      <PaneHead className="min-w-0 flex-1">
        {vs && (
          <span className="tracking-[0.14em] text-[color:var(--billet-label)]">vs </span>
        )}
        {name}
      </PaneHead>
      <span
        aria-hidden
        className="hidden w-[70px] shrink-0 text-right font-mono text-[length:var(--fs-10)] uppercase tracking-[0.1em] text-[color:var(--billet-label)] lg:block"
      >
        Pts
      </span>
    </div>
  );
}

/**
 * One seat, as a {@link PaneWeekRow}.
 *
 * **Four zones where the row had seven cells**, and what went is what this
 * caller used to hand over: the 98px two-track gap meter, the 28px team cell
 * and the 88px kickoff cell. The first is the figure's own ink now — with no
 * column beside it, the figure is where the comparison lives — and the other
 * two moved onto the row's second line, which is what takes the subject's
 * column from about 101px to about 231px at a 1180px card.
 *
 * **Two of the badges went into the bay**, which is the other half of the same
 * move: `locked` and `→ SF` were marks on the name's line, competing with `sit`
 * and the IR chips for a width the name wanted. They are facts about the
 * *seat* rather than about the player, so the bay draws them — a padlock under
 * a graphite insert, and the target slot under a chevron — and the name's line
 * keeps only the badges that are about the man in it.
 *
 * **A seat and an option both carry a kickoff now**, where an option used to
 * carry none. That was a measurement rather than a principle: the time was 88px
 * of column spent on a question an options list is not asking. The second line
 * has no column to spend, so the cost is gone and the reading is worth having —
 * a candidate whose game starts on Monday night is a different choice from one
 * who starts at one o'clock.
 */
function SeatRow({
  slot,
  player,
  moveTo,
  gap,
  demoted = false,
  irMark = null,
  option,
  promoted = false,
  selected = false,
  onPress,
  ground = "glass",
}: {
  slot: string;
  player: LineupCheckPlayer | null;
  moveTo?: string | null;
  /** This seat less the one opposite, or an option's delta. Only its sign is read. */
  gap?: number | null;
  demoted?: boolean;
  /** What the IR reading says of him — see {@link IrChip}. */
  irMark?: IrMark | null;
  /** Set in the options pane: the row is a choice, and its delta inks its figure. */
  option?: SeatOption;
  /** The optimal lineup would seat him — the bench drawer's and the options list's chip. */
  promoted?: boolean;
  selected?: boolean;
  onPress?: () => void;
  ground?: "glass" | "drawer";
}) {
  const name = player ? (player.name ?? player.player_id) : "Empty";
  const delta = option ? option.delta : (gap ?? null);

  return (
    <PaneWeekRow
      ground={ground}
      seat={{
        label: slotLabel(slot),
        position: player?.positions[0] ?? null,
        moveTo: moveTo ? slotLabel(moveTo) : null,
        locked: player?.locked === true,
      }}
      face={{ playerId: player?.player_id ?? null, name: player ? name : "" }}
      name={name}
      shortName={player?.name ? shortName(player.name) : name}
      // Not on the wire — see `PaneRow`'s lamp.
      status={null}
      marks={
        <>
          {promoted && <Chip>start</Chip>}
          {demoted && <Chip tone="error">sit</Chip>}
          <IrChip mark={irMark} />
        </>
      }
      note={player?.team ?? null}
      opponent={opponentLabel(player?.opponent ?? null, player?.home ?? false)}
      meta={player ? kickoffTime(player.kickoff) : null}
      figure={{
        // Null is "the feed has no row for him"; a real projected zero is
        // `0.0`. The contract's own grammar, and the reason the ink beside it
        // can be absent while the row still reads.
        text: player?.points == null ? "—" : player.points.toFixed(1),
        // **The sign, and only the sign.** The ramp's two ends, through
        // `rankColor`, so a good result is the same colour everywhere and both
        // ends invert for light mode together. A level seat and an unmeasured
        // one both take the neutral figure ink — the first because there is
        // nothing to say and the second because there is nothing to say it
        // about, which is the three-way grammar the cell above already keeps.
        percentile: delta == null || delta === 0 ? null : delta > 0 ? 100 : 0,
      }}
      selected={selected}
      onPress={onPress}
    />
  );
}

/**
 * A bench player, in the drawer behind the bar.
 *
 * The same row the seats are drawn with, one ground down — a drawer's rows
 * stand on a *part* rather than on the lit glass, which is the one step of cast
 * between them. Its bay prints his own position rather than a seat's, because
 * there is no seat: he is a candidate for one, which is what the drawer is
 * opened to see.
 *
 * **It carries no gap**, and that is the honest reading rather than an
 * omission: a gap is this seat against the same seat opposite, and a bench
 * player is in no seat to have one. The `start` chip is what this list is read
 * for, and it is the optimal lineup's own answer.
 */
function BenchRow({
  player,
  promoted,
  irMark = null,
}: {
  player: LineupCheckPlayer;
  promoted: boolean;
  /** What the IR reading says of him — see {@link IrChip}. */
  irMark?: IrMark | null;
}) {
  return (
    <SeatRow
      ground="drawer"
      slot={player.positions[0] ?? "—"}
      player={player}
      promoted={promoted}
      irMark={irMark}
    />
  );
}

/**
 * The IR reading's mark on a row, off {@link irMarkFor}: the move Sleeper
 * blocks on (`off IR`, in the error tone), the move that is open (`→ IR`), or
 * the plain fact that he is parked (`IR`). Each letter is `aria-hidden` under
 * a sentence, on `GameChip`'s rule that a bare `IR` announced as "IR" is not a
 * reading. Nothing for a row the reading says nothing about.
 */
function IrChip({ mark }: { mark: IrMark | null }) {
  if (mark === "off") {
    return (
      <Chip tone="error">
        <span className="sr-only">Not IR-eligible — </span>
        off IR
      </Chip>
    );
  }
  if (mark === "to") {
    return (
      <Chip>
        <span className="sr-only">Eligible for </span>
        <span aria-hidden>{"→ "}</span>
        IR
      </Chip>
    );
  }
  if (mark === "on") {
    return (
      <Chip>
        <span className="sr-only">On injured reserve</span>
        <span aria-hidden>IR</span>
      </Chip>
    );
  }
  return null;
}

/** A seat's badge — a move, a verdict, or the holder's own marker. */
function Chip({ tone, children }: { tone?: "error"; children: ReactNode }) {
  return (
    <span
      className={`shrink-0 whitespace-nowrap rounded-full border px-1.5 py-0.5 font-mono text-[length:var(--fs-9)] uppercase tracking-[0.12em] lg:order-2 ${
        tone === "error" ? "border-error/40 text-error" : "border-active/40 text-active"
      }`}
    >
      {children}
    </span>
  );
}
