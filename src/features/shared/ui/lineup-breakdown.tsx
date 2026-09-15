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
import { CONSOLE_PANE_TRACK } from "../console-chrome";
import { ordinal, shortName, slotLabel } from "../format";
import { rankColor, rankPercentile, slotPercentile } from "../rank-ramp";
import { type Lens, lensValue } from "../seat-compare";
import { PickRows, pickSpan } from "./draft-picks";
import {
  DrawerBar,
  drawerBarClass,
  PaneDrawer,
  PaneFoot,
  PaneGlass,
  PaneWeekRow,
  type DrawerTray,
} from "./pane";

/**
 * A league card's rest-of-season lineup: the optimal starters in slot order on
 * the pane's glass, with the bench and the roster's draft picks behind two keys
 * on the pane's foot below it.
 *
 * **The starters scroll and the two keys do not**, which is the whole shape of
 * it: the pane is a fixed-height column inside a panel capped to the viewport,
 * so what a reader can reach must not depend on how far they have scrolled. The
 * bench was a disclosure at the bottom of the list — reachable only by
 * scrolling past every starter — and the picks were a grid of season plates
 * *below both panes*, which the cap would have taken out of the panes' own
 * height on every card whether or not anybody opened them. Behind two keys they
 * cost the foot's height and are one press away. See {@link DrawerBar}.
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
 * **Every row is a part standing on the glass, and the figure is struck into
 * its face.** The rows were channels cut into the glass and the drawer's rows
 * were already parts, so the same player was two objects one press apart; both
 * are one {@link PaneRow} now, and with the row raised the only recess left on
 * it is the lead cell — which is what lets the number be the largest thing on
 * the row and what buys the height back. See that part for the whole argument,
 * for the two-line phone arm, and for the cell order every cell names rather
 * than relies on.
 *
 * The panes sit side by side at every width (see `LeagueTeams` for why they
 * must, and for why the columns wait until `lg`), which leaves this one ~165px
 * at 390 — three cells beside a name there is a name of four characters.
 */

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
  // Both point lenses take the decimal: they are one unit in two tenses, and a
  // season total rounded to a whole number beside a projection carrying a
  // tenth would read as two different kinds of figure.
  return lens === "points" || lens === "season"
    ? value.toFixed(1)
    : value.toLocaleString("en-US");
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
    (sum, seat) => sum + (lensValue(seat.player, lens) ?? 0),
    0,
  );
  if (total <= 0) return null;
  return lens === "season" ? total.toFixed(1) : total.toLocaleString("en-US");
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
  season: { key: "Season", unit: "pts" },
  capital: { key: "Capital", unit: "cap" },
  ktc: { key: "KTC", unit: "ktc" },
};

/**
 * In control order — the two tenses of this page's own points, then its draft
 * capital, then the market.
 *
 * **Four keys where the ledge was measured for three**, which is a width to
 * watch rather than one that has moved: the roster pane's ledge draws these as
 * keys from `lg` up, where the track has room, and as a single `<select>` below
 * it — the arrangement that exists because three keys do not fit a ~165px pane.
 * A fourth costs the select an option and the track ~44px of its own.
 */
export const LENSES: readonly Lens[] = ["points", "season", "capital", "ktc"];

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
 * **It carries its own track now, where the caller used to.** It sat inside the
 * ledge's recess beside a `Value in` caption, and with the caption gone the
 * recess held one thing — so the recess is the control rather than a box around
 * it. That also settles the emit-order question the split would otherwise
 * raise: the track's `gap-[3px]` and this group's own gap are the same property
 * at the same specificity, and a caller writing one beside the other is a coin
 * flip. There is one gap, and it is here.
 *
 * The caller owns **only the display arm** (`hidden lg:inline-flex` on the
 * roster pane, where a ~165px phone pane gets a `<select>` instead), which is
 * the one thing the track cannot know about itself.
 *
 * **24px, sized to its keys rather than to the row.** The ledge is one line
 * above `lg` and the control shares it with the pane's name; keys that grew
 * with the row would take that name's width, which is the same measurement the
 * teams pane's key makes one pane over.
 */
export function LineupLensKeys({
  lens,
  onChange,
  className = "",
}: {
  lens: Lens;
  onChange: (lens: Lens) => void;
  /** The display arm, and nothing else — see above. */
  className?: string;
}) {
  return (
    <div
      role="group"
      aria-label="Value lens"
      className={`${CONSOLE_PANE_TRACK} h-6 shrink-0 items-center gap-[3px] p-[2px] ${className}`}
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
          className={`h-5 shrink-0 rounded-full border px-2.5 text-center font-mono text-[length:var(--fs-10)] uppercase tracking-[0.12em] transition-[color,box-shadow] duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-active/60 ${
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
 * One seat, as a {@link PaneWeekRow}.
 *
 * **The figure's colour is the league's median at this slot**, not its own
 * magnitude and not a rank — see `slotPercentile`. A seat the lens says nothing
 * about draws an em dash and no colour at all: an absent figure has no standing
 * against a median, and painting it red would claim the worst answer in the
 * league for a player nobody has an answer about.
 *
 * **The bay says the seat and is anodised by the position of whoever is in
 * it**, which is the reading this row gained and keeps: a flex seat still reads
 * `FLX` and is anodised tight-end copper, so a reader scanning the column can
 * see what their flex is actually filled with. An empty seat takes no
 * anodising — there is no position to state, and a coloured empty seat would
 * claim there was.
 *
 * The face, the name's ink and the NFL team are all the part's now — and the
 * team has left its own column for the second line, where it reads `WR · CIN`
 * beside the position. That is what took the em-dash rule this row used to
 * carry with it: a team cell between a name and a figure could not draw a dash,
 * where a dash in a run of facts on its own line reads as the absence it is.
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
  const name = player ? (player.name ?? player.player_id) : "Empty";

  return (
    <PaneWeekRow
      seat={{ label: slotLabel(slot), position: player?.positions[0] ?? null }}
      // An empty seat draws the bare mount with no letter — there is no player
      // to take an initial from, and `Empty`'s `E` would be one.
      face={{ playerId: player?.player_id ?? null, name: player ? name : "" }}
      name={name}
      shortName={player?.name ? shortName(player.name) : name}
      // Not on the wire — see the lamp.
      status={null}
      // `POS · TEAM`, and **nothing else on the line**: no groove, no opponent,
      // no kickoff. This payload has no game data of any kind, so the week
      // row's run of game facts would be a column of em dashes answering a
      // question the manager card is not asking — which is what passing no
      // `opponent` at all says, rather than passing null. See the prop.
      note={player?.team ?? null}
      figure={{
        text: figure(value, lens),
        percentile: value === null ? null : slotPercentile(value, median),
      }}
    />
  );
}

/**
 * A bench player: the same tile in the drawer, with his own position in the bay
 * rather than a seat's name.
 *
 * **`ground="drawer"` is the whole of the difference** — one step less cast,
 * since the row sits on a part rather than on glass. That the two are otherwise
 * the same object is the point: a bench row and the seat row it covers are read
 * directly over each other, and until this pass one of them had a face and the
 * other did not.
 *
 * A bench player's figure has no seat to have a median at, so it takes the
 * label's ink rather than the ramp's — there is nothing here for a colour to be
 * a statement about.
 */
function BenchRow({ player, lens }: { player: LineupPlayer; lens: Lens }) {
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
      // As the seats above: `POS · TEAM` and no game run.
      note={player.team}
      figure={{ text: figure(lensValue(player, lens), lens), percentile: null }}
    />
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
 * The type and the keys' surface live in `pane.tsx` since the lineup checker's
 * and gametime's lineup panes took the same drawer for their benches — see
 * {@link drawerBarClass} for the key and {@link PaneFoot} for what it stands on.
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
  const span = pickSpan(picks);

  return (
    // **Two of the pane's parts, as a fragment**: the glass the starters scroll
    // on and the drawer rises in, and the foot the two keys stand on below it.
    // `LeagueTeams` renders this as a direct child of `Pane`, whose flex column
    // is what gives the glass the height the foot leaves it — a wrapper here
    // would make the two one flex item, and the glass would stop shrinking.
    <>
      {/* A frame rather than a scroller: the starters scroll inside it and the
          drawer rises inside it. `overflow-hidden` is what keeps the drawer's
          own corners inside the glass's radius and what stops a mid-animation
          drawer painting over the pane's edge. */}
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
            // A partial lineup must say so — see `unknown_slots` on the
            // contract. Inside the scroller with the seats it qualifies, rather
            // than pinned under them: it is part of the lineup's reading, and
            // the keys on the foot below are the only things on this pane that
            // hold their place.
            <p className="m-0 px-2 py-2 font-mono text-[length:var(--fs-11)] uppercase tracking-[0.14em] text-foreground/60">
              Not shown: {lineup.unknown_slots.join(", ")}
            </p>
          )}
        </div>

        {bars.length > 0 && (
          // **One drawer for both readings**, where two over one list would
          // cover it twice — see {@link PaneDrawer} for the box, and `toggle`
          // for why switching does not collapse the one that is up.
          //
          // `translate` in the swap's transition list, not `transform`:
          // Tailwind v4's `translate-y-*` sets the `translate` property, so a
          // list naming `transform` let the 8px slide jump rather than ease.
          <PaneDrawer id={drawerId} open={open !== null}>
            <div
              className={`lab-anim lab-scroll-glass min-h-0 flex-1 overflow-y-auto overflow-x-hidden [transition:opacity_160ms_ease,translate_220ms_cubic-bezier(0.2,0.8,0.2,1)] ${
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
        )}
      </PaneGlass>

      {bars.length > 0 && (
        <PaneFoot>
          {bars.includes("bench") && (
            <button
              type="button"
              onClick={() => toggle("bench")}
              aria-expanded={open === "bench"}
              aria-controls={drawerId}
              className={drawerBarClass(open === "bench")}
            >
              <DrawerBar open={open === "bench"} label={`Bench · ${lineup.bench.length}`}>
                {bench && (
                  <>
                    {/* **The total drops below `lg`**, where the place and the
                        caret are what the key is for: at ~150px three figures
                        and a word leave the word nothing. It is on the
                        standings row opposite at every width, which is where a
                        reader compares benches anyway. */}
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
              className={drawerBarClass(open === "picks")}
            >
              <DrawerBar open={open === "picks"} label={`Picks · ${picks.length}`}>
                {/* The span is what the key can say that the count cannot —
                    how far out the portfolio runs. Dropped below `lg` on the
                    bench key's own argument. */}
                {span && (
                  <span className="hidden shrink-0 font-mono text-[length:var(--fs-12)] tracking-[0.08em] tabular-nums text-[color:var(--billet-label)] lg:inline">
                    {span}
                  </span>
                )}
              </DrawerBar>
            </button>
          )}
        </PaneFoot>
      )}
    </>
  );
}
