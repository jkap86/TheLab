"use client";

import { useRef, useState } from "react";

import type {
  LineupColumn,
  LineupSlot,
  ManagerLineupsPayload,
} from "@/shared/contract";
import { lineupColumnKey } from "@/shared/ktc/columns";

// Relative rather than through this folder's own barrel — the rule
// `lineup-columns-dialog.tsx` beside it already lives by.
import {
  COLUMN_VALUE_LABELS,
  LINEUP_METRIC_LABELS,
  metricAxes,
} from "../lineup-columns";
import { ColumnAxes, ColumnPanel, columnSetting } from "./column-panel";

/**
 * The standings pane's own column, as a key on its ledge and a modal picker.
 *
 * **It replaces a `Sort by` menu, and that is the whole change of question.**
 * That menu offered the ten `LineupMetricId`s and did one thing: order the
 * twelve rows. Every other surface on this page had long since stopped thinking
 * in metric ids — the card's four bays are *columns*, composed from a value, a
 * scope, a market, a QB board, a seat set and a position set — so the one place
 * a reader could not ask "how do these teams compare on my flex seats, priced
 * on the dynasty board" was the table of teams. Now they can, on the same six
 * axes and in the same panel, and the pane prints the answer as its own column.
 *
 * **One column, so there is no rack and no bay number.** The four-bay panel's
 * chip says which of four sockets is being edited and its readout counts them;
 * here the chip names the *pane* the column belongs to (`Teams`) and the
 * readout is the one thing that does move — {@link columnSetting}, what the
 * column is set to. A budget nobody has is not worth stating.
 *
 * **The case and the axes are `column-panel`'s**, which is what stops this being
 * a copy of a panel holding six switch tracks: a switch that stopped travelling
 * in one of two spellings is a panel nobody can see is broken, which is the rule
 * `SwitchTrack` itself exists for. What is this file's own is the trigger, the
 * draft, and what seating means with one column — see below.
 *
 * **Closing seats, and there is no `Save` key.** That is the four-bay panel's
 * change and this panel inherits the reason as well as the case: `Save` was the
 * smallest key on a panel whose largest is `Done`, so a reader could change a
 * column, press `Done` and lose it with nothing on screen saying so. With one
 * column there is no bay to leave, so `Done`, Esc and a backdrop click are the
 * three exits — all of them the dialog's own `close`, which is why one handler
 * covers them.
 *
 * **The trigger is here rather than the caller's**, unlike
 * `LineupFiltersDialog`'s `triggerClassName`: this key is not a pill in a row of
 * pills but a two-part readout — the seated column and an `EDIT` legend — whose
 * left half is *the picker's own state*. A caller passing a class string could
 * not render it, and a caller rendering it would be a second spelling of the
 * label rule below.
 */
export function TeamsColumnDialog({
  column: seated,
  onChange,
  ktc,
  slots = [],
}: {
  /** The seated column — read on mount from the device, per `useTeamsColumn`. */
  column: LineupColumn;
  /** Seat a composed column: the caller stores it and re-reads the pane. */
  onChange: (column: LineupColumn) => void;
  /** Which markets answered and when each was scraped; empty when none could. */
  ktc: ManagerLineupsPayload["ktc"];
  /**
   * The starting seats this account's leagues actually run — see
   * {@link ColumnAxes.slots}, whose note this is.
   */
  slots?: readonly LineupSlot[];
}) {
  const ref = useRef<HTMLDialogElement>(null);

  /**
   * The edit in progress, or null where there is none.
   *
   * **A press writes this and closing writes the store**, which is the four-bay
   * panel's rule and it matters more here, not less: this column *is* the
   * standings' sort, so every intermediate column on the way from
   * `Proj · Starters` to `KTC · Picks` would re-order a twelve-team table
   * behind the open dialog. Held, the table is still until there is something
   * to seat.
   *
   * Null rather than seeded from the seated column, so `dirty` is a comparison
   * rather than a flag something has to remember to clear, and so that
   * abandoning is one `setDraft(null)`.
   */
  const [draft, setDraft] = useState<LineupColumn | null>(null);

  /** What the tracks and the housing read: the edit in hand, else what is seated. */
  const col = draft ?? seated;
  const dirty = lineupColumnKey(col) !== lineupColumnKey(seated);

  /**
   * Seat the draft — on every way out, which is all three of this panel's.
   *
   * **A plain write, and that is the one behaviour this panel does not share
   * with the four-bay one.** There, a column another bay already holds is
   * resolved by *exchange* — the two swap, so the rack still holds four
   * distinct readings — and a bay is a fourth way out. With one column there is
   * nothing to collide with, nothing to trade places and no bay to leave, so
   * this is: seat it, store it, drop the draft. Which is also why the panel
   * carries no `warning`: there is no second column for the foot to name.
   *
   * The draft is dropped whether or not there was anything to seat, on the
   * four-bay panel's own reason one grain smaller: a press can compose back to
   * the column already seated, and a draft left in hand through a close would
   * be read by the next open before {@link open} cleared it.
   */
  const save = () => {
    if (dirty) onChange(col);
    setDraft(null);
  };

  /**
   * Open on what is seated.
   *
   * Belt and braces rather than a rule of its own now: closing seats and drops,
   * so there is no draft left for this to clear. It is kept because the cost is
   * a `setState` on a press that is already re-rendering, and what it guards
   * against — a panel opening onto a column nobody seated — is silent.
   */
  const open = () => {
    setDraft(null);
    ref.current?.showModal();
  };

  const words = LINEUP_METRIC_LABELS[col.metric];
  const seatedWords = LINEUP_METRIC_LABELS[seated.metric];

  return (
    <>
      <button
        type="button"
        onClick={open}
        aria-haspopup="dialog"
        // The key travels in the ledge's recess, which is the caller's — see
        // the component note on why the key itself is not.
        //
        // **Above `lg` it is 24px and 190px wide, sized to the row rather than
        // to what is left of it.** The ledge folded into one line there, so the
        // key shares its row with the pane's name and the unit head and a
        // `flex-1` key would take the name's width with it. The basis is 190 and
        // not 168: at 168 `ROS starters` clips, and the seated column is the one
        // reading this key exists to show — it shrinks (`0 1 190px`) on a card
        // too narrow to hold it, which is a truncation the accessible name below
        // does not share.
        className="lab-anim flex min-w-0 flex-1 items-center justify-between gap-2 rounded-full border border-active/45 bg-[image:var(--key-bg)] py-[5px] pl-[9px] pr-[7px] font-mono text-[length:var(--fs-10)] uppercase tracking-[0.1em] text-readout shadow-[var(--key-shadow)] [text-shadow:var(--readout-text-glow)] transition-[color,box-shadow] duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-active/60 lg:h-6 lg:flex-[0_1_190px] lg:py-0 lg:pl-[11px] lg:pr-[9px] lg:text-[length:var(--fs-11)] lg:tracking-[0.12em]"
      >
        {/* **Two names for one column, switched by the cascade.** At `lg` the
            key reads the metric's own name (`ROS starters`); below it, where the
            pane is ~165px and the key inside it perhaps 110, that name clips —
            so what is printed is the *value* axis the panel's first track sets
            (`Proj`), which is the same word one grain coarser and cannot. It is
            the rule `BayKey`'s two lines already live by, and the full name is
            in the accessible name at every width.

            Never state, because a client component must not have to hydrate to
            learn a breakpoint. */}
        <span className="min-w-0 truncate">
          <span className="lg:hidden">
            {COLUMN_VALUE_LABELS[metricAxes(seated.metric).value]}
          </span>
          <span className="hidden lg:inline">{seatedWords.column}</span>
        </span>
        {/* The legend, in the accent and *without* the readout's glow: it names
            what the key does rather than reporting a value, and a lit gloss on
            it would put two readings in one window. */}
        <span
          aria-hidden
          className="shrink-0 text-[length:var(--fs-8-5)] tracking-[0.16em] text-active [text-shadow:none]"
        >
          EDIT
        </span>
        <span className="sr-only">
          Edit the teams column — {seatedWords.column}
        </span>
      </button>

      <ColumnPanel
        dialogRef={ref}
        label="Teams column"
        title="Teams column"
        // **The setting, where the four-bay panel prints `Bay 01 / 04`.** There
        // is no bay count to state, and what does move under a press is what
        // the column is set to. An un-narrowed column on each league's own
        // board has no setting to print, so the reading falls back to the
        // metric's unit — a live window drawn empty reads as a broken one.
        reading={columnSetting(col) || words.unit}
        copy="What the standings read, and what they are ordered by."
        wideCopy="Closing seats it."
        ktc={ktc}
        // `Done`, Esc and the backdrop all reach `close` — see {@link save}.
        onClose={save}
      >
        <ColumnAxes
          // The chip names the state, since with `Save` gone the housing has
          // one lit reading left and a draft in hand is what is worth spending
          // it on. `Teams` is the pane rather than a bay number, so what it
          // gains is the same word the four-bay panel's chip does.
          chip={dirty ? "Teams · Edit" : "Teams"}
          column={col}
          slots={slots}
          dirty={dirty}
          onChange={setDraft}
        />
      </ColumnPanel>
    </>
  );
}
