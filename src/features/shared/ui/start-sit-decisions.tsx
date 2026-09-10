"use client";

import type { DecisionGroup, DecisionRow } from "../start-sit-decisions";
import { slotLabel } from "../format";
import { CONSOLE_KEY_PILL, CONSOLE_WINDOW } from "../console-chrome";
import { Scanlines } from "./card-plate";

/**
 * The start/sit decisions view: who a player was started over, and who he was
 * sat behind, one card per counterpart.
 *
 * It stands in the shares drawer's own two surfaces rather than opening a
 * dialog of its own — `SharesDrawer`'s `detail` slot — so the panel a reader
 * pressed a row in is still the panel they are looking at, still counting the
 * same population, with its title band untouched above them.
 *
 * **A counterpart is the heading and a league is a row under it**, which is the
 * grouping `decisionsFor` argues for: one counterpart is one decision made in
 * however many lineups, and grouping by league would split the same pairing
 * across a dozen headings.
 *
 * **The three-way grammar both week tools are written in holds here.** A delta
 * is a number where both players have a figure, an em dash where either does
 * not, and lit in the error tone only where the lineup left points behind —
 * never a zero standing in for an absent answer.
 *
 * **`figureLabel` is the caller's, and that is the whole of what differs between
 * the two tools that mount this.** The lineup checker judges a call on a
 * projection and gametime on the live one, so the window over a counterpart's
 * number reads `Proj` on one page and `Live` on the other — three characters,
 * and the only thing on screen that says which of two scales a reader is
 * looking at. `decisionsFor` deliberately does not name it: a delta there is one
 * figure less another, and the word for it belongs where the figure was chosen.
 *
 * The slot labels are `slotLabel`'s, not a table of their own. This file kept a
 * byte-identical copy of that record until it moved here, which is one more
 * chance for `SUPER_FLEX` to read `SF` on a seat chip and `SUPER_FLEX` on the
 * route pill beside it.
 */

/** `RB2` where the league starts two, `TE` where it starts one. */
function seatLabel(row: DecisionRow): string {
  return `${slotLabel(row.seat)}${row.seat_index ?? ""}`;
}

/**
 * The deck that replaces the search and sort bands while a player is open.
 *
 * The Back key first, because it is the way out and a reader who pressed a row
 * by accident should not have to find it. The projection is a window rather
 * than plain text for the reason every figure on this console is: it is a
 * reading, and a reading sits in glass.
 */
export function DecisionsDeck({
  name,
  position,
  team,
  figure,
  figureLabel,
  line,
  onBack,
}: {
  name: string;
  position: string | null;
  team: string | null;
  /** Null where the leagues on screen do not agree — see `WeekPlayerShare.figure`. */
  figure: number | null;
  /** What the figure is, in three characters — `Proj`, `Live`. */
  figureLabel: string;
  /** What this view is currently showing, in words. */
  line: string;
  onBack: () => void;
}) {
  const note = [position, team].filter(Boolean).join(" · ");

  return (
    <>
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-2">
        <button
          type="button"
          onClick={onBack}
          className={`${CONSOLE_KEY_PILL} inline-flex shrink-0 items-center gap-1.5 border-foreground/12 bg-[image:var(--key-bg)] px-3 py-[5px] text-[length:var(--fs-10)] text-foreground/80 shadow-[var(--key-shadow)] hover:text-readout`}
        >
          <span aria-hidden>◀</span> Back
        </button>

        <span className="min-w-0 flex-1">
          <span className="block truncate text-[length:var(--fs-14)] font-semibold tracking-[-0.005em] text-foreground/95">
            {name}
          </span>
          {note && (
            <span className="block truncate font-mono text-[length:var(--fs-9)] uppercase tracking-[0.16em] text-foreground/46">
              {note}
            </span>
          )}
        </span>

        <span
          className={`${CONSOLE_WINDOW} inline-flex shrink-0 items-baseline gap-1.5 rounded-lg px-2.5 py-[0.3125rem]`}
        >
          <Scanlines />
          <span className="relative font-mono text-[length:var(--fs-9)] uppercase tracking-[0.14em] text-readout-label">
            {figureLabel}
          </span>
          <span className="relative font-mono text-[length:var(--fs-13)] tabular-nums text-readout [text-shadow:var(--readout-text-glow)]">
            {figure === null ? "—" : figure.toFixed(1)}
          </span>
        </span>
      </div>

      {/* The population line: what the view is showing, and the one thing that
          changes when a counterpart is picked. Full width so it never competes
          with the key or the readout for the row above. */}
      <p className="m-0 truncate font-mono text-[length:var(--fs-9)] uppercase tracking-[0.14em] text-readout-label">
        {line}
      </p>
    </>
  );
}

/** The tray: one card per counterpart, or a word where there are none. */
export function DecisionsList({
  groups,
  picked,
  figureLabel,
  onPick,
}: {
  groups: readonly DecisionGroup[];
  /** The counterpart the view is narrowed to, or null for all of them. */
  picked: string | null;
  /** What every figure in the list is — see the module note. */
  figureLabel: string;
  onPick: (playerId: string) => void;
}) {
  if (groups.length === 0) {
    return (
      <p className="m-0 py-6 pl-2 font-mono text-[length:var(--fs-13)] text-foreground/60">
        No start-or-sit call this week — nobody on these rosters could have
        taken his seat.
      </p>
    );
  }

  return (
    <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
      {groups.map((group) => (
        <CounterpartCard
          key={group.player_id}
          group={group}
          picked={picked === group.player_id}
          figureLabel={figureLabel}
          onPick={() => onPick(group.player_id)}
        />
      ))}
    </ul>
  );
}

/**
 * One counterpart, as a key that can be held down.
 *
 * Pressed and lit is the same state the shares row wears and means the same
 * thing: the view is narrowed to this pairing, and pressing again puts every
 * counterpart back. Flat, on the drawer's own budget — no perspective, no
 * `translateZ`, one composited layer at a time.
 */
function CounterpartCard({
  group,
  picked,
  figureLabel,
  onPick,
}: {
  group: DecisionGroup;
  picked: boolean;
  figureLabel: string;
  onPick: () => void;
}) {
  // **The position is on the badge two millimetres to the left**, so it is not
  // repeated here — the same fact twice on one row is one of them too many, the
  // call the leaguemates drawer made when its record became a column.
  const caption = [
    group.team,
    group.starts > 0 ? `Started over in ${group.starts}` : null,
    group.sits > 0 ? `Sat behind in ${group.sits}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <li
      className={
        "rounded-xl border bg-[image:var(--key-bg)] px-[0.6875rem] pb-1.5 pt-2 transition-[box-shadow,border-color] duration-200 " +
        (picked
          ? "border-active/50 shadow-[var(--key-shadow-pressed),inset_0_0_22px_color-mix(in_srgb,var(--accent)_14%,transparent),0_0_24px_-10px_var(--accent-glow)]"
          : "border-foreground/9 shadow-[var(--key-shadow)]")
      }
    >
      <button
        type="button"
        onClick={onPick}
        aria-pressed={picked}
        className="flex w-full min-w-0 items-center gap-2 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-active/60"
      >
        <span
          aria-hidden
          className={`inline-flex size-6 shrink-0 items-center justify-center rounded-[0.3125rem] border border-foreground/12 bg-[image:var(--bezel-bg)] font-mono text-[length:var(--fs-8)] uppercase tracking-[0.06em] shadow-[var(--bezel-shadow)] ${
            picked ? "text-readout" : "text-foreground/68"
          }`}
        >
          {group.position ?? "—"}
        </span>

        <span className="min-w-0 flex-1">
          <span
            className={`block truncate text-[length:var(--fs-13)] tracking-[-0.005em] ${
              picked ? "font-semibold text-readout" : "text-foreground/85"
            }`}
          >
            {group.name}
          </span>
          {/* It wraps rather than truncates: the two counts are what the card
              is read for, and at 390 a truncated caption cuts them off exactly
              where they start. One line at every width the panel is wide
              enough for. */}
          <span className="block font-mono text-[length:var(--fs-9)] uppercase tracking-[0.14em] text-foreground/46">
            {caption}
          </span>
        </span>

        <span
          className={`${CONSOLE_WINDOW} inline-flex shrink-0 items-baseline gap-1 rounded-[0.4375rem] px-2 py-1`}
        >
          <Scanlines />
          <span className="relative font-mono text-[length:var(--fs-8)] uppercase tracking-[0.14em] text-readout-label">
            {figureLabel}
          </span>
          <span className="relative font-mono text-[length:var(--fs-11)] tabular-nums text-readout [text-shadow:var(--readout-text-glow)]">
            {group.figure === null ? "—" : group.figure.toFixed(1)}
          </span>
        </span>
      </button>

      <ul className="m-0 mt-1.5 flex list-none flex-col p-0">
        {group.rows.map((row) => (
          <LeagueRow key={row.league_id} row={row} />
        ))}
      </ul>
    </li>
  );
}

/** One league's call: where, which way, through what, and what it was worth. */
function LeagueRow({ row }: { row: DecisionRow }) {
  return (
    // **Below `@md` the row wraps and the league name takes the line above**,
    // which a render at 390 forced rather than the handoff asking for it: the
    // chip, the seat, the route and the delta are ~240px of a 284px row, which
    // leaves the name 44px against the 122px it wants — every league read as
    // six characters and an ellipsis. It is the same answer `ShareRow` gives
    // one panel up, and the height is a floor rather than a fixed 30px so a
    // wrapped row can be two lines without its own contents overflowing it.
    <li className="flex min-h-[30px] min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 border-t border-active/9 py-1 @md:flex-nowrap @md:py-0">
      <span className="min-w-0 flex-1 basis-full truncate font-mono text-[length:var(--fs-10)] uppercase tracking-[0.12em] text-readout-line @md:basis-auto">
        {row.league_name}
      </span>

      {/* The `Tag` grammar from `league-config-window.tsx`: the lit tag is the
          statement, the unlit one its opposite. `Started` is lit because it is
          the call the lineup actually made for this player. */}
      <span
        className={`shrink-0 rounded-[0.3125rem] border px-[0.4375rem] py-0.5 font-mono text-[length:var(--fs-9)] uppercase tracking-[0.14em] ${
          row.started
            ? "border-active/40 text-readout shadow-[inset_0_0_12px_var(--accent-glow)] [text-shadow:var(--readout-text-glow)]"
            : "border-active/22 text-readout-muted"
        }`}
      >
        {row.started ? "Started" : "Benched"}
      </span>

      <span className="w-8 shrink-0 text-right font-mono text-[length:var(--fs-9)] uppercase tracking-[0.12em] text-readout-label">
        {seatLabel(row)}
      </span>

      <span
        className={`shrink-0 rounded-full border px-[0.4375rem] py-0.5 font-mono text-[length:var(--fs-9)] uppercase tracking-[0.12em] ${
          row.route.direct
            ? "border-active/40 text-active"
            : "border-foreground/16 text-foreground/55"
        }`}
      >
        {row.route.direct ? "Direct" : `Via ${slotLabel(row.route.via)}`}
      </span>

      {/* **Lit only where the lineup left points behind.** A positive delta is
          the call going the reader's way, and colouring it too would make the
          column a decoration rather than a warning. An absent delta is an em
          dash and never a zero — see `DecisionRow.delta`. It carries no unit,
          because the two figures it is a difference of are labelled by the
          windows above it. */}
      <span
        className={`ml-auto w-[3.25rem] shrink-0 text-right font-mono text-[length:var(--fs-11)] tabular-nums ${
          row.lost
            ? "text-error [text-shadow:0_0_10px_rgba(252,165,165,0.45)]"
            : "text-readout-muted"
        }`}
      >
        {row.delta === null
          ? "—"
          : `${row.delta >= 0 ? "+" : "−"}${Math.abs(row.delta).toFixed(1)}`}
      </span>
    </li>
  );
}
