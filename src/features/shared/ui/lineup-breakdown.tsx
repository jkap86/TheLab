"use client";

import { useEffect, useId, useRef, useState } from "react";

import type {
  LeagueLineup,
  LineupPlayer,
  MetricRank,
  RosterPick,
} from "@/shared/contract";

// Relative, not through the barrel: this folder's own modules are what a
// module in it reaches for — the rule the move here brought with it.
import { CONSOLE_FIGURE_WELL, CONSOLE_ROW_WELL } from "../console-chrome";
import { ordinal } from "../format";
import { rankColor, rankPercentile, slotPercentile } from "../rank-ramp";
import { type Lens, lensValue } from "../seat-compare";
import { PickRows, pickSpan } from "./draft-picks";
import {
  DrawerBar,
  DrawerRow,
  DRAWER_BAR,
  DRAWER_BAR_HEIGHT,
  DRAWER_BARS,
  PaneDrawer,
  PaneGlass,
  type DrawerTray,
} from "./pane";

/**
 * A league card's rest-of-season lineup: the optimal starters in slot order on
 * the pane's glass, with the bench and the roster's draft picks behind two bars
 * pinned to its floor.
 *
 * **The starters scroll and the two bars do not**, which is the whole shape of
 * it: the pane is a fixed-height column inside a panel capped to the viewport,
 * so what a reader can reach must not depend on how far they have scrolled. The
 * bench was a disclosure at the bottom of the list — reachable only by
 * scrolling past every starter — and the picks were a grid of season plates
 * *below both panes*, which the cap would have taken out of the panes' own
 * height on every card whether or not anybody opened them. Behind bars they
 * cost 88px and are one press away. See {@link DrawerBar}.
 *
 * **Each seat is a reading against the league, not against another roster.**
 * It used to be a comparison — the reader's own player as a ghost figure beside
 * every seat, with two bars drawn between the two — and that whole apparatus is
 * gone, along with the standings' `Gap` column it was the other half of. What
 * replaces it is a colour that says more with less room: a seat's figure is
 * drawn against **the league's median at that same slot**, so a green QB1 is
 * one that beats the twelve rosters' middle quarterback rather than one whose
 * number happens to be large. See `slotPercentile` and `slotMedians`.
 *
 * With the comparison gone the seat name collapses to **one ink**. The old
 * lit/dimmed ahead-behind rule is deliberately not kept: there is nothing left
 * on screen to decode it, and a name drawn two ways for reasons a reader cannot
 * see is worse than a name drawn one way.
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
 * **The lens is owned by `LeagueTeams`, not by this component**, and it sits on
 * this pane's own **ledge** rather than on a row above both panes — which is
 * the comprehension fix that pass is named for: a control over the seat figures
 * belongs to the pane holding them. It is still per-card and deliberately
 * unpersisted: a peek at the other valuation, not a page preference.
 *
 * **Every row is a channel cut into the glass, and every figure a smaller one
 * cut into that.** One pattern at two depths, which is the whole of the pane's
 * depth — no gradient, no border, and nothing to draw a rule with.
 *
 * **Below `lg` every row is two lines** — the face and the name on the first,
 * the slot and the figure under them. The panes sit side by side at every width
 * (see `LeagueTeams` for why they must, and for why the columns wait until
 * `lg`), which leaves this one ~165px at 390: three cells beside a name there
 * is a name of four characters. One row rather than two trees, through
 * `lg:contents` on the second line's wrapper, which is the trick the app rack's
 * brand row already turns — the alternative renders every seat twice and reads
 * each of them twice to anything listening.
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

/**
 * The starters' total under the current lens.
 *
 * **Nothing draws this today.** It fed the readout above the panes, which is
 * deleted: that figure is the same one the standings' Total column already
 * prints on the selected roster's own row, and the row it sat on was dissolved
 * when each control moved onto its own pane's ledge. It is kept rather than
 * removed on `peekActiveSeason`'s terms — it is the one place the rounding rule
 * for a lens total is written down (points take the server's own figure, which
 * carries it; both valuations sum client-side off the very fields the rows
 * show, so there is no second valuation to disagree with), and the null is what
 * keeps a `0.0 pts` off a card whose projections never landed.
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

/**
 * What each lens is called, and the unit its total is labelled with.
 *
 * Exported because the roster pane draws these keys twice — as three keys on
 * its ledge above `lg` and as one `<select>` below it, where three do not fit a
 * ~165px pane — and a second spelling of the words is two vocabularies for one
 * control.
 */
export const LINEUP_LENS_LABELS: Record<Lens, { key: string; unit: string }> = {
  points: { key: "Points", unit: "pts" },
  capital: { key: "Capital", unit: "cap" },
  ktc: { key: "KTC", unit: "ktc" },
};

/** In control order — the two derived from this page's own data, then the market. */
export const LENSES: readonly Lens[] = ["points", "capital", "ktc"];

/**
 * A lens's total unit.
 *
 * Unread since the total readout went, and kept with {@link lineupTotal} for
 * its reason: the two are one reading and would come back together.
 */
export function lensUnit(lens: Lens): string {
  return LINEUP_LENS_LABELS[lens].unit;
}

/**
 * The lens keys, as tactile keys in one housing: the resting shadow carries a
 * 3px riser and the pressed one drops to 1px, so the key travels.
 *
 * The housing takes its width from the caller, because the recess it sits in is
 * the caller's — on the roster pane's ledge it shares a track with the `Value
 * in` caption, which is what says the control belongs to that pane.
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
      // No track of its own: it sits *inside* the ledge's own recess beside the
      // `Value in` caption, and a channel drawn inside a channel is two cuts
      // where the design has one.
      className={`inline-flex gap-[5px] ${className}`}
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
          className={`min-w-0 flex-1 rounded-full border px-3 py-[7px] text-center font-mono text-[length:var(--fs-11)] uppercase tracking-[0.16em] transition-[color,box-shadow] duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-active/60 ${
            lens === option
              ? "border-active/45 bg-[image:var(--key-bg)] text-readout shadow-[var(--key-shadow)] [text-shadow:var(--readout-text-glow)]"
              : "border-transparent text-foreground/62 hover:text-readout"
          }`}
        >
          {LINEUP_LENS_LABELS[option].key}
        </button>
      ))}
    </div>
  );
}

/**
 * A player's face, in a mount the size of the row's own line.
 *
 * Sleeper publishes a thumbnail per player id and nothing else is needed to
 * reach it, so the face costs no fetch of ours: the mount behind it is what a
 * reader sees while it loads, when there is no such thumbnail, and for an
 * **empty seat**, which has no player at all.
 *
 * **It is a background layer rather than an `<img>`, and a render is what
 * settled that.** The handoff calls for an ordinary `<img>` on the grounds that
 * the prototype's own reason for a background does not apply here — which is
 * true, and there is a second reason that does. A great many of these ids have
 * no thumbnail: a team defence's id is a team code, and Sleeper's board turns
 * over faster than its art does. A **broken `<img>` paints a glyph**, over the
 * letter, even at `alt=""` — measured, on a seat whose thumbnail 404s — where a
 * background that fails paints nothing at all and the mount underneath is
 * exactly the fallback it was put there to be. The element is `aria-hidden`
 * decoration either way, so there is no semantics to lose by it.
 *
 * The mount is `Avatar`'s letter disc spelled here rather than that component
 * reused, and for the same reason: `Avatar` draws *either* a face *or* a
 * letter, where a headshot wants the letter **behind** it.
 *
 * `background-position: center top` because a headshot is framed head and
 * shoulders, and a centred crop of one in a 22px disc is a chin.
 *
 * `lg:order-2` is the seat row's own cell order — slot, face, name, team,
 * figure — spelled on every cell rather than left to DOM order for the reason
 * `StandingRow` gives about its mark.
 */
function PlayerFace({ player }: { player: LineupPlayer | null }) {
  return (
    <span
      aria-hidden
      className="relative flex size-[18px] shrink-0 items-center justify-center overflow-hidden rounded-full border border-foreground/10 bg-foreground/5 font-display text-[length:var(--fs-9)] font-semibold text-foreground/40 lg:order-2 lg:size-[22px] lg:text-[length:var(--fs-9-6)]"
    >
      {player?.name?.charAt(0).toUpperCase() ?? null}
      {player && (
        <span
          className="absolute inset-0 bg-cover bg-top"
          style={{
            backgroundImage: `url(https://sleepercdn.com/content/nfl/players/thumb/${player.player_id}.jpg)`,
          }}
        />
      )}
    </span>
  );
}

/**
 * **An initial and a surname below `lg`.** A ~136px name column at this type
 * size does not hold "Amon-Ra St. Brown", and an ellipsis eats the surname —
 * which is the half of a player's name a reader identifies him by. Above `lg`
 * the full name has the room and keeps it.
 *
 * A one-word name (a team defence, an id with no name on the feed) is returned
 * whole: there is no first initial to take.
 */
function shortName(name: string): string {
  const space = name.indexOf(" ");
  return space > 0 ? `${name.charAt(0)}. ${name.slice(space + 1)}` : name;
}

/** One seat's name, at both widths, from one node. */
function SeatName({
  player,
  className = "",
}: {
  player: LineupPlayer | null;
  className?: string;
}) {
  const name = player ? (player.name ?? player.player_id) : "Empty";
  const short = player?.name ? shortName(player.name) : name;

  return (
    <span
      className={`relative min-w-0 flex-1 truncate text-[length:var(--fs-13)] text-foreground/85 ${className}`}
    >
      <span className="lg:hidden">{short}</span>
      <span className="hidden lg:inline">{name}</span>
    </span>
  );
}

/**
 * One seat, as a channel cut into the pane's glass.
 *
 * **The figure's colour is the league's median at this slot**, not its own
 * magnitude and not a rank — see `slotPercentile`. A seat the lens says nothing
 * about draws an em dash and no colour at all: an absent figure has no standing
 * against a median, and painting it red would claim the worst answer in the
 * league for a player nobody has an answer about.
 *
 * **The NFL team sits between the name and the figure**, in a 32px right-aligned
 * column at `lg` so the codes form a column against ragged names, and on the
 * row's second line after the slot below it. Mono, dimmed mint — a fact about
 * the player one level below his name and well below the figure. **An absent
 * team renders nothing at all** rather than an em dash: it sits between a name
 * and a figure, and a dash there reads as a missing *number*. That is the one
 * place this row parts company with the app's three-way grammar, and it is
 * the grammar's own reason — the dash exists to keep an absence from reading
 * as a zero, and there is no zero for a team to be mistaken for.
 *
 * 38px at `lg` and 52 below it, since the expanded-card pass; the standings
 * row opposite takes the same two heights because the lists are read across.
 */
function SeatRow({
  player,
  slot,
  lens,
  median,
}: {
  player: LineupPlayer | null;
  slot: string;
  lens: Lens;
  /** The league's middle figure at this seat, or 0 where there is none. */
  median: number;
}) {
  const value = lensValue(player, lens);
  const tone = value === null ? undefined : rankColor(slotPercentile(value, median));

  return (
    <li
      className={`${CONSOLE_ROW_WELL} relative mb-[3px] flex h-[52px] flex-col justify-center gap-[5px] rounded-[7px] px-1.5 lg:h-[38px] lg:flex-row lg:items-center lg:gap-[9px] lg:px-2.5`}
    >
      {/* One node, two layouts: the face and the name share the first line
          below `lg` and take the row's second and third cells above it. */}
      <span className="relative flex w-full min-w-0 items-center gap-1.5 lg:contents">
        <PlayerFace player={player} />
        <SeatName player={player} className="lg:order-3" />
      </span>

      <span className="relative flex w-full items-center gap-1.5 lg:contents">
        <span className="shrink-0 font-mono text-[length:var(--fs-11)] tracking-[0.1em] text-readout/62 lg:order-1 lg:w-[38px] lg:overflow-hidden lg:rounded-[5px] lg:bg-[color:var(--figure-well-bg)] lg:px-1 lg:py-0.5 lg:text-center lg:tracking-[0.12em] lg:shadow-[var(--figure-well-shadow)]">
          {SLOT_LABELS[slot] ?? slot}
        </span>
        {player?.team && (
          <span className="shrink-0 font-mono text-[length:var(--fs-10)] tracking-[0.1em] text-readout/45 lg:order-4 lg:w-8 lg:text-right lg:text-[length:var(--fs-11)] lg:text-readout/50">
            {player.team}
          </span>
        )}
        <span
          className={`${CONSOLE_FIGURE_WELL} min-w-0 flex-1 px-[5px] py-0.5 text-right font-mono text-[length:var(--fs-12-5)] tabular-nums lg:order-5 lg:w-[70px] lg:flex-none`}
        >
          <span style={tone ? { color: tone } : undefined}>
            {figure(value, lens)}
          </span>
        </span>
      </span>
    </li>
  );
}

/**
 * A bench player: a face, a name, his position, his NFL team and what the lens
 * says he is worth. The team takes the seat row's treatment through the drawer
 * row's `note` slot — it is the same reading about the same kind of object —
 * in the billet's label ink rather than the mint, since a drawer row is a part
 * rather than glass.
 */
function BenchRow({ player, lens }: { player: LineupPlayer; lens: Lens }) {
  return (
    <DrawerRow
      lead={player.positions[0] ?? "—"}
      leadWidth="lg:w-[38px]"
      figure={figure(lensValue(player, lens), lens)}
      note={player.team}
    >
      <PlayerFace player={player} />
      <span className="relative min-w-0 flex-1 truncate text-[length:var(--fs-13)] text-[color:var(--billet-name)] lg:order-3">
        <span className="lg:hidden">
          {player.name ? shortName(player.name) : player.player_id}
        </span>
        <span className="hidden lg:inline">{player.name ?? player.player_id}</span>
      </span>
    </DrawerRow>
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

/**
 * Which reading the drawer is showing.
 *
 * The type, the two bars' heights and the `--bars` sums they add up to all
 * live in `pane.tsx` since the lineup checker's lineup pane took the same
 * drawer for its bench — see {@link DRAWER_BAR_HEIGHT}, which carries the
 * arithmetic and the reason both records are spelled literally.
 */
type Tray = DrawerTray;

/**
 * How long the contents are faded out for while one drawer becomes the other.
 * Half of the 340ms the drawer itself would spend collapsing and reopening,
 * which is the point of not collapsing it.
 */
const SWAP_MS = 170;

export function LineupBreakdown({
  lineup,
  lens,
  medians,
  bench,
  picks,
}: {
  lineup: LeagueLineup;
  lens: Lens;
  /** The league's median at each seat, index-aligned — see `slotMedians`. */
  medians: readonly number[];
  /** The bench's total and place, or null where it has nothing to say. */
  bench: BenchReading | null;
  /** This roster's future picks — the second drawer's rows. */
  picks: readonly RosterPick[];
}) {
  const drawerId = useId();
  const [tray, setTray] = useState<Tray | null>(null);
  const [swapping, setSwapping] = useState(false);
  const swapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (swapTimer.current) clearTimeout(swapTimer.current);
    },
    [],
  );

  const bars: Tray[] = [];
  if (lineup.bench.length > 0) bars.push("bench");
  if (picks.length > 0) bars.push("picks");

  // **Resolved, not synced**, which is `LeagueTeams`' rule about its own
  // selection one level up: picking a team whose bench is empty, or whose
  // league has no pick market, takes that bar off the pane — and a drawer left
  // open onto a reading nothing can produce is an empty part standing over the
  // starters with no bar under it saying what it is. Derived, it closes itself;
  // an effect would paint one frame of it first.
  const open = tray && bars.includes(tray) ? tray : null;

  /**
   * **Switching drawers does not collapse the one that is up.** Two drawers
   * over one list would cover it twice, so there is one — and a reader
   * comparing their bench against their picks would otherwise watch it fold
   * shut and reopen at the same height. The contents fade out, swap at the
   * midpoint and fade back.
   */
  const toggle = (kind: Tray) => {
    if (swapTimer.current) clearTimeout(swapTimer.current);
    if (open === kind) {
      setTray(null);
      setSwapping(false);
      return;
    }
    if (open !== null) {
      setSwapping(true);
      swapTimer.current = setTimeout(() => {
        setTray(kind);
        setSwapping(false);
      }, SWAP_MS);
      return;
    }
    setTray(kind);
    setSwapping(false);
  };

  const benchTone = rankColor(rankPercentile(bench?.place ?? null));
  const barsVar = DRAWER_BARS[bars.join(",")] ?? "";
  const span = pickSpan(picks);

  return (
    // A frame rather than a scroller: the starters scroll inside it, the drawer
    // rises inside it, and the bars are pinned to its floor. `overflow-hidden`
    // is what keeps the drawer's own corners inside the glass's radius and what
    // stops a mid-animation drawer painting over the pane's edge.
    <PaneGlass className="flex flex-col overflow-hidden p-[3px]">
      {/* `pr-[9px]`: the scrollbar's gutter, so a figure's last digit clears
          the thumb — the standings glass makes the same measurement at its
          own 11px, and the difference is that this scroller sits 3px inside
          a frame that already spends some of it. */}
      <div className="lab-scroll-glass relative min-h-0 flex-1 overflow-y-auto overflow-x-hidden pr-[9px]">
        <ul className="m-0 list-none p-0">
          {lineup.starters.map((seat, i) => (
            <SeatRow
              key={`${seat.slot}-${i}`}
              slot={seat.slot}
              player={seat.player}
              lens={lens}
              median={medians[i] ?? 0}
            />
          ))}
        </ul>

        {lineup.unknown_slots.length > 0 && (
          // A partial lineup must say so — see `unknown_slots` on the contract.
          // Inside the scroller with the seats it qualifies, rather than pinned
          // under them: it is part of the lineup's reading, and the two bars
          // below are the only things on this glass that hold their place.
          <p className="m-0 px-2 py-2 font-mono text-[length:var(--fs-11)] uppercase tracking-[0.14em] text-foreground/60">
            Not shown: {lineup.unknown_slots.join(", ")}
          </p>
        )}
      </div>

      {bars.length > 0 && (
        <>
          {/*
            **One drawer for both readings**, where two over one list would
            cover it twice — see {@link PaneDrawer} for the box, and `toggle`
            for why switching does not collapse the one that is up.
          */}
          <PaneDrawer id={drawerId} open={open !== null} bars={barsVar}>
            <div
              className={`lab-anim lab-scroll-glass min-h-0 flex-1 overflow-y-auto overflow-x-hidden [transition:opacity_160ms_ease,transform_220ms_cubic-bezier(0.2,0.8,0.2,1)] ${
                swapping ? "translate-y-2 opacity-0" : "translate-y-0 opacity-100"
              }`}
            >
              {open === "picks" ? (
                <PickRows picks={picks} />
              ) : (
                <ul className="m-0 list-none p-0">
                  {lineup.bench.map((player) => (
                    <BenchRow key={player.player_id} player={player} lens={lens} />
                  ))}
                </ul>
              )}
            </div>
          </PaneDrawer>

          {/* Above the drawer, so a drawer at full height stops at the bars
              rather than under them. */}
          <div className="relative z-[3] shrink-0">
            {bars.includes("bench") && (
              <button
                type="button"
                onClick={() => toggle("bench")}
                aria-expanded={open === "bench"}
                aria-controls={drawerId}
                className={`${DRAWER_BAR} ${DRAWER_BAR_HEIGHT.bench} ${
                  open === "bench"
                    ? "text-[color:var(--billet-accent)]"
                    : "text-[color:var(--billet-name)]"
                }`}
              >
                <DrawerBar open={open === "bench"} label={`Bench · ${lineup.bench.length}`}>
                  {bench && (
                    <>
                      {/* **The total drops below `lg`**, where the place and
                          the caret are what the bar is for: at ~165px three
                          figures and a word leave the word nothing. It is on
                          the standings row opposite at every width, which is
                          where a reader compares benches anyway. */}
                      <span className="hidden shrink-0 tabular-nums text-[color:var(--billet-label)] lg:inline">
                        {bench.total}
                      </span>
                      {/* The place among the league's benches, on the same ramp
                          the card's rank windows run — and neutral rather than
                          red where there is no place to report. */}
                      <span
                        className="w-7 shrink-0 text-right tabular-nums lg:w-9"
                        style={{ color: benchTone }}
                      >
                        {bench.place ? ordinal(bench.place.rank) : "—"}
                      </span>
                    </>
                  )}
                </DrawerBar>
              </button>
            )}

            {bars.includes("picks") && (
              <button
                type="button"
                onClick={() => toggle("picks")}
                aria-expanded={open === "picks"}
                aria-controls={drawerId}
                className={`${DRAWER_BAR} ${DRAWER_BAR_HEIGHT.picks} ${
                  open === "picks"
                    ? "text-[color:var(--billet-accent)]"
                    : "text-[color:var(--billet-name)]"
                }`}
              >
                <DrawerBar open={open === "picks"} label={`Picks · ${picks.length}`}>
                  {/* The span is what the bar can say that the count cannot —
                      how far out the portfolio runs. Dropped below `lg` on the
                      bench bar's own argument. */}
                  {span && (
                    <span className="hidden shrink-0 font-mono text-[length:var(--fs-12)] tracking-[0.08em] tabular-nums text-[color:var(--billet-label)] lg:inline">
                      {span}
                    </span>
                  )}
                </DrawerBar>
              </button>
            )}
          </div>
        </>
      )}
    </PaneGlass>
  );
}
