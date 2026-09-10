"use client";

import { useId, useState, type ReactNode, type RefObject } from "react";

import type { LineupCheckLeague, LineupCheckPlayer, LineupCheckSeat } from "@/shared/contract";
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
  rankColor,
  slotLabel,
  useLinkedScroll,
} from "@/features/shared";

import { kickoffTime } from "../helpers/lineup-check-metrics";
import {
  seatGap,
  seatOptions,
  type SeatGap,
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
 * `PaneLedge`, `PaneGlass`, `CONSOLE_ROW_WELL` and a bench behind a pinned
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
 * comparison is the whole point of the view. What turns at `lg` is the seat
 * row: one line of columns with a two-track gap meter, two lines with the same
 * gap as a signed figure below. `LeagueTeams` measured that breakpoint for the
 * same reason one tool over — a name column squeezed to one character is the
 * layout at its most confident and least true.
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
 * above already reads.
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

  const mine: PaneLineup = {
    title: teamName,
    fallback: "Your lineup",
    set: entry.current_points,
    optimal: entry.optimal_points,
    lineup: entry.lineup,
    bench: entry.bench,
    promoted: entry.start,
    demoted: entry.sit,
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
};

/**
 * A roster's lineup, seat by seat, as a part.
 *
 * **Only the left pane draws the two-track meter, and only from `lg` up.** A
 * gap drawn on both sides is the same fact twice with the second copy
 * mirrored, and the two tracks are 98px the right pane does not have to spend
 * to say something already said opposite. The **phone draws the signed figure
 * in both panes**, which is not an inconsistency but the same rule in a room
 * with no tracks to mirror: there, a pane whose rows carried no comparison at
 * all would be half a comparison.
 *
 * **The right pane's third column collapses rather than being reserved**, and
 * that reverses what this file said first. Reserving it lines the two panes'
 * `Pts` columns up at the same distance from their own right edges, which
 * sounded worth 98px until a render at 1024 priced it: the right pane is
 * 404px, its seat row spends 38 on the slot, 56 on the points, 64 on the
 * kickoff and 98 on a column drawing nothing, and the name — the row's whole
 * subject — is left eight characters, on every opponent. That is the failure
 * this app has recorded at three other grains, and a numeric column's
 * alignment does not buy it.
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
  /** Draw the meters. The left pane only — see the note above. */
  gaps?: boolean;
  /** The pane is the one being played *against*, and says so before the name. */
  vs?: boolean;
  onPress?: (side: Side, index: number) => void;
  pick: SeatPick | null;
  scrollRef: RefObject<HTMLDivElement | null>;
}) {
  const drawerId = useId();
  const [benchOpen, setBenchOpen] = useState(false);

  // **The head names a column only where there is one.** A pane with no lineup
  // opposite it — a future week, an unpaired one — has nothing to compare, and
  // a `Gap` head over an empty column claims a measurement nobody made.
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

        <ColumnHeads
          name={pane.title ?? pane.fallback}
          vs={vs}
          gap={gaps && compares}
        />
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
                gap={compares ? seatGap(seat, opposite[i]) : null}
                // The left pane draws tracks from `lg` up; the right draws the
                // same figure on a phone and nothing above it.
                gapMode={gaps ? "meters" : "mirror"}
                demoted={
                  seat.player ? pane.demoted.includes(seat.player.player_id) : false
                }
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
 * There are no `Set`/`Opt` totals here: an option list is not a lineup and has
 * nothing to total. The ledge's track carries the `Back` key in their place,
 * which is the row a reader's eye is already on.
 */
function OptionsPane({
  side,
  seat,
  bench,
  onBack,
  scrollRef,
}: {
  side: Side;
  /** Undefined only if a payload shortened under an open pick — treated as none. */
  seat: LineupCheckSeat | undefined;
  bench: readonly LineupCheckPlayer[];
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
          gap={!locked}
          gapLabel="Vs seat"
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
                slot={option.inSeat && seat ? seat.slot : (option.player.positions[0] ?? "—")}
                player={option.player}
                option={option}
                gapMode="delta"
                selected={option.inSeat}
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
 * The inks are the **billet family**, not the readout's mint: a label stamped
 * into machined metal is not type on lit glass. The name takes
 * {@link PaneHead}, which is that rule for the one head that names something.
 *
 * `aria-hidden` on everything but the name, and the name is the one that
 * carries a *sentence* in the options state (`Locked — … has kicked off`),
 * which is why it is the only one a reader hears: `Kick`, `Pts` and `Gap`
 * restate what each cell already says, where the locked note is the pane's
 * whole answer.
 *
 * Hidden below `lg`, where the seat row is two lines and its cells sit under
 * the name rather than in columns — a head over a column that is not there
 * names nothing.
 */
function ColumnHeads({
  name,
  vs = false,
  gap,
  gapLabel = "Gap",
}: {
  name: string;
  vs?: boolean;
  /** Only where there is a column under it — see {@link LineupPane}. */
  gap: boolean;
  gapLabel?: string;
}) {
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
        Kick
      </span>
      <span aria-hidden className={`w-14 text-right ${head}`}>
        Pts
      </span>
      {gap && (
        <span aria-hidden className={`w-[98px] text-center ${head}`}>
          {gapLabel}
        </span>
      )}
    </div>
  );
}


/**
 * One seat, as a channel cut into the pane's glass.
 *
 * **38px at `lg` and 52 below it**, which are the manager card's own two row
 * heights and not this list's: the standings and the roster opposite are read
 * across each other there, and these two lineups are read across each other
 * here, so a row of a different height would put the two panes out of step.
 *
 * **One node in two layouts**, turned at `lg` by `lg:contents` on two wrapping
 * spans rather than by rendering the row twice and hiding one — which would put
 * every seat in the DOM twice and read each of them twice to anything
 * listening. Below `lg` the name takes a line of its own and the slot, the
 * points and the gap sit under it; above it they are one row of columns in the
 * order the heads above name: slot (1), name (2), kickoff (3), points (4), gap
 * (5).
 *
 * **The slot and the points are wells cut into the row**, which is the "cut
 * into a cut" nesting that gives the pane its depth without a gradient or a
 * border — `CONSOLE_FIGURE_WELL`'s own argument, and the same treatment the
 * manager card's seat row gives the same two cells.
 *
 * **Press is a lit border and an overlay, never a fill.** A fill floods the
 * channel and the row stops reading as a cut, which is the one thing every
 * surface in this half is arranged to be. The border's *colour* is composed by
 * the caller and its width is in the shape, for `CONSOLE_KEY_PILL`'s reason:
 * two `border-*` utilities of the same specificity are settled by Tailwind's
 * emit order rather than the class attribute. The halo rides the overlay's own
 * shadow rather than being appended to the row's, because a shadow list is
 * atomic and appending replaces it.
 */
function SeatRow({
  slot,
  player,
  moveTo,
  gap,
  gapMode = "delta",
  demoted = false,
  option,
  selected = false,
  onPress,
}: {
  slot: string;
  player: LineupCheckPlayer | null;
  moveTo?: string | null;
  gap?: SeatGap | null;
  /** Which of {@link GapCell}'s three readings this row's last cell is. */
  gapMode?: GapMode;
  demoted?: boolean;
  /** Set in the options pane: the row is a choice, and its delta is the last cell. */
  option?: SeatOption;
  selected?: boolean;
  onPress?: () => void;
}) {
  const kickoff = player ? kickoffTime(player.kickoff) : null;
  const delta = option ? option.delta : (gap?.delta ?? null);

  const body = (
    <>
      {selected && (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-x-0 inset-y-[2px] rounded-[7px] bg-[color:var(--row-well-selected-bg)] shadow-[var(--row-well-selected-shadow),0_0_20px_-6px_var(--accent-glow)]"
        />
      )}

      {/* **The name and its chips are one line below `lg`, and `lg:contents`
          is what makes that one node rather than two.** Left loose in the wrap
          they went to the *second* line, where a `sit` badge beside a slot, a
          figure and a gap overflows and takes the row to three lines — and a
          three-line row in one pane against a two-line row in the other is two
          lineups that no longer read across, which is the whole purpose of the
          view. On the name's own line the chip has the width and the name
          truncates to make it, which is the right thing to lose. */}
      <span className="relative flex w-full min-w-0 items-center gap-1.5 lg:contents">
        <span className="min-w-0 flex-1 truncate font-mono text-[length:var(--fs-12)] text-readout-line lg:order-2 lg:text-[length:var(--fs-13)]">
          {player ? (player.name ?? player.player_id) : "Empty"}
        </span>

        {/* A played game is not a move anybody can make, so it is marked
            rather than left to look like an oversight. */}
        {player?.locked && (
          <span className="shrink-0 font-mono text-[length:var(--fs-9)] uppercase tracking-[0.1em] text-readout-muted lg:order-2 lg:text-[length:var(--fs-10)] lg:tracking-[0.12em]">
            <span className="sr-only">Locked — </span>
            <span aria-hidden>locked</span>
          </span>
        )}
        {option?.inSeat && <Chip>in seat</Chip>}
        {demoted && <Chip tone="error">sit</Chip>}
        {/* Read off `move_to`, which the server derived with the same
            `kickoffMoves` the window's count came from — so the badge and the
            count cannot disagree. */}
        {moveTo && (
          <Chip>
            <span className="sr-only">Re-seat at </span>
            <span aria-hidden>{"→ "}</span>
            {slotLabel(moveTo)}
          </Chip>
        )}
      </span>

      <span className="relative flex w-full items-center gap-1.5 lg:contents">
        <span className="shrink-0 font-mono text-[length:var(--fs-9)] tracking-[0.1em] text-readout/62 lg:order-1 lg:w-[38px] lg:overflow-hidden lg:rounded-[5px] lg:bg-[color:var(--figure-well-bg)] lg:px-1 lg:py-0.5 lg:text-center lg:text-[length:var(--fs-11)] lg:tracking-[0.12em] lg:shadow-[var(--figure-well-shadow)]">
          {slotLabel(slot)}
        </span>

        {/* **A seat carries its kickoff and an option does not.** When a game
            starts is a fact about the lineup as it stands — it is what locks,
            and what the seat-order check is about. An options list is a
            comparison of projections, so the time is 88px spent on a question
            nobody is asking there, and it is 88px off the one column that
            truncates.

            **88px and untracked, where the design bundle draws 64.** That
            column was measured against `Sun 1:00`, and this app does not print
            that string: `kickoffTime` formats in the *reader's own* locale, so
            an en-US afternoon game is `Sun 12:00 PM`. Measured at `--fs-10` in
            this build's own Plex Mono, that is **97.4px tracked** and **83.5px
            untracked** — so at 64px the one reading a reader checks against a
            clock on the wall was cut, silently, on every row. Letter-spacing is
            the first thing to spend, which is this card's own rule about its
            window labels one plane up; 88px clears the longest string the
            formatter can produce by 4.5px, and a 24-hour locale simply leaves
            the cell short. The cost is the name column, which is why the head
            beside it is the only other place this width is written. */}
        {kickoff && !option && (
          <span className="order-1 hidden shrink-0 whitespace-nowrap text-right font-mono text-[length:var(--fs-10)] uppercase text-readout/50 lg:order-3 lg:block lg:w-[5.5rem]">
            {kickoff}
          </span>
        )}

        <span
          className={`${CONSOLE_FIGURE_WELL} ml-auto shrink-0 px-[5px] py-0.5 text-right font-mono text-[length:var(--fs-12)] tabular-nums text-readout-line lg:order-4 lg:ml-0 lg:w-14 lg:text-[length:var(--fs-12-5)]`}
        >
          {/* Null is "the feed has no row for him"; a real projected zero is
              `0.0`. The contract's own grammar, and the reason the gap beside it
              can be absent while the row still reads. */}
          {player?.points == null ? "—" : player.points.toFixed(1)}
        </span>

        <GapCell delta={delta} mode={gapMode} fill={gap} />
      </span>
    </>
  );

  const shape =
    `${CONSOLE_ROW_WELL} relative mb-[3px] flex h-[52px] w-full flex-col justify-center gap-[5px] ` +
    "rounded-[7px] border px-1.5 text-left lg:h-[38px] lg:flex-row lg:items-center lg:gap-[9px] lg:px-2.5";
  const state = selected ? "border-active" : "border-transparent";

  if (!onPress) {
    return (
      <li className={`${shape} ${state}`}>
        {body}
      </li>
    );
  }

  return (
    <li>
      <button
        type="button"
        onClick={onPress}
        aria-pressed={selected}
        className={`${shape} ${state} cursor-pointer transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-active/60 ${
          selected ? "" : "hover:border-active/45"
        }`}
      >
        {body}
      </button>
    </li>
  );
}

/**
 * A bench player, in the drawer behind the bar.
 *
 * {@link DrawerRow} is the manager card's own bench row, cell for cell — a
 * position, a face-less name, the NFL team in the note slot and the figure in a
 * well — because the two drawers are the same part over two lists. What is this
 * one's alone is the `start` chip: the optimal lineup would seat him, which is
 * the whole reason a reader opens this drawer.
 */
function BenchRow({
  player,
  promoted,
}: {
  player: LineupCheckPlayer;
  promoted: boolean;
}) {
  return (
    <DrawerRow
      lead={player.positions[0] ?? "—"}
      leadWidth="lg:w-[38px]"
      figure={player.points == null ? "—" : player.points.toFixed(1)}
      note={player.team}
    >
      <span className="relative min-w-0 flex-1 truncate text-[length:var(--fs-13)] text-[color:var(--billet-name)] lg:order-3">
        {player.name ?? player.player_id}
      </span>
      {promoted && <Chip>start</Chip>}
      {player.locked && (
        <span className="shrink-0 font-mono text-[length:var(--fs-9)] uppercase tracking-[0.1em] text-[color:var(--billet-label)] lg:text-[length:var(--fs-10)]">
          <span className="sr-only">Locked — </span>
          <span aria-hidden>locked</span>
        </span>
      )}
    </DrawerRow>
  );
}

/**
 * Which of three readings a row's last cell is.
 *
 * `meters` is the left lineup pane: two tracks from `lg` up, the signed figure
 * below it. `mirror` is the right lineup pane, whose gap is the left pane's
 * with the sign flipped — the same fact, so it is drawn on a phone (where
 * there are no tracks opposite to read it off) and reserved but blank above
 * `lg`. `delta` is an options pane's `Vs seat` column, which has no mirror
 * anywhere and prints at every width.
 */
type GapMode = "meters" | "mirror" | "delta";

/**
 * The last cell: the gap to the same seat opposite, or an option's delta.
 *
 * **Two 44px tracks meeting at the centre, and only ever one of them fills** —
 * left where this seat leads, right where the one opposite does. A bar drawn
 * from a centre line is the one shape that says "against" rather than "out
 * of", which is what the column is for.
 *
 * Below `lg` there is no room for two tracks and the same number is a signed
 * figure instead. It is the same measurement in less space rather than a
 * different reading, which is why both come off one `SeatGap`.
 *
 * **A null delta draws nothing at all** — no bar, no dash, no zero. Scoring an
 * unpriced player as zero would hand the other side a maximal, full-length
 * lead on a row whose own figures say there is nothing to compare. The cell
 * keeps its width regardless, so a pane's columns do not shift row to row.
 */
function GapCell({
  delta,
  mode,
  fill,
}: {
  delta: number | null;
  mode: GapMode;
  fill: SeatGap | null | undefined;
}) {
  // `mirror` draws on a phone and nothing above it, so above `lg` it must not
  // hold width either — see the note on `LineupPane`.
  const width = mode === "mirror" ? "" : "lg:w-[98px]";

  if (delta === null) {
    return <span aria-hidden className={`shrink-0 lg:order-5 ${width}`} />;
  }

  // The rank ramp's own two ends rather than a second green and a second red:
  // one ramp, so a good result is the same colour everywhere and both ends
  // invert for light mode together. `rankColor` is the only spelling of it.
  const tone = delta > 0 ? rankColor(100) : delta < 0 ? rankColor(0) : null;
  const glow = delta > 0 ? rankColor(100, 0.5) : rankColor(0, 0.5);
  const sign = delta > 0 ? "+" : delta < 0 ? "−" : "";
  const figure = (
    <span
      className={`font-mono text-[length:var(--fs-12)] tabular-nums ${
        tone ? "" : "text-readout-muted"
      } ${mode === "delta" ? "lg:text-[length:var(--fs-13)]" : "lg:hidden"}`}
      style={{ color: tone ?? undefined }}
    >
      {sign}
      {Math.abs(delta).toFixed(1)}
    </span>
  );

  return (
    <span
      className={`relative flex shrink-0 items-center justify-center gap-2.5 lg:order-5 ${width}`}
    >
      {mode === "meters" && fill && (
        <>
          <span
            aria-hidden
            className="hidden h-1 w-11 shrink-0 justify-end rounded-l-full bg-[var(--meter-track)] shadow-[inset_0_1px_3px_rgba(0,0,0,0.95)] lg:flex"
          >
            {fill.lead === "mine" && (
              <Bar fill={fill.fill} tone={tone} glow={glow} side="left" />
            )}
          </span>
          <span
            aria-hidden
            className="hidden h-1 w-11 shrink-0 rounded-r-full bg-[var(--meter-track)] shadow-[inset_0_1px_3px_rgba(0,0,0,0.95)] lg:block"
          >
            {fill.lead === "theirs" && (
              <Bar fill={fill.fill} tone={tone} glow={glow} side="right" />
            )}
          </span>
        </>
      )}
      {figure}
    </span>
  );
}

/** One filled half of a gap meter. A computed colour, so it goes through `style`. */
function Bar({
  fill,
  tone,
  glow,
  side,
}: {
  fill: number;
  tone: string | null;
  glow: string;
  side: "left" | "right";
}) {
  return (
    <span
      className={`block h-1 ${side === "left" ? "rounded-l-full" : "rounded-r-full"}`}
      style={{
        width: `${fill}%`,
        background: tone ?? undefined,
        boxShadow: `0 0 8px ${glow}`,
      }}
    />
  );
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
