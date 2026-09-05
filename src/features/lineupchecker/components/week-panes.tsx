"use client";

import { useState, type ReactNode } from "react";

import type { LineupCheckLeague, LineupCheckPlayer, LineupCheckSeat } from "@/shared/contract";
import { CONSOLE_WINDOW_KEY, rankColor } from "@/features/shared";

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
 * under the press — only the far pane changes — and the header names whose
 * options they are rather than leaving it to be read off position.
 *
 * **The panes sit side by side at every width**, phones included, because the
 * comparison is the whole point of the view. What turns at `lg` is the seat
 * card: one line with a two-track gap meter above it, two lines with the same
 * gap as a signed figure below. `LeagueTeams` measured that breakpoint for the
 * same reason one tool over — a name column squeezed to one character is the
 * layout at its most confident and least true.
 *
 * Every figure is stated once and derived in one place: the seat gaps come off
 * the two lineups through `seatGap`, an option's delta off the seat it would
 * replace through `seatOptions`, and the four totals off the payload the plate
 * above the card already reads.
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

  return (
    <div
      className={`relative grid gap-2.5 lg:gap-4 ${
        // With no opponent there is one lineup and nothing to compare it to, so
        // the second column exists only once a press has something to put in
        // it. The alternative — replacing the single pane — would move the
        // lineup out from under the press, which is the one thing this
        // interaction is arranged not to do.
        opponent || pick
          ? "grid-cols-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.78fr)]"
          : "grid-cols-1"
      }`}
    >
      {pick?.side === "theirs" && opponent ? (
        <OptionsPane
          side="theirs"
          seat={opponent.lineup[pick.index]}
          bench={opponent.bench}
          onBack={clear}
        />
      ) : (
        <LineupPane
          side="mine"
          pane={mine}
          opposite={opponent?.lineup}
          gaps
          onPress={pressable ? press : undefined}
          pick={pick}
        />
      )}

      {pick?.side === "mine" ? (
        <OptionsPane
          side="mine"
          seat={entry.lineup[pick.index]}
          bench={entry.bench}
          onBack={clear}
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
          />
        )
      )}
    </div>
  );
}

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
 * A roster's lineup, seat by seat.
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
 * 404px, its seat card spends 30 on the slot, 46 on the points, 90 on the
 * kickoff and 98 on a column drawing nothing, and the name — the row's whole
 * subject — is left **79px**, eight characters, on every opponent. That is the
 * failure this app has recorded at three other grains, and a numeric column's
 * alignment does not buy it. The two panes are different widths by design
 * anyway, so nothing on an absolute grid was ever lining up.
 */
function LineupPane({
  side,
  pane,
  opposite,
  gaps = false,
  vs = false,
  onPress,
  pick,
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
}) {
  // **The head names a column only where there is one.** A pane with no lineup
  // opposite it — a future week, an unpaired one — has nothing to compare, and
  // a `Gap` head over an empty column claims a measurement nobody made.
  const compares = opposite !== undefined;

  return (
    <div className="min-w-0">
      <PaneHead vs={vs} title={pane.title ?? pane.fallback}>
        <Total label="Set" value={pane.set} />
        {/* The error tone on `opt` is not an alert — it is the figure the set
            lineup is being measured against, drawn in the same ink the gap
            tile above the card draws its shortfall in, so the two read as one
            claim. A pane whose set total already equals it is simply level. */}
        <Total label="Opt" value={pane.optimal} tone="error" />
      </PaneHead>

      <ColumnHeads
        name={gaps ? "Lineup" : "Their lineup"}
        third={gaps && compares ? "Gap" : ""}
      />

      <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
        {pane.lineup.map((seat, i) => (
          <li key={`${seat.slot}-${i}`} className="flex">
            <SeatCard
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
          </li>
        ))}
      </ul>

      {pane.lineup.length === 0 && (
        <p className="m-0 py-2 font-mono text-[length:var(--fs-11)] uppercase tracking-[0.14em] text-readout-label">
          No lineup read for this week
        </p>
      )}

      {pane.bench.length > 0 && (
        <BenchDisclosure
          bench={pane.bench}
          promoted={pane.promoted}
          // A bench row has no gap of its own, but it still has to reserve the
          // same width the seats above it do — or the pane's columns step in
          // and out as the disclosure opens.
          gapMode={gaps ? "meters" : "mirror"}
        />
      )}
    </div>
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
 * nothing to total. The header carries the `Back` key in their place, which is
 * the row a reader's eye is already on.
 */
function OptionsPane({
  side,
  seat,
  bench,
  onBack,
}: {
  side: Side;
  /** Undefined only if a payload shortened under an open pick — treated as none. */
  seat: LineupCheckSeat | undefined;
  bench: readonly LineupCheckPlayer[];
  onBack: () => void;
}) {
  const options = seat ? seatOptions(seat, bench) : [];
  const locked = seat?.player?.locked === true;
  const held = seat?.player;

  return (
    <div className="min-w-0">
      <PaneHead
        // Whose options, said rather than left to position: the pane they land
        // in is the *opposite* one, so a reader with only the column to go on
        // would read them as the other side's.
        title={`${side === "mine" ? "Your" : "Their"} options · ${seat ? slotLabel(seat.slot) : "—"}`}
      >
        <button
          type="button"
          onClick={onBack}
          className="shrink-0 rounded-full border border-active/40 px-2.5 py-[3px] font-mono text-[length:var(--fs-9)] uppercase tracking-[0.14em] text-active transition-colors hover:border-active/70 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-active/60 lg:min-h-0 min-h-11"
        >
          Back
        </button>
      </PaneHead>

      <ColumnHeads
        name={
          locked
            ? `Locked — ${held?.name ?? held?.player_id} has kicked off`
            : "Could sit here"
        }
        third={locked ? "" : "Vs seat"}
      />

      <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
        {options.map((option) => (
          <li key={option.player.player_id} className="flex">
            <SeatCard
              slot={option.inSeat && seat ? seat.slot : (option.player.positions[0] ?? "—")}
              player={option.player}
              option={option}
              selected={option.inSeat}
            />
          </li>
        ))}
      </ul>

      {options.length === 0 && !locked && (
        <p className="m-0 py-2 font-mono text-[length:var(--fs-11)] uppercase tracking-[0.14em] text-readout-label">
          Nobody else can sit here
        </p>
      )}
    </div>
  );
}

/** A pane's own header row: whose lineup, and what it totals. */
function PaneHead({
  vs = false,
  title,
  children,
}: {
  vs?: boolean;
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex min-h-11 flex-wrap items-center gap-x-2 gap-y-1 px-1 pb-2 lg:min-h-0 lg:px-[11px]">
      {/* **The title takes a line of its own below `lg`, and `vs` comes with
          it.** Sharing one line with `Set` and `Opt` leaves the name 2px in a
          163px pane — every team read as a single character, which is the
          failure this app has recorded at three other grains. And `vs` left
          loose in the wrap takes a line of its *own*, which puts the two panes'
          heads at two heights and every row after them out of step: the whole
          point of the view is that the two lineups read across. So the two are
          one wrapping box below `lg` and `lg:contents` dissolves it above,
          where the head is one row. */}
      <span className="flex min-w-0 basis-full items-baseline gap-2 lg:contents">
        {vs && (
          <span className="shrink-0 font-mono text-[length:var(--fs-9)] uppercase tracking-[0.14em] text-readout-label">
            vs
          </span>
        )}
        <span className="min-w-0 flex-1 truncate font-mono text-[length:var(--fs-11)] uppercase tracking-[0.1em] text-readout lg:tracking-[0.14em]">
          {title}
        </span>
      </span>
      {children}
    </div>
  );
}

/**
 * One of a pane's two totals.
 *
 * Null draws an em dash rather than a zero, on the contract's own rule: the
 * opponent's pair is null for a future week, an unpaired week and an unstored
 * roster, and a `0.0` there is a roster projected to score nothing.
 */
function Total({
  label,
  value,
  tone,
}: {
  label: string;
  value: number | null;
  tone?: "error";
}) {
  return (
    <span className="inline-flex shrink-0 items-baseline gap-1 font-mono text-[length:var(--fs-9)] uppercase tracking-[0.14em] text-readout-label">
      {label}
      <span
        className={`text-[length:var(--fs-12)] tracking-normal tabular-nums lg:text-[length:var(--fs-13)] ${
          tone === "error"
            ? "text-error"
            : "text-readout [text-shadow:var(--readout-text-glow)]"
        }`}
      >
        {value === null ? "—" : value.toFixed(1)}
      </span>
    </span>
  );
}

/**
 * The pane's column heads.
 *
 * `aria-hidden` on everything but the name, and the name is the one that
 * carries a *sentence* in the options state (`Locked — … has kicked off`),
 * which is why it is the only one a reader hears: `Pts` and `Gap` restate what
 * each cell already says, where the locked note is the pane's whole answer.
 *
 * Hidden below `lg`, where the seat card is two lines and its cells sit under
 * the name rather than in columns — a head over a column that is not there
 * names nothing.
 */
function ColumnHeads({ name, third }: { name: string; third: string }) {
  return (
    <div className="flex items-baseline gap-2.5 px-1 pb-1.5 lg:px-[11px] lg:pb-[7px]">
      <span aria-hidden className="hidden w-[30px] shrink-0 lg:block" />
      <span className="min-w-0 flex-1 truncate font-mono text-[length:var(--fs-9)] uppercase tracking-[0.12em] text-readout-label lg:tracking-[0.14em]">
        {name}
      </span>
      <span
        aria-hidden
        className="hidden w-[46px] shrink-0 text-right font-mono text-[length:var(--fs-9)] uppercase tracking-[0.14em] text-readout-label lg:block"
      >
        Pts
      </span>
      {/* Only where there is a column under it — the right lineup pane draws
          nothing there and gives the width back to its names. */}
      {third && (
        <span
          aria-hidden
          className="hidden w-[98px] shrink-0 text-center font-mono text-[length:var(--fs-9)] uppercase tracking-[0.14em] text-readout-label lg:block"
        >
          {third}
        </span>
      )}
    </div>
  );
}

/** Sleeper's slot names, shortened to fit a 30px column. Unmapped render as-is. */
const SLOT_LABELS: Record<string, string> = {
  SUPER_FLEX: "SF",
  WRRB_FLEX: "W/R",
  REC_FLEX: "W/T",
  IDP_FLEX: "IDP",
  FLEX: "FLX",
};

export const slotLabel = (slot: string): string => SLOT_LABELS[slot] ?? slot;

/**
 * One seat, as a lit window a reader can press.
 *
 * **One node in two layouts**, turned at `lg` by `flex-wrap` and an `order` per
 * cell rather than by rendering the row twice and hiding one — which would put
 * every seat in the DOM twice and read each of them twice to anything
 * listening. Below `lg` the name takes a line of its own (`w-full`) and the
 * slot, the points and the gap wrap under it; above it they are one row of
 * columns.
 *
 * **Selection is a lit border and a halo, never a fill.** A filled card stops
 * reading as a window at all, which is the one thing every surface in the
 * expanded half is arranged to be.
 */
function SeatCard({
  slot,
  player,
  moveTo,
  gap,
  gapMode = "delta",
  demoted = false,
  promoted = false,
  option,
  selected = false,
  onPress,
}: {
  slot: string;
  player: LineupCheckPlayer | null;
  moveTo?: string | null;
  gap?: SeatGap | null;
  /** Which of {@link GapCell}'s three readings this row's third cell is. */
  gapMode?: GapMode;
  demoted?: boolean;
  promoted?: boolean;
  /** Set in the options pane: the row is a choice, and its delta is the third cell. */
  option?: SeatOption;
  selected?: boolean;
  onPress?: () => void;
}) {
  const kickoff = player ? kickoffTime(player.kickoff) : null;
  const delta = option ? option.delta : (gap?.delta ?? null);

  const body = (
    <>
      <span className="order-2 w-[30px] shrink-0 font-mono text-[length:var(--fs-9)] tracking-[0.1em] text-readout-label lg:order-1 lg:text-[length:var(--fs-11)] lg:tracking-[0.12em]">
        {slotLabel(slot)}
      </span>

      {/* **The name and its chips are one line below `lg`, and `lg:contents`
          is what makes that one node rather than two.** Left loose in the wrap
          they went to the *second* line, where a `sit` badge beside a slot, a
          figure and a gap overflows 143px and takes the row to three lines —
          and a three-line card in one pane against a two-line card in the
          other is two lineups that no longer read across, which is the whole
          purpose of the view. On the name's own line the chip has the width
          and the name truncates to make it, which is the right thing to lose.
          Above `lg` the wrapper's box stops existing and every child rejoins
          the row under its own `order`. */}
      <span className="order-1 flex w-full min-w-0 items-center gap-1.5 lg:contents">
        <span className="min-w-0 truncate font-mono text-[length:var(--fs-12)] text-readout-line lg:order-2 lg:flex-1 lg:text-[length:var(--fs-13)]">
          {player ? (player.name ?? player.player_id) : "Empty"}
        </span>

        {/* A played game is not a move anybody can make, so it is marked
            rather than left to look like an oversight. */}
        {player?.locked && (
          <span className="shrink-0 font-mono text-[length:var(--fs-9)] uppercase tracking-[0.1em] text-readout-muted lg:order-3 lg:text-[length:var(--fs-10)] lg:tracking-[0.12em]">
            <span className="sr-only">Locked — </span>
            <span aria-hidden>locked</span>
          </span>
        )}
        {option?.inSeat && <Chip order="lg:order-3">in seat</Chip>}
        {promoted && <Chip order="lg:order-3">start</Chip>}
        {demoted && (
          <Chip order="lg:order-3" tone="error">
            sit
          </Chip>
        )}
        {/* Read off `move_to`, which the server derived with the same
            `kickoffMoves` the tile's count came from — so the badge and the
            count cannot disagree. */}
        {moveTo && (
          <Chip order="lg:order-3">
            <span className="sr-only">Re-seat at </span>
            <span aria-hidden>{"→ "}</span>
            {slotLabel(moveTo)}
          </Chip>
        )}
      </span>

      {/* **A seat carries its kickoff and an option does not.** When a game
          starts is a fact about the lineup as it stands — it is what locks,
          and what the seat-order check is about. An options list is a
          comparison of projections, so the time is ~90px spent on a question
          nobody is asking there, and it is 90px off the one column that
          truncates. */}
      {kickoff && !option && (
        <span className="order-5 hidden shrink-0 font-mono text-[length:var(--fs-10)] uppercase tracking-[0.1em] text-readout-muted lg:inline">
          {kickoff}
        </span>
      )}

      <span className="order-3 shrink-0 font-mono text-[length:var(--fs-12)] tabular-nums text-readout lg:order-6 lg:w-[46px] lg:text-right lg:text-[length:var(--fs-13)]">
        {/* Null is "the feed has no row for him"; a real projected zero is
            `0.0`. The contract's own grammar, and the reason the gap beside it
            can be absent while the row still reads. */}
        {player?.points == null ? "—" : player.points.toFixed(1)}
      </span>

      <GapCell delta={delta} mode={gapMode} fill={gap} />
    </>
  );

  const shape =
    `${CONSOLE_WINDOW_KEY} min-h-[46px] flex-wrap items-center gap-x-2.5 gap-y-1 px-2.5 py-1.5 ` +
    "lg:flex-nowrap lg:gap-2.5 lg:py-0";
  const state = selected
    ? "border-active shadow-[var(--window-shadow),0_0_0_1px_var(--accent-glow),0_0_20px_-6px_var(--accent-glow)]"
    : "border-black/85 shadow-[var(--window-shadow)]";

  if (!onPress) return <span className={`${shape} ${state}`}>{body}</span>;

  return (
    <button
      type="button"
      onClick={onPress}
      aria-pressed={selected}
      className={`${shape} ${state} cursor-pointer hover:border-active/45`}
    >
      {body}
    </button>
  );
}

/**
 * Which of three readings a row's third cell is.
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
 * The third cell: the gap to the same seat opposite, or an option's delta.
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
    return (
      <span aria-hidden className={`order-4 shrink-0 lg:order-7 ${width}`} />
    );
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
      className={`order-4 flex shrink-0 items-center justify-center gap-2.5 lg:order-7 ${width}`}
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
function Chip({
  order,
  tone,
  children,
}: {
  order: string;
  tone?: "error";
  children: ReactNode;
}) {
  return (
    <span
      className={`${order} shrink-0 whitespace-nowrap rounded-full border px-1.5 py-0.5 font-mono text-[length:var(--fs-9)] uppercase tracking-[0.12em] ${
        tone === "error" ? "border-error/40 text-error" : "border-active/40 text-active"
      }`}
    >
      {children}
    </span>
  );
}

/**
 * The rest of the roster, behind a dashed outline.
 *
 * **A dashed card rather than another seat row**, which is the whole of what it
 * says: the seats above are windows that are *there*, and a dashed outline is
 * a place where more is, rather than a tenth seat in a nine-seat lineup.
 *
 * Its rows carry no gap: a bench player is not seated opposite anybody, so
 * there is nothing at the same index to compare him to.
 */
function BenchDisclosure({
  bench,
  promoted,
  gapMode,
}: {
  bench: readonly LineupCheckPlayer[];
  promoted: readonly string[];
  gapMode: GapMode;
}) {
  const starts = bench.filter((p) => promoted.includes(p.player_id)).length;

  return (
    <details className="group/bench relative mt-1.5">
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-[0.5625rem] border border-dashed border-active/40 px-2.5 font-mono text-[length:var(--fs-9)] uppercase tracking-[0.1em] text-readout-label transition-colors hover:text-readout lg:min-h-0 lg:h-[38px] lg:px-[11px] lg:text-[length:var(--fs-11)] lg:tracking-[0.14em]">
        <span className="min-w-0 flex-1 truncate">Bench {bench.length}</span>
        {starts > 0 && (
          <span className="shrink-0 rounded-full border border-active/40 px-1.5 py-0.5 font-mono text-[length:var(--fs-9)] tracking-[0.1em] text-active">
            {starts} start
          </span>
        )}
        <span aria-hidden className="shrink-0">
          <span className="group-open/bench:hidden">▸</span>
          <span className="hidden group-open/bench:inline">▾</span>
        </span>
      </summary>
      <ul className="m-0 mt-1.5 flex list-none flex-col gap-1.5 p-0">
        {bench.map((player) => (
          <li key={player.player_id} className="flex">
            <SeatCard
              slot={player.positions[0] ?? "—"}
              player={player}
              gapMode={gapMode}
              promoted={promoted.includes(player.player_id)}
            />
          </li>
        ))}
      </ul>
    </details>
  );
}
