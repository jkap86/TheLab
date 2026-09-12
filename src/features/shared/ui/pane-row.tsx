import type { CSSProperties, ReactNode } from "react";

import {
  CONSOLE_TILE,
  CONSOLE_TILE_DRAWER,
  CONSOLE_TILE_LIT,
  CONSOLE_TILE_SELECTED,
} from "../console-chrome";
import { rankColor } from "../rank-ramp";
import { BilletFinish } from "./card-plate";

/**
 * One row of an expanded league card's pane, in every tool: a **tile**
 * carrying a lead cell, a face, a name, and up to four readings.
 *
 * ## Dead, and kept
 *
 * **It has no reader.** The four lists it was written to unify — the manager
 * card's standings, its roster seats, its bench and its pick portfolio — are
 * {@link PaneWeekRow} now, so a reader walking between the three tools sees one
 * row shape over one league. `PaneRowLead`, `PaneRowFigure` and `PaneRowValue`
 * went with it; `PaneRowFaceMount` and `StatusLamp` are still live, both being
 * the week row's own.
 *
 * It is kept on `peekActiveSeason`'s terms, and the terms
 * `CONSOLE_HOUSING_INSET` and `--housing-inset-shadow` are already kept on: the
 * argument below — why a row is a *part* rather than a channel, and what it
 * cost to find that out — is the thing a later reader would otherwise
 * reconstruct, and it is what the tile the week row draws is built on. What is
 * genuinely gone is only the four-lists-at-four-heights problem it solved;
 * the solution is one component over.
 *
 * It replaces four separately-authored row components that had drifted apart —
 * `StandingRow` on the manager card's standings, `SeatRow`/`BenchRow` in the
 * roster breakdown, the lineup checker's pair, gametime's pair, and the
 * `DrawerRow` all three benches and the pick portfolio were drawn with. The
 * same player was two objects one press apart and four objects one tool apart:
 * a face on the manager's seats and nowhere else, a sans name on one card and
 * a mono name on two, `J. Chase` below `lg` in one tool and the whole name in
 * the others, figure cells of 78 / 70 / 56 / 56, a 1px border on two of the
 * four lists so that two lists declared at 38px were not the same height, and
 * three unrelated spellings of "this row is picked".
 *
 * **It lives beside `Pane` for that component's own reason.** `LeagueTeams`
 * draws one list and `LineupBreakdown` draws another and is rendered *by* the
 * first, so a row exported from either is an import cycle; and the checker and
 * gametime are sibling features, which may reach `features/shared` and not each
 * other.
 *
 * ## The tile, and why it is a part rather than a channel
 *
 * The rows were channels cut into the pane's glass and the **drawer's** rows
 * were already parts — billet stock bolted over the starters, which is what
 * says a drawer is a separate reading rather than the list continuing. So
 * unifying them meant picking one, and a row carrying a face, a name and a
 * figure is a *subject*: a thing, rather than the absence of one. See
 * {@link CONSOLE_TILE}.
 *
 * Two things fall out of that and both are worth having. **A part can carry
 * state that a channel cannot** — a selected channel had to be a wash *over*
 * the row, because a fill floods a cut and the row stops reading as cut at
 * all, where a selected part is simply lit. And the figure comes out of its
 * well: with the row raised there is one recess left on it, which is the lead
 * cell, so the number is struck straight into the face at `--fs-14` and is the
 * largest thing on the row. That is what buys the height back — **34px at `lg`
 * against the old 38**, the well's own vertical padding being what went.
 *
 * ## Geometry
 *
 * **34px at `lg`, 48px below it**, `mb-1`, radius 7, `overflow-hidden`.
 * Padding `0 9px 0 6px` at `lg` — asymmetric, because the lead cell is a well
 * with its own inset and the figure is bare ink — and `0 7px` below it.
 *
 * Above `lg` it is one row of cells and **every cell names its own
 * `lg:order-*`**: lead (1), face (2), name (3), marks (4), status (5), note
 * (6), meta (7), figure (8), second (9), tail (10). Nothing may rely on DOM
 * order — `StandingRow` recorded what happens when one cell forgets: the mark
 * sorted to 0, ahead of the place cell, under a head promising the place
 * first.
 *
 * Below `lg` it is two lines through `lg:contents` on two wrapping spans —
 * face, name and the badges on the first; lead, note, meta and the figures on
 * the second. One node in two layouts, which is the trick the app rack's brand
 * row turns: rendering both shapes and hiding one puts every row in the DOM
 * twice and reads each of them twice to anything listening.
 *
 * **Both panes of a card have to move together.** The standings and the roster
 * are read across each other, and so are the checker's two lineups and
 * gametime's; a row of a different height in one pane puts the other out of
 * step, which is invisible as anything but a slight wrongness. That is the
 * whole point of there being one part: the heights are one edit in one file.
 */

/**
 * The six positions the lead cell is filled for, as hues.
 *
 * The cell prints the **seat** and is filled by the **position of whoever is
 * in it**, so a flex seat reads `FLX` and is filled tight-end rose — which is
 * the reading the colour exists for, and something a seat name alone cannot
 * say. Anything not named here takes no fill: the individual-defender
 * positions, a seat with nobody in it, a standings ordinal and a pick's
 * season. "No position" is then the absence of a colour rather than a seventh
 * one.
 *
 * The values are token names rather than numbers so the palette is declared
 * once, in `globals.css`, where its argument is written down and where the
 * light scheme moves the fill and the ink around them — see `--slot-fill-l`.
 */
const SLOT_HUE: Record<string, string> = {
  QB: "var(--slot-qb)",
  RB: "var(--slot-rb)",
  WR: "var(--slot-wr)",
  TE: "var(--slot-te)",
  K: "var(--slot-k)",
  DEF: "var(--slot-def)",
  DST: "var(--slot-def)",
};

/** What a status letter is, said out loud — `GameChip`'s rule: a bare `Q` announced as "Q" is not a reading. */
const STATUS_NAMES: Record<PaneRowStatus, string> = {
  Q: "Questionable",
  O: "Out",
  IR: "On injured reserve",
};

/** Sleeper's injury flags, narrowed to what a lamp can say. */
export type PaneRowStatus = "Q" | "O" | "IR";

/** The cell at the row's head: what the seat is called, and what fills it. */
export type PaneRowLead = {
  /** What is printed — a slot (`FLX`), an ordinal (`2nd`) or a season (`2027`). */
  label: string;
  /**
   * What the cell is *filled by*, which is a different thing from what it
   * says: the position of whoever is sitting in the seat. Null — an empty
   * seat, an ordinal, a season — leaves the milled well showing through and
   * the label on `--billet-label`.
   */
  position?: string | null;
  /**
   * The cell's width, as a **class string** rather than a number.
   *
   * Tailwind finds classes by scanning source text, so `lg:w-[${n}px]`
   * assembled from a value generates no CSS at all — the trap
   * `DRAWER_BAR_HEIGHT` records, where a bar silently rendered at the wrong
   * height. A caller passes a literal, which is the idiom `DrawerRow`'s own
   * `leadWidth` already used.
   */
  width?: string;
  /**
   * Digits rather than letters: tabular, and **untracked**.
   *
   * A slot is three letters and wants the 0.1em that makes them read as a tag;
   * an ordinal and a season are numbers, where tracking is width spent on
   * nothing — and at the standings' own 40px, `12th` with the seat cell's
   * tracking clips. It is a separate knob from {@link PaneRowLead.width}
   * because the pick portfolio's season is numeric at a *third* width.
   */
  numeric?: boolean;
};

/**
 * The row's subject, as a face.
 *
 * `null` draws no mount at all — the pick rows, whose subject is an asset
 * rather than a person. A team row passes `{ playerId: null, name }` and gets
 * the same mount carrying the team's initial, which is what makes a standings
 * row and a seat row the same object at a glance.
 */
export type PaneRowFace = { playerId: string | null; name: string };

/** One figure, and where it stands. */
export type PaneRowFigure = {
  /** Already formatted by the caller — the lens decides the decimals. */
  text: string;
  /**
   * 0–100, or `null` where there is nothing to colour.
   *
   * Null draws `--billet-label` and **no colour at all**: an absent figure has
   * no standing against a median, and painting it red would claim the worst
   * answer in the league for a player nobody has an answer about.
   *
   * Which percentile is the caller's, unchanged from before the part:
   * `sharePercentile` for a team's total, `slotPercentile` against
   * `slotMedians` for a seat, `rankPercentile` for a bench place.
   */
  percentile: number | null;
};

export function PaneRow({
  lead,
  face,
  name,
  shortName,
  status = null,
  marks,
  note = null,
  meta = null,
  figure,
  second = null,
  tail,
  mine = false,
  selected = false,
  onPress,
  ground = "glass",
}: {
  lead: PaneRowLead;
  /** The face mount, or `null` for a row whose subject is not a person. */
  face: PaneRowFace | null;
  /** Printed whole from `lg` up. A node, not a string — see the pick rows. */
  name: ReactNode;
  /** Printed below `lg`. Callers pass `shortName(name)` from `features/shared/format`. */
  shortName: ReactNode;
  /** The injury lamp. `null` renders nothing. */
  status?: PaneRowStatus | null;
  /**
   * The caller's own badges, on the name's line at both widths.
   *
   * Not in the handoff's props table, and the lineup checker is what asks for
   * it: its seat rows carry `locked`, `in seat`, `sit` and `→ SF`, and its
   * bench rows a `start` chip. They share the name's line rather than the
   * readings' because a render forced it — left loose in the wrap they went to
   * the second line, where a badge beside a slot, a figure and a gap overflows
   * and takes the row to three lines, and a three-line row in one pane against
   * a two-line row in the other is two lineups that no longer read across.
   */
  marks?: ReactNode;
  /**
   * One short fact between the name and the readings — the NFL team code.
   *
   * **`null` renders nothing, never an em dash.** That is the one place these
   * rows part company with the app's three-way grammar, and it is the
   * grammar's own reason: the dash exists to keep an absence from reading as a
   * zero, and there is no zero for a team to be mistaken for. Beside a *name*
   * a dash reads as a missing number.
   */
  note?: string | null;
  /**
   * The wide reading: a kickoff, or a game clock. 88px and **untracked** at
   * `lg`; below it, the line's own slack, truncating.
   *
   * 88px rather than the design's 64 because `kickoffTime` formats in the
   * reader's own locale, so an en-US afternoon game is `Sun 12:00 PM` — 97.4px
   * tracked and 83.5 untracked in this build's own Plex Mono. Letter-spacing
   * is the first thing to spend, which is the card's own rule about its window
   * labels one plane up.
   */
  meta?: string | null;
  figure: PaneRowFigure;
  /**
   * A second figure at 56px — gametime's `Live`, which is the reading that
   * page exists for and is inked accent while the game runs.
   */
  second?: { text: string; live: boolean } | null;
  /**
   * The last cell, rendered after everything else: the checker's 98px gap
   * meter. It carries **its own `lg:order-10`**, because it is the caller's
   * element and its width is mode-dependent — the same contract `DrawerRow`'s
   * children had.
   */
  tail?: ReactNode;
  /**
   * The reader's own team: a lit rail down the row's left edge.
   *
   * **Two props rather than the handoff's one `state`**, and the handoff's own
   * prototype is what settles it: its cross-tool strip draws the standings row
   * as `mine` *and* as the selected tile at once, because they are two
   * different facts — whose team this is, and what the pane opposite is
   * showing. Collapsed into one value, `mine` wins on the reader's own row and
   * that row is the one selected by default, so the app would open with
   * nothing on screen saying which team the roster pane had solved.
   */
  mine?: boolean;
  /** Picked: the tile is lit, and the button reports `aria-pressed`. */
  selected?: boolean;
  /** Absent renders an `<li>`; present renders an `<li><button>`. */
  onPress?: () => void;
  /**
   * Where the row stands. `drawer` is the bench and the portfolio behind a
   * `DrawerBar` — the same part with one step less cast, since it sits on a
   * *part* rather than on glass.
   */
  ground?: "glass" | "drawer";
}) {
  const hue = (lead.position && SLOT_HUE[lead.position]) ?? null;
  const leadWidth = lead.width ?? "w-[30px] lg:w-[34px]";

  const surface = selected
    ? CONSOLE_TILE_SELECTED
    : ground === "drawer"
      ? CONSOLE_TILE_DRAWER
      : CONSOLE_TILE;

  // Two whole strings rather than a base plus an override: the pressable arm
  // adds a cursor, a focus ring and a transition, and every one of those is a
  // different property from the ones the shape names, so there is nothing here
  // for an emit-order coin flip to decide.
  const shape =
    `${surface} relative mb-1 flex h-12 w-full flex-col justify-center gap-[3px] rounded-[7px] px-[7px] ` +
    "lg:h-[34px] lg:flex-row lg:items-center lg:gap-[9px] lg:pl-1.5 lg:pr-[9px]";

  const body = (
    <>
      <BilletFinish />

      {mine && (
        // A rail, never a fill: a fill would flood the tile and the row would
        // stop reading as a part standing on the glass. Same stock the history
        // rail's own fill is drawn from rather than a second green for "yours".
        <span
          aria-hidden
          className="pointer-events-none absolute inset-y-1 left-0 w-[3px] rounded-full bg-[image:var(--lit-bar-bg)] shadow-[0_0_9px_var(--accent-glow)] lg:inset-y-[5px]"
        />
      )}

      {/* Line 1 below `lg`; three of the row's cells above it. */}
      <span className="relative flex w-full min-w-0 items-center gap-1.5 lg:contents">
        {face && (
          <PaneRowFaceMount
            face={face}
            className="flex size-5 text-[length:var(--fs-9)] lg:order-2 lg:size-[22px] lg:text-[length:var(--fs-9-6)]"
          />
        )}
        <span
          className={`relative min-w-0 flex-1 truncate font-display text-[length:var(--fs-12-5)] font-medium text-[color:var(--billet-name)] [text-shadow:var(--billet-name-shadow)] lg:order-3 lg:text-[length:var(--fs-13)]`}
        >
          <span className="lg:hidden">{shortName}</span>
          <span className="hidden lg:inline">{name}</span>
        </span>
        {marks}
        {status && <StatusLamp status={status} />}
      </span>

      {/* Line 2 below `lg`; the rest of the row above it. */}
      <span className="relative flex w-full items-center gap-[5px] lg:contents">
        <span
          style={hue ? ({ "--slot-hue": hue } as CSSProperties) : undefined}
          className={`relative inline-flex shrink-0 justify-center overflow-hidden rounded-[4px] bg-[image:var(--billet-well-bg)] p-[2px] text-[length:var(--fs-9)] shadow-[var(--standing-well-shadow)] lg:order-1 lg:rounded-[5px] lg:text-[length:var(--fs-10)] ${leadWidth}`}
        >
          {/* The fill is an ordinary background inset 2px on all four sides —
              the design prototype rides it on an SVG `<rect>`, which is a
              constraint of that document rather than a decision. */}
          {hue && (
            <span
              aria-hidden
              className="pointer-events-none absolute inset-[2px] rounded-[3px] bg-[oklch(var(--slot-fill-l)_var(--slot-fill-c)_var(--slot-hue))]"
            />
          )}
          <span
            className={`relative font-mono ${lead.numeric ? "tabular-nums" : "tracking-[0.1em]"} ${
              hue
                ? "text-[color:oklch(var(--slot-ink-l)_var(--slot-ink-c)_var(--slot-hue))]"
                : "text-[color:var(--billet-label)]"
            }`}
          >
            {lead.label}
          </span>
        </span>

        {/* **Below `lg` a row shows one contextual cell, not two**, and a render
            at 390 is what forced it: a pane is ~160px there, and lead, note,
            meta, figure and a second reading are five cells on that line — the
            meta gave up everything and rendered as an ellipsis alone (11.5px
            for gametime's clock, 17 for the checker's kickoff). Where a row has
            both, the **meta wins**: a clock or a kickoff is a fact about *this
            week*, where the NFL team is a permanent one the shares drawers
            answer at any width. Nothing that existed is lost by it — gametime's
            clock is where it already was, the checker gains a kickoff it did
            not draw at all below `lg`, and the manager's rows carry a note and
            no meta, so they are untouched. The two arms are whole strings, on
            this file's own rule about a base and an override. */}
        {note && (
          <span
            className={
              meta
                ? "relative hidden shrink-0 font-mono tracking-[0.08em] text-[color:var(--billet-label)] lg:order-6 lg:block lg:w-7 lg:text-right lg:text-[length:var(--fs-10)]"
                : "relative shrink-0 font-mono text-[length:var(--fs-9)] tracking-[0.08em] text-[color:var(--billet-label)] lg:order-6 lg:w-7 lg:text-right lg:text-[length:var(--fs-10)]"
            }
          >
            {note}
          </span>
        )}

        {/* Present or not, the line keeps its slack so the figure sits on the
            row's right edge at both widths. Above `lg` the name is the `flex-1`
            and this is 88px of column, so the empty arm is `lg:hidden`. */}
        {meta ? (
          <span className="relative min-w-0 flex-1 truncate whitespace-nowrap text-right font-mono text-[length:var(--fs-9)] uppercase text-[color:var(--billet-label)] lg:order-7 lg:w-[88px] lg:flex-none lg:text-[length:var(--fs-10)]">
            {meta}
          </span>
        ) : (
          <span aria-hidden className="min-w-0 flex-1 lg:hidden" />
        )}

        <PaneRowValue figure={figure} className="lg:order-8 lg:w-[70px]" />

        {second && (
          <span
            className={`relative shrink-0 text-right font-mono text-[length:var(--fs-14)] font-medium tabular-nums lg:order-9 lg:w-14 ${
              second.live
                ? "text-[color:var(--readout-text)] [text-shadow:var(--readout-text-glow)]"
                : "text-[color:var(--billet-figure)]"
            }`}
          >
            {second.text}
          </span>
        )}

        {tail}
      </span>
    </>
  );

  // **The hover halo is spelled whole, per ground.** A shadow list is atomic, so
  // a `hover:shadow-[…]` naming only the glow would *replace* the tile's own
  // chamfer rather than add to it — the row would lose its bevel the moment a
  // pointer crossed it. Two literals rather than one composed with the surface
  // constant, for the reason `DRAWER_BAR_HEIGHT` is spelled literally: Tailwind
  // scans source text, and a class assembled from a value generates no CSS.
  const hover = selected
    ? ""
    : ground === "drawer"
      ? "hover:shadow-[var(--tile-drawer-shadow),0_0_14px_-6px_var(--accent-glow)]"
      : "hover:shadow-[var(--tile-shadow),0_0_14px_-6px_var(--accent-glow)]";

  if (!onPress) return <li className={shape}>{body}</li>;

  return (
    <li>
      <button
        type="button"
        onClick={onPress}
        aria-pressed={selected}
        className={`${shape} cursor-pointer text-left transition-[box-shadow,background-image] duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-active/60 ${hover}`}
      >
        {body}
      </button>
    </li>
  );
}

/**
 * The subject's face, in a hole milled in the part — `OwnerBillet`'s own
 * construction one size down, and the single change in this pass that touches
 * the most call sites: only the manager card's seat rows drew one, so the
 * checker, gametime and all three drawers showed the same player as a
 * different object.
 *
 * **The headshot is a background layer over the initial, and the initial
 * renders unconditionally behind it.** A great many of these ids have no
 * thumbnail — a team defence's id is a team code, and Sleeper's board turns
 * over faster than its art does — and a broken `<img>` paints the platform's
 * own glyph over the letter even at `alt=""`, measured, where a background
 * that 404s paints nothing and the mount underneath is exactly the fallback it
 * was put there to be.
 *
 * **An empty seat draws the bare mount with no letter**: there is no player to
 * take an initial from, and `Empty`'s `E` would be one.
 *
 * `background-position: center top`, because a headshot is framed head and
 * shoulders and a centred crop of one in a 22px disc is a chin.
 *
 * It is not `Avatar`, and that is deliberate rather than an oversight: that
 * component draws *either* a face *or* a letter, where this wants the letter
 * **behind** the face — and its `xs` is a bordered `foreground/5` disc at
 * 18/20px, which beside this milled 20/22 mount would be the very drift the
 * part exists to remove. A team row passes `{ playerId: null, name }` and gets
 * this mount with the team's initial in it.
 */
function PaneRowFaceMount({
  face,
  className,
}: {
  face: PaneRowFace;
  /**
   * The mount's **display, size and text size**, which the caller owns because
   * two rows want three of them: 20/22px here, 40px as a week row's own cell
   * and 17px on that row's first line below `lg`. They are the caller's rather
   * than a `size` prop for the trap `DRAWER_BAR_HEIGHT` records — Tailwind
   * scans source text, so a class assembled from a value generates no CSS —
   * and they are kept *out* of the base string for the other one: `size-5` and
   * `size-10` are two base utilities of the same specificity, so which wins
   * would be Tailwind's emit order rather than the caller's.
   */
  className: string;
}) {
  const initial = face.name.trim().charAt(0).toUpperCase();

  return (
    <span
      aria-hidden
      className={`relative shrink-0 items-center justify-center overflow-hidden rounded-full bg-[image:var(--billet-well-bg)] font-display font-semibold text-[color:var(--tile-face-ink)] shadow-[var(--standing-well-shadow)] ${className}`}
    >
      {initial}
      {face.playerId && (
        <span
          className="absolute inset-0 bg-cover bg-top"
          style={{
            backgroundImage: `url(https://sleepercdn.com/content/nfl/players/thumb/${face.playerId}.jpg)`,
          }}
        />
      )}
    </span>
  );
}

/**
 * The row's own figure, struck straight into the part's face.
 *
 * **No well.** With the row raised there is one recess left on it — the lead
 * cell — so the number is the largest thing on the row at `--fs-14` and the
 * only thing that carries a colour. `--standing-engrave` is the strip's own
 * stack (a lit lip over stacked dark steps) and the ramp supplies the ink, so
 * the figure gains weight without gaining a second hue.
 *
 * **Engraved rather than polished**, which is the handoff's own open decision
 * answered its own way: the app can clip a tinted-chrome gradient to the
 * glyphs (`RampFigure` in `card-plate.tsx` does it for the summary's standing
 * bays), and it costs a compositor buffer per figure — up to nine per open
 * card on a page with no virtualizer, which is the budget that killed an iOS
 * Safari tab. The engraved figure is what was approved; `POLISH` and
 * `polish()` are the two things to lift if a designer ever asks for the other.
 */
function PaneRowValue({
  figure,
  className,
}: {
  figure: PaneRowFigure;
  className: string;
}) {
  const tone = figure.percentile === null ? null : rankColor(figure.percentile);

  return (
    <span
      className={`relative shrink-0 text-right font-mono text-[length:var(--fs-14)] font-medium tabular-nums ${
        tone ? "" : "text-[color:var(--billet-label)]"
      } ${className}`}
      style={
        tone
          ? {
              color: tone,
              textShadow: `var(--standing-engrave), 0 0 16px ${rankColor(figure.percentile, 0.4)}`,
            }
          : undefined
      }
    >
      {figure.text}
    </span>
  );
}

/**
 * The injury flag, as a **raised chip** rather than a ringed letter.
 *
 * The outline pill was the one object on a row drawn as a border — a hoop
 * around a letter, flat against a part chamfered on four edges. This is a part
 * instead: a filled face carrying the letter, a lit top lip, a dark underside
 * and a cast onto the tile below it, which is `CONSOLE_CHIP_RAISED` at letter
 * scale.
 *
 * **Dark face, lit letter — the inverse of the slot chip beside it**, and
 * deliberately: the slot is a *label* and reads as a filled tag, where this is
 * a *warning* and reads as a lamp. Same hue family either way, so the two are
 * plainly one family at two jobs. Both hues are colours the card already
 * spends rather than a third — the ramp's red for an `O` or an `IR`, the amber
 * `--median-ink` spends on "neither" for a `Q`.
 *
 * The letter is `aria-hidden` under an `sr-only` sentence, on `GameChip`'s
 * rule: a bare `Q` announced as "Q" is not a reading.
 *
 * **Nothing passes a `status` today** — the field exists on no payload; see
 * `PaneRow`'s callers and the note on `LineupPlayer`. The lamp is built rather
 * than deferred because it is what the four rows are being unified *to*, and
 * a part missing one of its states is a part that has to be reopened.
 */
function StatusLamp({ status }: { status: PaneRowStatus }) {
  const hue = status === "Q" ? "var(--status-q-hue)" : "var(--status-out-hue)";

  return (
    <span
      style={{ "--status-hue": hue } as CSSProperties}
      className="relative inline-flex min-w-[15px] shrink-0 items-center justify-center overflow-hidden rounded-[4px] bg-[oklch(var(--status-face-l)_var(--status-face-c)_var(--status-hue))] px-[3px] py-px text-[length:var(--fs-9)] shadow-[var(--status-chip-shadow)] lg:order-5 lg:min-w-[16px] lg:px-1"
    >
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 rounded-[4px] shadow-[var(--status-chip-chamfer)]"
      />
      <span className="sr-only">{STATUS_NAMES[status]}</span>
      <span
        aria-hidden
        className="relative font-mono tracking-[0.06em] text-[color:oklch(var(--status-ink-l)_var(--status-ink-c)_var(--status-hue))] [text-shadow:var(--status-ink-shadow),0_0_8px_oklch(var(--status-ink-l)_var(--status-ink-c)_var(--status-hue)/0.45)]"
      >
        {status}
      </span>
    </span>
  );
}

/**
 * The six positions the **seated insert** is anodised for, as hues.
 *
 * A second table beside {@link SLOT_HUE} rather than a second reading of it,
 * and the palettes are genuinely different objects: that one is a light candy
 * fill measured for a flat chip lying on glass, where an insert seated in a
 * milled bay is read off its own gradient and drops to metal. The angles are
 * the same six pulled a few degrees toward the console's cooler axis — brass
 * for WR, copper for TE, teal-green for K — so a position is still the colour a
 * reader knows it by. See `--slot-metal-face` for the measurement.
 *
 * Anything not named here takes no anodising: the insert is billet stock and
 * the label keeps `--billet-label`, which is the same "no position is the
 * absence of a colour rather than a seventh one" rule the chip lives by.
 */
/**
 * The insert's anodised face and its engraving, composed **at the use site**.
 *
 * A custom property's `var()`s are substituted where it is declared, so a token
 * carrying this whole gradient and naming `var(--slot-hue)` computes to the
 * guaranteed-invalid value on `:root`, where no hue is set — measured, the
 * insert rendered `background-image: none`. So `globals.css` carries the four
 * bands and the ink as numbers, the same shape `--slot-fill-l` is in and for
 * the same reason, and the shape of the gradient is here.
 */
const METAL_FACE =
  "linear-gradient(180deg," +
  " oklch(var(--slot-metal-l1) var(--slot-metal-c1) var(--slot-hue)) 0%," +
  " oklch(var(--slot-metal-l2) var(--slot-metal-c2) var(--slot-hue)) 8%," +
  " oklch(var(--slot-metal-l3) var(--slot-metal-c3) var(--slot-hue)) 62%," +
  " oklch(var(--slot-metal-l4) var(--slot-metal-c4) var(--slot-hue)) 100%)";

const METAL_INK =
  "oklch(var(--slot-metal-ink-l) var(--slot-metal-ink-c) var(--slot-hue))";

const SLOT_METAL: Record<string, string> = {
  QB: "var(--slot-metal-qb)",
  RB: "var(--slot-metal-rb)",
  WR: "var(--slot-metal-wr)",
  TE: "var(--slot-metal-te)",
  K: "var(--slot-metal-k)",
  DEF: "var(--slot-metal-def)",
  DST: "var(--slot-metal-def)",
};

/** The seat a week row is about, and the two facts its bay draws. */
export type PaneWeekSeat = {
  /** What is printed — the *seat* (`FLX`), or a bench player's own position. */
  label: string;
  /**
   * What the insert is *anodised by*, which is a different thing from what it
   * says: the position of whoever is sitting in the seat. So a flex seat reads
   * `FLX` in tight-end copper, which is the reading the colour exists for and
   * something a seat name alone cannot make.
   */
  position?: string | null;
  /**
   * The bay prints **digits** rather than a slot tag.
   *
   * A standings ordinal (`12th`) and a pick's season (`2026`) are numbers: the
   * `0.04em` that makes three letters read as a tag is width spent on nothing,
   * and `12th` with it clips the phone's 28px bay. It is `PaneRowLead.numeric`'s
   * own argument, moved — and it takes `tabular-nums` with it, so a column of
   * ordinals or seasons sets on one grid.
   */
  numeric?: boolean;
  /**
   * Anodise the insert by a hue the seat has no position to name.
   *
   * `SLOT_METAL[position]` answers nothing for a standings ordinal, and the
   * reader's own team is the one row a reader scans a table of twelve for — so
   * that row takes `--slot-metal-mine` and the ordinal goes accent. Ignored
   * where `position` already resolves, since a seat anodised by anything but
   * who is sitting in it is the one claim the colour must not make.
   */
  hue?: string;
  /**
   * The slot kickoff order would seat him in instead. Drawn *inside* the bay,
   * under a chevron, because it is a fact about the seat rather than about the
   * player — which is what took it off the name's line, where it was a badge
   * competing with three others.
   */
  moveTo?: string | null;
  /**
   * His game has kicked off. The insert goes graphite under a hatch with a
   * padlock below the label, and the row's second line says the word — three
   * cues, so the state is never a hue alone.
   */
  locked?: boolean;
};

/** The row's hero figure: what the page is read for. */
export type PaneWeekFigure = {
  /** Already formatted by the caller. */
  text: string;
  /**
   * 0–100, or null for no colour at all.
   *
   * With no gap column beside it the figure is the only place the comparison
   * can live, so it takes the rank ramp's two ends — which is not two verdicts
   * on one row but the one verdict, moved. Null is a row with nothing to
   * compare against: the opponent's whole pane, whose gap is the reader's with
   * the sign flipped and would be the same fact drawn twice, and a bench row,
   * which is not in a seat to have a gap from.
   */
  percentile?: number | null;
  /**
   * Ink it accent rather than by the ramp — gametime's live projection while
   * the game is running, which is the one thing a reader scanning that column
   * is looking for and is not a standing against anything.
   */
  live?: boolean;
};

/**
 * One seat of a week, as the two week tools draw it: a **bay** milled the full
 * height of the row's left edge with an anodised insert seated in it, the
 * subject's face beside it, and two lines — who he is and what he projects,
 * then where and when his game is.
 *
 * ## Why this is a second row rather than a widened {@link PaneRow}
 *
 * It is a deliberate, scoped drift and worth naming as one. `PaneRow` exists
 * because the same player was four objects one tool apart, and a second row
 * shape is that drift in miniature — so the line it is drawn on has to be one
 * somebody can state. It is this: **the two week tools are one object**, and
 * the manager card's browser is a different reading. The checker and gametime
 * list the same seats of the same week one press apart, so they move together
 * or they are the drift; the standings' ordinal and the pick portfolio's season
 * have no position to anodise and no game to name, so a bay milled for a
 * position is a bare hole on those rows and a second line is empty.
 *
 * Two components rather than one with a variant, for the same reason the
 * constants above are spelled whole: the two bodies are two layouts rather than
 * one with an override, and a shared body is a shared way to break the three
 * lists this pass does not touch. What they *do* share is every primitive —
 * the face mount, the injury lamp, the surfaces and the hover halo — so the
 * things that would actually drift are still one spelling.
 *
 * ## Geometry
 *
 * **48px at `lg`, 52px below it**, `mb-1`, radius 7, `overflow-hidden`, and
 * `padding: 0 10px 0 0` — no *left* padding, because the bay runs to the tile's
 * own edge and is clipped by its radius.
 *
 * Four zones at `lg` where the row it replaces had seven cells: the bay (48px),
 * the face (40px), the name column, and the figure (70px at `--fs-21`). What
 * went is the 98px two-track gap meter, the 28px team cell and the 88px kickoff
 * cell — the last two folded onto the second line, the first into the figure's
 * own ink. The subject's column goes from about 101px to about 231px at a
 * 1180px card, which is the whole point of the pass: the largest thing on the
 * row was a grey number and the row's subject had a third of its width.
 *
 * Below `lg` the two panes are ~150px apiece, so the face drops to 17px and
 * moves onto the name's own line — which is what hands the second line the
 * column's full width — and the figure goes with it.
 *
 * **Three cells are rendered at both widths and shown at one**, which is this
 * file's own idiom one grain up (`name`/`shortName` inside one span) and
 * `WeekStepper`'s rule for when it is safe: neither the face nor a formatted
 * figure holds state, and both gates are `display: none`, which takes the
 * hidden copy out of the accessibility tree as well as off the screen. So
 * exactly one of each is ever read. They are rendered twice because they
 * *reparent* — the face and the figure are row cells at `lg` and line-one cells
 * below it — and `display: contents` moves a box's children up, never a child
 * across.
 */
export function PaneWeekRow({
  seat,
  face,
  name,
  shortName,
  status = null,
  marks,
  note = null,
  // No default: absent and null are two states here — see the prop's own note.
  opponent,
  meta = null,
  figure,
  second = null,
  line2 = true,
  stacked = false,
  selected = false,
  onPress,
  ground = "glass",
}: {
  seat: PaneWeekSeat;
  /** The face mount, or `null` for a row whose subject is not a person. */
  face: PaneRowFace | null;
  /** Printed whole from `lg` up. */
  name: ReactNode;
  /** Printed below `lg`. Callers pass `shortName(name)` from `features/shared/format`. */
  shortName: ReactNode;
  /** The injury lamp. `null` renders nothing. */
  status?: PaneRowStatus | null;
  /**
   * The caller's own badges, on the name's line at both widths — `sit`, `start`
   * and the IR marks.
   *
   * **Chips at both widths, where the handoff draws `start` as a word on the
   * phone's second line and `sit` as a pill on its first.** One treatment
   * rather than two: a badge is a badge, and a reader who has learnt `sit` as a
   * pill should not have to learn `start` twice. The second line is left to the
   * game, which is what it is about.
   */
  marks?: ReactNode;
  /**
   * His NFL team. Drawn beside the position on the second line.
   *
   * **At `lg` only where the row has a game, and at both widths where it does
   * not** — see `opponent`, which is what decides that. A ~150px phone line
   * carrying a game has better uses for the width than a position the bay is
   * already printing; one carrying nothing else would simply be empty.
   */
  note?: string | null;
  /**
   * Who his team plays, already spelled — `opponentLabel(opponent, home)`.
   *
   * Null draws the app's em dash rather than nothing, which is the opposite of
   * {@link PaneRow.note}'s rule and right for the opposite reason: this sits in
   * a run of game facts rather than beside a name, so an absence reads as an
   * absence rather than as a missing number.
   *
   * **Absent — not null — is the row saying it has no game at all**, and the
   * whole run goes with it: the groove, the em dash, the clock and the scored
   * total. That is the manager card's four lists, whose payload carries no game
   * data of any kind (`LineupPlayer` is a name, positions, a team and three
   * valuations), where a `—` would be a column answering a question the card is
   * not asking. It is a third state rather than a fourth prop for
   * `parseRequestedSeason`'s reason: null is an answer — *no opponent this
   * week* — and collapsing it with "never asked" is how a bye would come to
   * read as a league with no schedule.
   *
   * Every week caller passes it, and `week-rows.test.ts` pins that textually:
   * a week row that lost the prop would quietly lose its clock, its scored
   * total and its `locked` word, and render a perfectly ordinary row.
   */
  opponent?: string | null;
  /** The kickoff, or gametime's game clock — the same cell one tense later. */
  meta?: string | null;
  figure: PaneWeekFigure;
  /**
   * A second figure at the second line's right end — gametime's scored total,
   * beside the live projection its hero cell carries.
   *
   * It rides the *second* line rather than a column of its own because there is
   * no column left to give it: the row's four zones are the design's, and a
   * fifth would come out of the name. On the second line it sits among the
   * facts it is about — what he has done, beside where the game is.
   */
  second?: string | null;
  /**
   * Draw a second line at all.
   *
   * A standings team and a draft pick have nothing to put on one — a team has a
   * place, a name and a total, and a pick is not a person — so the row is a
   * single line **vertically centred at the same height**, which is what keeps
   * the two panes reading across each other row for row. False skips the whole
   * span rather than drawing an empty one: a bare `gap-[2px]` under a name
   * pushes it off the row's optical centre, which on a list of twelve is
   * visible as a wobble rather than as anything a reader could name.
   */
  line2?: boolean;
  /**
   * Below `lg`, set the figure **under** the name, right-aligned, with the face
   * a row cell beside both lines rather than a 17px mark on the first.
   *
   * For a one-line row whose name is somebody's own words — a standings team.
   * The phone arm otherwise puts face, name and figure on one ~150px line, and
   * a six-figure KTC total beside a face left a team name two characters and an
   * ellipsis. Stacked, the name has the column's whole width and the figure has
   * a line of its own. From `lg` up nothing changes: the row has room for all
   * three on one line and a figure column the pane opposite lines up with.
   */
  stacked?: boolean;
  /** The seat the pane opposite is solving: lit four ways. */
  selected?: boolean;
  /** Absent renders an `<li>`; present renders an `<li><button>`. */
  onPress?: () => void;
  /** Where the row stands — `drawer` is the bench and the options list. */
  ground?: "glass" | "drawer";
}) {
  // The palette first, so a seat anodised by who is sitting in it can never be
  // overridden by a caller's own mark — see `PaneWeekSeat.hue`.
  const positionHue = (seat.position && SLOT_METAL[seat.position]) ?? null;
  const hue = positionHue ?? seat.hue ?? null;
  const locked = seat.locked === true;

  // Three inks, because the hue arrives from two places and means two things.
  // A position is the palette and takes the palette's near-white engraving; a
  // caller's own hue is a *mark* — the reader's team — and takes the accent,
  // since anodising alone at this chroma is a fine distinction on a teal
  // console. No hue at all is the absence of a colour rather than a seventh
  // one, which is the chip's own rule.
  const bayInk = locked
    ? "var(--slot-locked-ink)"
    : positionHue
      ? METAL_INK
      : hue
        ? "var(--billet-accent)"
        : "var(--billet-label)";

  // A row with no game draws no run of game facts — see `opponent`.
  const game = opponent !== undefined || meta !== null || second !== null || locked;

  const surface = selected
    ? CONSOLE_TILE_LIT
    : ground === "drawer"
      ? CONSOLE_TILE_DRAWER
      : CONSOLE_TILE;

  // Two whole strings rather than a base plus an override, on this file's own
  // rule: the pressable arm adds a cursor, a focus ring and a transition, none
  // of which is a property the shape names, so there is nothing here for an
  // emit-order coin flip to decide.
  const shape =
    `${surface} relative mb-1 flex h-[52px] w-full items-center gap-1.5 rounded-[7px] ` +
    "pl-0 pr-[7px] lg:h-12 lg:gap-2.5 lg:pr-2.5";

  const figureNode = <PaneWeekValue figure={figure} />;

  const body = (
    <>
      <BilletFinish />

      {/* ── The bay ───────────────────────────────────────────────────────
          A hole milled the full height of the row's left edge, with a part
          seated in it. `self-stretch` is what makes it full height and
          `overflow-hidden` on the tile is what clips it to the radius, which is
          why the tile has no left padding for it to sit inside. */}
      <span
        style={hue ? ({ "--slot-hue": hue } as CSSProperties) : undefined}
        className={`relative flex w-7 shrink-0 flex-col items-center justify-center self-stretch overflow-hidden bg-[image:var(--billet-well-bg)] lg:w-12 ${
          selected
            ? "shadow-[var(--slot-bay-lit-shadow)]"
            : "shadow-[var(--slot-bay-shadow)]"
        }`}
      >
        {/* The insert, and the two finishes over it. The 1px dark ring is what
            makes it read as a part dropped into a hole rather than a panel
            painted on the floor, and it is at the call site rather than in
            `--slot-insert-shadow` because it is geometry the bay owns — the
            token is the part's own chamfer and cast. */}
        <span
          aria-hidden
          className="pointer-events-none absolute inset-[3px] rounded-[4px] shadow-[var(--slot-insert-shadow),inset_0_0_0_1px_rgba(0,0,0,0.3)] lg:inset-[4px] lg:rounded-[5px]"
          style={{
            backgroundImage: locked
              ? "var(--slot-locked-face)"
              : hue
                ? METAL_FACE
                : "var(--billet-bg)",
          }}
        />
        <span
          aria-hidden
          className="pointer-events-none absolute inset-[3px] rounded-[4px] bg-[image:var(--slot-brush)] lg:inset-[4px] lg:rounded-[5px]"
        />
        <span
          aria-hidden
          className="pointer-events-none absolute inset-[3px] rounded-[4px] bg-[image:linear-gradient(104deg,transparent_14%,rgba(255,255,255,0.17)_42%,transparent_62%)] lg:inset-[4px] lg:rounded-[5px]"
        />
        {locked && (
          <span
            aria-hidden
            className="pointer-events-none absolute inset-[3px] rounded-[4px] bg-[image:repeating-linear-gradient(135deg,rgba(0,0,0,0.3)_0_2px,transparent_2px_5px)] lg:inset-[4px] lg:rounded-[5px]"
          />
        )}

        {/* Two whole strings rather than a base plus an override, on this
            file's own rule: `tabular-nums` and `lg:tracking-[0.04em]` are two
            base utilities of the same specificity, and which won would be
            Tailwind's emit order rather than the caller's. */}
        <span
          className={`relative font-mono text-[length:var(--fs-9)] font-medium lg:text-[length:var(--fs-12)] ${
            seat.numeric ? "tabular-nums" : "lg:tracking-[0.04em]"
          }`}
          style={{ color: bayInk, textShadow: "var(--slot-engrave)" }}
        >
          {seat.label}
        </span>

        {seat.moveTo && (
          <>
            {/* CSS borders rather than a glyph: a 7×4 triangle at this size is
                a drawing, and `▾` is a font's idea of one. */}
            <span
              aria-hidden
              className="relative mt-px block size-0 border-x-[3px] border-t-[3.5px] border-x-transparent border-t-[color:var(--billet-accent)] lg:mt-0.5 lg:border-x-[3.5px] lg:border-t-4"
              style={{ filter: "drop-shadow(0 1px 0 rgba(0,0,0,0.55))" }}
            />
            <span className="relative font-mono text-[length:var(--fs-9)] font-medium text-[color:var(--billet-accent)] [text-shadow:0_1px_0_rgba(0,0,0,0.6),0_0_9px_var(--accent-glow)] lg:mt-px lg:text-[length:var(--fs-11)] lg:tracking-[0.04em]">
              {seat.moveTo}
            </span>
          </>
        )}

        {locked && <Padlock />}
      </span>

      {/* The face as a row cell, from `lg` up — and at every width on a
          stacked row, where it stands beside both lines. Two whole strings, so
          `hidden` and `flex` are never two base displays in one attribute. */}
      {face && (
        <PaneRowFaceMount
          face={face}
          className={
            stacked
              ? "flex size-[30px] text-[length:var(--fs-12)] lg:size-10 lg:text-[length:var(--fs-15)]"
              : "hidden size-10 text-[length:var(--fs-15)] lg:flex"
          }
        />
      )}

      <span
        className={`relative flex min-w-0 flex-1 ${
          line2
            ? "flex-col gap-[2px]"
            : stacked
              ? "flex-col gap-[3px] lg:flex-row lg:items-center"
              : "items-center"
        }`}
      >
        {/* ── Line one: who he is, and — below `lg` — what he projects ──── */}
        <span className="flex min-w-0 items-center gap-[5px] lg:gap-[7px]">
          {face && !stacked && (
            <PaneRowFaceMount
              face={face}
              className="flex size-[17px] text-[length:var(--fs-8)] lg:hidden"
            />
          )}
          <span
            className={`min-w-0 flex-1 truncate font-display text-[length:var(--fs-12)] font-medium [text-shadow:var(--billet-name-shadow)] lg:flex-initial lg:text-[length:var(--fs-15)] lg:tracking-[-0.005em] ${
              selected
                ? "text-[color:var(--billet-accent)]"
                : "text-[color:var(--billet-name)]"
            }`}
          >
            <span className="lg:hidden">{shortName}</span>
            <span className="hidden lg:inline">{name}</span>
          </span>
          {marks}
          {status && <StatusLamp status={status} />}
          {!stacked && <span className="shrink-0 lg:hidden">{figureNode}</span>}
        </span>

        {/* A stacked row's figure, on a line of its own under the name and
            right-aligned — below `lg` only; the row cell carries it above. */}
        {stacked && <span className="flex justify-end lg:hidden">{figureNode}</span>}

        {/* ── Line two: where and when the game is ────────────────────────
            One row of parts, each gated at the width it belongs to, rather
            than two lines one of which is hidden: what differs between the
            widths is which *facts* fit, not how they are drawn, and a second
            copy would be a second place for the wording to drift. */}
        {line2 && (
          <span
            className={`flex min-w-0 items-baseline gap-1 font-mono text-[length:var(--fs-9)] uppercase tracking-[0.02em] lg:items-center lg:gap-[7px] lg:text-[length:var(--fs-10)] lg:tracking-[0.08em] ${
              locked
                ? "text-[color:var(--billet-scope)] lg:text-[color:var(--billet-label)]"
                : "text-[color:var(--billet-label)]"
            }`}
          >
            {/* The position and the team. **Dropped below `lg` where the row
                has a game**, and the bay is why: it is already printing the
                seat, and on a ~150px line the game is the reading the row does
                not otherwise carry. Where there is no game it is the whole of
                the line, so dropping it would leave the line empty — which is
                the manager card's four lists. */}
            <span className={game ? "hidden shrink-0 lg:inline" : "min-w-0 truncate"}>
              {`${seat.position ?? "—"} · ${note ?? "—"}`}
            </span>
            {game && (
              <>
                <span
                  aria-hidden
                  className="hidden h-[11px] w-px shrink-0 bg-[image:var(--groove)] lg:block"
                />
                <span className="shrink-0 lg:text-[color:var(--billet-unit)]">
                  {opponent ?? "—"}
                </span>
                {/* A locked row drops its clock below `lg`: the padlock in the
                    bay and the word at the end of this line are already saying
                    the clock has run out, and the ~150px line has better uses
                    for it. */}
                {meta && (
                  <span className={locked ? "hidden min-w-0 truncate lg:block" : "min-w-0 flex-1 truncate lg:flex-initial"}>
                    <span aria-hidden className="lg:hidden">
                      {"· "}
                    </span>
                    {meta}
                  </span>
                )}
                {locked && (
                  <span className="ml-auto shrink-0 whitespace-nowrap text-[color:var(--billet-scope)] lg:ml-0">
                    <span className="sr-only">Locked — his game has kicked off</span>
                    <span aria-hidden>
                      <span className="hidden lg:inline">{"· "}</span>locked
                    </span>
                  </span>
                )}
                {second !== null && (
                  <span className="ml-auto shrink-0 whitespace-nowrap tabular-nums text-[color:var(--billet-unit)]">
                    {second}
                  </span>
                )}
              </>
            )}
          </span>
        )}
      </span>

      {/* The figure as a row cell, from `lg` up. */}
      <span className="relative hidden w-[70px] shrink-0 justify-end lg:flex">
        {figureNode}
      </span>

      {selected && (
        // A rail down the row's **right** edge, pointing at the pane that is
        // answering this seat — which is the one of the four lit cues that says
        // *which way to look*. `--lit-bar-bg` rather than a second mint, so it
        // is the same stock the history rail and the drawer's own lit bar are
        // drawn from.
        <span
          aria-hidden
          className="pointer-events-none absolute inset-y-1 right-0 w-[3px] rounded-l-[2px] bg-[image:var(--lit-bar-bg)] shadow-[0_0_11px_var(--accent-glow)] lg:inset-y-[5px]"
        />
      )}
    </>
  );

  // The hover halo is spelled whole, per ground — a shadow list is atomic, so a
  // `hover:shadow-[…]` naming only the glow would replace the tile's chamfer
  // rather than add to it.
  const hover = selected
    ? ""
    : ground === "drawer"
      ? "hover:shadow-[var(--tile-drawer-shadow),0_0_14px_-6px_var(--accent-glow)]"
      : "hover:shadow-[var(--tile-shadow),0_0_14px_-6px_var(--accent-glow)]";

  if (!onPress) return <li className={shape}>{body}</li>;

  return (
    <li>
      <button
        type="button"
        onClick={onPress}
        aria-pressed={selected}
        className={`${shape} cursor-pointer text-left transition-[box-shadow,background-image] duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-active/60 ${hover}`}
      >
        {body}
      </button>
    </li>
  );
}

/**
 * The padlock under a locked seat's label — the third of that state's three
 * cues, after the graphite insert and the hatch over it.
 *
 * Two elements at a 16 viewBox, drawn in `--slot-lock-ink` over a hard dark
 * step, which is the same engraving the label above it takes. It is
 * `aria-hidden`: the row's second line already carries an `sr-only` sentence,
 * and a padlock announced as nothing is not a reading.
 */
function Padlock() {
  return (
    <svg
      aria-hidden
      focusable="false"
      viewBox="0 0 16 16"
      className="relative mt-px size-[11px] lg:mt-0.5 lg:size-[13px]"
      style={{ filter: "drop-shadow(0 1px 0 rgba(0,0,0,0.6))" }}
    >
      <path
        d="M5.6 7.4V5.3a2.4 2.4 0 0 1 4.8 0v2.1"
        fill="none"
        stroke="var(--slot-lock-ink)"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <rect x="3.6" y="7.1" width="8.8" height="6.3" rx="1.5" fill="var(--slot-lock-ink)" />
    </svg>
  );
}

/**
 * The week row's hero figure, struck into the part's face at `--fs-21`.
 *
 * **It is the only place the comparison lives**, now that the two-track gap
 * meter is gone: the ramp's two ends ink it, which is not two verdicts on one
 * row but the one verdict moved off a 98px column and onto the number it was
 * about. `--standing-engrave` is the strip's own stack, so the figure gains
 * weight without gaining a second hue.
 *
 * `live` is gametime's own reading and deliberately not on the ramp: a live
 * projection has nothing on that card to be a standing *against*, so what the
 * accent says is that the game is **running**.
 */
function PaneWeekValue({ figure }: { figure: PaneWeekFigure }) {
  const tone =
    figure.live || figure.percentile == null ? null : rankColor(figure.percentile);

  return (
    <span
      className={`relative text-right font-mono text-[length:var(--fs-13)] font-medium leading-none tabular-nums lg:text-[length:var(--fs-21)] ${
        figure.live
          ? "text-[color:var(--readout-text)] [text-shadow:var(--readout-text-glow)]"
          : tone
            ? ""
            : "text-[color:var(--billet-figure)] [text-shadow:var(--standing-engrave)]"
      }`}
      style={
        tone
          ? {
              color: tone,
              textShadow: `var(--standing-engrave), 0 0 16px ${rankColor(figure.percentile ?? null, 0.5)}`,
            }
          : undefined
      }
    >
      {figure.text}
    </span>
  );
}
