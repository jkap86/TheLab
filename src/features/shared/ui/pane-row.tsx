import type { CSSProperties, ReactNode } from "react";

import { CONSOLE_TILE, CONSOLE_TILE_DRAWER, CONSOLE_TILE_SELECTED } from "../console-chrome";
import { rankColor } from "../rank-ramp";
import { BilletFinish } from "./card-plate";

/**
 * One row of an expanded league card's pane, in every tool: a **tile**
 * carrying a lead cell, a face, a name, and up to four readings.
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
        {face && <PaneRowFaceMount face={face} />}
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
function PaneRowFaceMount({ face }: { face: PaneRowFace }) {
  const initial = face.name.trim().charAt(0).toUpperCase();

  return (
    <span
      aria-hidden
      className="relative flex size-5 shrink-0 items-center justify-center overflow-hidden rounded-full bg-[image:var(--billet-well-bg)] font-display text-[length:var(--fs-9)] font-semibold text-[color:var(--tile-face-ink)] shadow-[var(--standing-well-shadow)] lg:order-2 lg:size-[22px] lg:text-[length:var(--fs-9-6)]"
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
