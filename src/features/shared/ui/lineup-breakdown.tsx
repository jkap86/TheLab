"use client";

import type { LeagueLineup, LineupPlayer, MetricRank } from "@/shared/contract";

// Relative, not through the barrel: this folder's own modules are what a
// module in it reaches for — the rule the move here brought with it.
import { CONSOLE_TRACK } from "../console-chrome";
import { ordinal } from "../format";
import { rankColor, rankPercentile } from "../rank-ramp";
import { type Lens, lensValue, type SeatCompare } from "../seat-compare";

/**
 * A league card's rest-of-season lineup, read against another one: the optimal
 * starters in slot order with the reader's own figure beside each seat, the
 * bench behind a disclosure, and a total for the seated starters.
 *
 * **Each seat is a comparison, not a reading.** The team on screen is whichever
 * one the standings pane has selected, and the ghost column is the reader's own
 * player at the same seat — so picking a team on the left reads as "which seats
 * do I win" rather than as "here is a different roster". Where the reader's own
 * team is the one on screen there is nothing to compare it to, so the ghost
 * becomes the league's best at that seat and the pane's header says so. The
 * arithmetic is `seatComparisons`, computed by `LeagueTeams` because it is the
 * component that can see every team.
 *
 * The number column is one lens at a time — rest-of-season points, the
 * draft-capital value, or KeepTradeCut's price. Flipping the *whole* column is
 * the point: three figures on three different scales side by side would read as
 * the same unit, so they never share a column, and a player the current lens
 * has nothing to say about shows an em dash rather than a borrowed number.
 *
 * The three are genuinely three questions, which is why none of them can stand
 * in for another: what a player will *do* from here, what a draft room thought
 * of him, and what he is worth to acquire.
 *
 * **The lens is owned by `LeagueTeams`, not by this component.** Its keys and
 * its total sit on the panes' shared control row, above both panes, because
 * neither pane is wide enough to carry a header of its own — so the state has
 * to live where both the keys and this list can see it. It is still per-card
 * and deliberately unpersisted: a peek at the other valuation, not a page
 * preference.
 *
 * The rows are a lit readout rather than plain text. It is the same surface as
 * the card's metric tiles and the account readout, and it is what keeps ten
 * rows of numbers from reading as a paragraph.
 *
 * **Below `lg` every row is two lines** — the name on its own, its figures
 * under it — and the ghost figure and both bars give way to the signed gap
 * alone. The panes sit side by side at every width (see `LeagueTeams` for why
 * they must, and for why the columns wait until `lg`), which leaves this one
 * 188px at 390: three numeric columns beside a name there is a name of four
 * characters. One row rather than two trees, through `lg:contents` on the
 * second line's wrapper, which is the trick the app rack's brand row already
 * turns — the alternative renders every seat twice and reads each of them
 * twice to anything listening.
 */

/** Sleeper's slot names, shortened to fit a chip. Unmapped ones render as-is. */
const SLOT_LABELS: Record<string, string> = {
  SUPER_FLEX: "SF",
  WRRB_FLEX: "W/R",
  REC_FLEX: "W/T",
  IDP_FLEX: "IDP",
  FLEX: "FLX",
};

/**
 * The lens vocabulary lives with the comparison arithmetic, which is pure and
 * testable; re-exported here because this is where its keys are drawn and where
 * every caller has always imported it from.
 */
export type { Lens };

/**
 * One figure, spelled the way its lens is read: points to a decimal, both
 * valuations on whole-number scales. Null is the em dash — the absence the
 * three fields all document, and never a zero.
 */
function figure(value: number | null, lens: Lens): string {
  if (value == null) return "—";
  return lens === "points" ? value.toFixed(1) : value.toLocaleString("en-US");
}

function cell(player: LineupPlayer | null, lens: Lens): string {
  return figure(lensValue(player, lens), lens);
}

/**
 * The starters' total under the current lens, so the headline number always
 * agrees with the column beneath it. Both valuations sum client-side off the
 * very fields the rows show — no second valuation to disagree with — and the
 * points total is the server's own, which is the one that carries a rounding
 * rule. Null where the lens has nothing to total, which is what keeps a
 * `0.0 pts` off a card whose projections never landed and a `0 ktc` off one
 * whose board could not be read.
 */
export function lineupTotal(lineup: LeagueLineup, lens: Lens): string | null {
  if (lens === "points") {
    return lineup.projected_points > 0
      ? lineup.projected_points.toFixed(1)
      : null;
  }
  const total = lineup.starters.reduce(
    (sum, seat) =>
      sum +
      ((lens === "capital" ? seat.player?.adp_value : seat.player?.ktc_value) ??
        0),
    0,
  );
  return total > 0 ? total.toLocaleString("en-US") : null;
}

/** What each lens is called, and the unit its total is labelled with. */
const LENS_LABELS: Record<Lens, { key: string; unit: string }> = {
  points: { key: "Points", unit: "pts" },
  capital: { key: "Capital", unit: "cap" },
  ktc: { key: "KTC", unit: "ktc" },
};

/** In control order — the two derived from this page's own data, then the market. */
export const LENSES: readonly Lens[] = ["points", "capital", "ktc"];

/** A lens's total unit, for the readout beside the keys. */
export function lensUnit(lens: Lens): string {
  return LENS_LABELS[lens].unit;
}

/**
 * The lens keys, as tactile keys in one housing: the resting shadow carries a
 * 3px riser and the pressed one drops to 1px, so the key travels.
 *
 * The housing takes its width from the caller, because the row it sits in is
 * the caller's: below `sm` the keys have a line of their own and share it three
 * ways, where above it they stand beside the total readout at their own size.
 */
export function LineupLensKeys({
  lens,
  onChange,
  className = "",
}: {
  lens: Lens;
  onChange: (lens: Lens) => void;
  className?: string;
}) {
  return (
    <div
      role="group"
      aria-label="Value lens"
      className={`${CONSOLE_TRACK} inline-flex gap-1 p-1 ${className}`}
    >
      {LENSES.map((option) => (
        <button
          key={option}
          type="button"
          onClick={() => onChange(option)}
          aria-pressed={lens === option}
          // An unselected option is bare text *on the track*, not a second
          // key: three raised faces in one channel is a row of buttons, where
          // one raised and the rest flush is a switch showing its position.
          className={`flex-1 rounded-full border px-3 py-1.5 font-mono text-[length:var(--fs-10)] uppercase tracking-[0.16em] transition-[color,box-shadow] duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-active/60 sm:flex-none ${
            lens === option
              ? "border-active/45 bg-[image:var(--key-bg)] text-readout shadow-[var(--key-shadow)] [text-shadow:var(--readout-text-glow)]"
              : "border-transparent text-foreground/58 hover:text-readout"
          }`}
        >
          {LENS_LABELS[option].key}
        </button>
      ))}
    </div>
  );
}

/**
 * One seat, and how the reader stands at it.
 *
 * **Only one of the two tracks is ever filled**, and it is the one on the
 * leader's side: the left track sits under the figure on screen and the right
 * under the ghost, so the gap is drawn pointing at whoever has the better
 * player there. Its *colour* is the reader's, not the leader's — green where
 * they win the seat and red where they lose it — which is the same grammar the
 * standings' Gap column reads by, where the number describes the row and the
 * colour describes you.
 *
 * A seat with nothing to compare draws neither track and dims neither name.
 * That covers a seat the current lens is silent on — an unprojected stash, a
 * player off KeepTradeCut's board — and a seat where the two sides are level,
 * which on the reader's own team means they hold the league's best there.
 */
function SeatRow({
  player,
  slot,
  lens,
  compare,
}: {
  player: LineupPlayer | null;
  slot: string;
  lens: Lens;
  compare: SeatCompare;
}) {
  // The ramp's own two ends rather than a literal green and red: it reads them
  // from `--rank-l` and `--rank-c`, which is what inverts them for light mode.
  const stop =
    compare.standing === null ? null : compare.standing === "ahead" ? 100 : 0;
  const tone = stop === null ? null : rankColor(stop);
  const glow = stop === null ? null : rankColor(stop, 0.4);
  const bar = (side: "shown" | "ghost") => {
    const led =
      compare.delta !== null &&
      (side === "shown" ? compare.delta > 0 : compare.delta < 0);
    return {
      width: led ? `${compare.fill}%` : "0%",
      background: led && tone ? tone : "transparent",
      boxShadow: led && glow ? `0 0 8px ${glow}` : undefined,
    };
  };

  return (
    <li className="relative flex h-12 flex-col justify-center gap-[3px] border-b border-active/8 last:border-b-0 lg:h-[34px] lg:flex-row lg:items-center lg:gap-[9px]">
      {/* Lit where the reader wins the seat, dimmed where they lose it, and
          left at the reading colour where there is nothing to compare — a dash
          is not a defeat. */}
      <span
        className={`block w-full truncate text-[length:var(--fs-13)] lg:order-2 lg:min-w-0 lg:flex-1 ${
          compare.standing === "ahead"
            ? "text-readout"
            : compare.standing === "behind"
              ? "text-foreground/72"
              : "text-foreground/85"
        }`}
      >
        {player ? (player.name ?? player.player_id) : "Empty"}
      </span>

      {/* The seat's figures. One node, two layouts: a line of its own below
          `lg`, and five cells of the row above it. */}
      <span className="flex w-full items-baseline gap-2 lg:contents">
        <span className="shrink-0 font-mono text-[length:var(--fs-10)] tracking-[0.1em] text-readout/60 lg:order-1 lg:w-[30px] lg:text-[length:var(--fs-11)] lg:tracking-[0.12em]">
          {SLOT_LABELS[slot] ?? slot}
        </span>
        <span className="flex-1 text-right font-mono text-[length:var(--fs-12)] tabular-nums text-readout lg:order-3 lg:w-[54px] lg:flex-none lg:text-[length:var(--fs-11)]">
          {cell(player, lens)}
        </span>
        <span
          aria-hidden
          className="hidden h-1 w-[52px] shrink-0 justify-end rounded-l-full bg-[var(--meter-track)] shadow-[inset_0_1px_3px_rgba(0,0,0,0.95)] lg:order-4 lg:flex"
        >
          <span className="block h-1 rounded-l-full" style={bar("shown")} />
        </span>
        <span
          aria-hidden
          className="hidden h-1 w-[52px] shrink-0 rounded-r-full bg-[var(--meter-track)] shadow-[inset_0_1px_3px_rgba(0,0,0,0.95)] lg:order-5 lg:block"
        >
          <span className="block h-1 rounded-r-full" style={bar("ghost")} />
        </span>
        <span className="hidden w-[52px] shrink-0 text-right font-mono text-[length:var(--fs-11)] tabular-nums text-readout-muted lg:order-6 lg:block">
          {figure(compare.ghost, lens)}
        </span>
        {/* Below `lg` the ghost and its two tracks are one signed number: three
            numeric affordances is a desktop luxury. */}
        <span
          className="shrink-0 font-mono text-[length:var(--fs-11)] tabular-nums text-readout-muted lg:hidden"
          style={tone ? { color: tone } : undefined}
        >
          {compare.delta === null
            ? ""
            : `${compare.delta > 0 ? "+" : compare.delta < 0 ? "−" : ""}${figure(Math.abs(compare.delta), lens)}`}
        </span>
      </span>
    </li>
  );
}

/**
 * A bench player: the same two layouts as a seat, with no comparison to make.
 *
 * The 174px on the end is what lines the bench figures up under the seat
 * figures above them — the two tracks and the ghost column, plus the gaps
 * between them — so the column reads as one column rather than two that nearly
 * agree.
 */
function BenchRow({ player, lens }: { player: LineupPlayer; lens: Lens }) {
  return (
    <li className="relative flex h-11 flex-col justify-center gap-[3px] border-b border-active/8 last:border-b-0 lg:h-8 lg:flex-row lg:items-center lg:gap-[9px]">
      <span className="block w-full truncate text-[length:var(--fs-13)] text-foreground/85 lg:order-2 lg:min-w-0 lg:flex-1">
        {player.name ?? player.player_id}
      </span>
      <span className="flex w-full items-baseline gap-2 lg:contents">
        <span className="shrink-0 font-mono text-[length:var(--fs-10)] tracking-[0.1em] text-readout-label lg:order-1 lg:w-[30px] lg:tracking-[0.12em]">
          {player.positions[0] ?? "—"}
        </span>
        <span className="flex-1 text-right font-mono text-[length:var(--fs-12)] tabular-nums text-readout lg:order-3 lg:w-[54px] lg:flex-none lg:text-[length:var(--fs-11)]">
          {cell(player, lens)}
        </span>
        <span aria-hidden className="hidden lg:order-4 lg:block lg:w-[174px]" />
      </span>
    </li>
  );
}

/**
 * The bench's own reading under the current lens: its total and where that
 * total places in the league.
 *
 * Both are read off `LeagueTeam.totals` rather than re-summed here, per the
 * contract's own note — the sums carry edge rules, and a second spelling of
 * them is how the summary would drift from the column it closes.
 */
export type BenchReading = { total: string; place: MetricRank | null };

export function LineupBreakdown({
  lineup,
  lens,
  compare,
  bench,
}: {
  lineup: LeagueLineup;
  lens: Lens;
  /** One comparison per starter, index-aligned — see `seatComparisons`. */
  compare: readonly SeatCompare[];
  /** The bench's total and place, or null where it has nothing to say. */
  bench: BenchReading | null;
}) {
  const benchTone = rankColor(rankPercentile(bench?.place ?? null));

  return (
    <div className="relative overflow-hidden rounded-xl border border-black/85 bg-[image:var(--readout-bg)] px-2.5 py-0.5 shadow-[var(--readout-shadow)] lg:px-3.5 lg:py-1">
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[image:var(--readout-scanlines)]"
      />

      <ul className="relative m-0 list-none p-0">
        {lineup.starters.map((seat, i) => (
          <SeatRow
            key={`${seat.slot}-${i}`}
            slot={seat.slot}
            player={seat.player}
            lens={lens}
            compare={
              compare[i] ?? { ghost: null, delta: null, fill: 0, standing: null }
            }
          />
        ))}
      </ul>

      {lineup.unknown_slots.length > 0 && (
        // A partial lineup must say so — see `unknown_slots` on the contract.
        <p className="relative m-0 py-2 font-mono text-[length:var(--fs-11)] uppercase tracking-[0.14em] text-foreground/60">
          Not shown: {lineup.unknown_slots.join(", ")}
        </p>
      )}

      {lineup.bench.length > 0 && (
        <details className="group/bench relative">
          <summary className="flex h-11 cursor-pointer list-none items-center gap-1.5 font-mono text-[length:var(--fs-10)] uppercase tracking-[0.12em] text-foreground/60 transition-colors hover:text-readout lg:h-[38px] lg:gap-2.5 lg:text-[length:var(--fs-11)] lg:tracking-[0.14em]">
            <span className="flex-1">Bench {lineup.bench.length}</span>
            {bench && (
              <>
                <span className="tabular-nums text-readout/60">
                  {bench.total}
                </span>
                {/* The place among the league's benches, on the same ramp the
                    card's rank tiles run — and neutral rather than red where
                    there is no place to report. */}
                <span
                  className="w-7 text-right tabular-nums lg:w-[34px]"
                  style={{ color: benchTone }}
                >
                  {bench.place ? ordinal(bench.place.rank) : "—"}
                </span>
              </>
            )}
            {/* Held to the ghost column's width above it, so the caret closes
                the row rather than floating in the middle of it. */}
            <span
              aria-hidden
              className="w-6 text-right text-readout-label lg:w-[52px]"
            >
              <span className="group-open/bench:hidden">▸</span>
              <span className="hidden group-open/bench:inline">▾</span>
            </span>
          </summary>
          <ul className="m-0 list-none border-t border-active/8 p-0">
            {lineup.bench.map((player) => (
              <BenchRow key={player.player_id} player={player} lens={lens} />
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
