"use client";

import { compactSelect } from "@/features/shared/control-type";

import { compsFieldTakesWindow } from "../../../shared/comps/fields";
import {
  COMPS_WINDOWS,
  DEFAULT_COMPS_WINDOW,
} from "../../../shared/comps/windows";
import {
  ADDED_TIER,
  LADDER_TIERS,
  benchFields,
  boardLoad,
  ladderRows,
  weightForTier,
} from "../ladder";

import type { CompsField, CompsPosition } from "../../../shared/comps/fields";
import type { CompsWindowKey } from "../../../shared/comps/windows";
import type { LadderRow } from "../ladder";

/**
 * The comparison board as a ranked ladder: the fields that are *in*, heaviest
 * first, each at one of five notches and over a window of seasons, with the
 * rest of the catalogue in a bin underneath.
 *
 * It replaced a bench of twenty-nine sliders, and the argument is in
 * `ladder.ts` — the short version is that the bench asked a question (85 or
 * 80?) nobody has an opinion about, and drew twenty-two rows to say "off" while
 * doing it. What is left here is the board itself, which is the thing the
 * reader tuned and the only thing worth reading.
 *
 * Three decisions are this file's rather than the model's:
 *
 * - **The notches are real radios**, one group per row, so the keyboard walks
 *   them and the arrow keys mean what they look like they mean. They are the
 *   one control here at 12px rather than the iOS floor's 16, and legitimately:
 *   a radio takes no typed text, which is the exemption `control-type.ts`
 *   names.
 * - **The window is a select on the row, and that is affordable now.** It was
 *   drawn twenty times on the bench to say "This season" nineteen of them;
 *   on the ladder there are as many of them as there are fields in the
 *   comparison, which is about seven — the same control at a third of the
 *   count, so the seat needed no cleverness once the rows went away.
 * - **The bin keeps the family bays**, because what weighting a market value
 *   or a gated rate *costs* is a fact about the family and has to be readable
 *   at the moment somebody is choosing to add one.
 */

const FAMILY_LABELS = {
  production: "Production",
  profile: "Profile",
  market: "Market values",
} as const;

const FAMILIES = ["production", "profile", "market"] as const;

const FAMILY_NOTES = {
  production:
    "Air yards, snaps and the usage rates only exist where the stat feed supplies them — adding one narrows the comparison to seasons that can answer it. So does a window: a season with no career behind it can't answer one.",
  profile:
    "Career and recent form read stored prior seasons — adding one removes first-year seasons, which have no prior form to measure.",
  market:
    "A market value removes players it doesn't price from the comparison — unpriced seasons can't be measured against it.",
} as const;

export function FieldEditor({
  position,
  weights,
  windows,
  customized,
  onWeight,
  onWindow,
  onReset,
}: {
  position: CompsPosition;
  weights: Record<string, number>;
  windows: Record<string, CompsWindowKey>;
  customized: boolean;
  onWeight: (key: string, weight: number) => void;
  onWindow: (key: string, window: CompsWindowKey) => void;
  onReset: () => void;
}) {
  const rows = ladderRows(weights);
  const load = boardLoad(weights);
  const bin = benchFields(weights);
  const windowed = rows.filter(
    (row) => (windows[row.field.key] ?? DEFAULT_COMPS_WINDOW) !== DEFAULT_COMPS_WINDOW,
  ).length;

  return (
    // The overhang is padding on the wrapper, never a negative margin, so the
    // nameplate straddling the plate's top edge still sits inside the box the
    // page lays out — the trade card's rule for a part rising out of an edge.
    <div className="relative pt-3 @container">
      <h2 className="lab-nameplate absolute left-4 top-0 z-10 rounded-md px-3 py-1 font-display text-[10px] uppercase tracking-[0.2em] text-foreground">
        Comparison weights
      </h2>

      <section className="lab-plate rounded-2xl px-3 pb-3 pt-5 @2xl:px-4 @2xl:pb-4">
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <Bezel
            gauges={[
              { value: String(rows.length), caption: "fields" },
              { value: String(load), caption: "load" },
              { value: String(windowed), caption: "windows" },
              { value: position, caption: "board" },
            ]}
          />
          <button
            type="button"
            onClick={onReset}
            disabled={!customized}
            className={`lab-chip lab-chip-sm ml-auto rounded-full px-3 py-1 font-display text-[10px] uppercase tracking-[0.15em] ${
              customized ? "text-foreground/80" : "text-foreground/25"
            }`}
          >
            Reset {position}
          </button>
        </div>

        <MixStrip rows={rows} />

        <div className="lab-trough mt-3 rounded-xl px-2.5 pb-2.5 pt-2 @2xl:px-3">
          <h3 className="lab-engraved-faint mb-2 px-1 font-display text-[10px] uppercase tracking-[0.18em] text-foreground/45">
            The comparison · heaviest first
          </h3>
          {rows.length === 0 ? (
            <p className="px-1 pb-1 text-xs text-foreground/45">
              Nothing is being compared. Add a field below, or reset to the{" "}
              {position} board.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {rows.map((row) => (
                <LadderRowItem
                  key={row.field.key}
                  row={row}
                  window={windows[row.field.key] ?? DEFAULT_COMPS_WINDOW}
                  onWeight={onWeight}
                  onWindow={onWindow}
                />
              ))}
            </ul>
          )}
        </div>

        <Bin fields={bin} onAdd={(key) => onWeight(key, weightForTier(ADDED_TIER))} />
      </section>
    </div>
  );
}

/**
 * The gauge run: the board's own numbers, in the trade card's bezel. Four facts
 * that are otherwise only inferable by reading the ladder — how many fields are
 * in, how hard the board pulls in total, how many are read over something other
 * than this season, and which position's board this is.
 */
function Bezel({
  gauges,
}: {
  gauges: readonly { value: string; caption: string }[];
}) {
  return (
    <div className="lab-bezel inline-flex flex-wrap items-stretch gap-1 rounded-lg p-1">
      {gauges.map((gauge) => (
        <span
          key={gauge.caption}
          className="lab-gauge flex min-w-[3.25rem] flex-col items-center rounded px-2 py-1"
        >
          <span className="font-display text-xs tabular-nums text-foreground/85">
            {gauge.value}
          </span>
          <span className="text-[8px] uppercase tracking-[0.16em] text-foreground/35">
            {gauge.caption}
          </span>
        </span>
      ))}
    </div>
  );
}

/**
 * The mix: each field's share of the whole, as lit bars standing in a cut. The
 * ladder states the same shares as numbers, so this is the shape of the board
 * rather than its data — which is what a reader checks before reading a single
 * row. Aria-hidden: every number in it is on the rows below.
 */
function MixStrip({ rows }: { rows: readonly LadderRow[] }) {
  return (
    <div className="lab-channel flex h-3 gap-px overflow-hidden rounded p-[2px]" aria-hidden>
      {rows.map((row) => (
        <span
          key={row.field.key}
          className="lab-channel-bar-lit rounded-[1px]"
          style={{ width: `${row.share * 100}%` }}
        />
      ))}
    </div>
  );
}

/**
 * One field in the comparison: what it is, over which seasons, at which notch,
 * and what share of the distance that comes to.
 *
 * The DOM order is the reading order and also what makes the row degrade well:
 * at a phone width the window and the remove key take the second line, leaving
 * the name, the notches and the share — the row's own sentence — on the first.
 */
function LadderRowItem({
  row,
  window,
  onWeight,
  onWindow,
}: {
  row: LadderRow;
  window: CompsWindowKey;
  onWeight: (key: string, weight: number) => void;
  onWindow: (key: string, window: CompsWindowKey) => void;
}) {
  const { field, tier, share } = row;
  return (
    <li className="lab-plate-sm flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg px-2.5 py-1.5">
      <span className="min-w-0 flex-1 basis-24 truncate text-xs text-foreground/85" title={field.label}>
        {field.label}
      </span>

      <Notches field={field} tier={tier} onWeight={onWeight} />

      <span className="w-9 shrink-0 text-right font-display text-[10px] tabular-nums text-foreground/45">
        {Math.round(share * 100)}%
      </span>

      {compsFieldTakesWindow(field) ? (
        <WindowSelect field={field} window={window} onWindow={onWindow} />
      ) : (
        // A field with no window still reserves its track, or the notches and
        // the share on an age row slide out of the columns every other row
        // holds them in — and the columns *are* the ladder's reading. Only
        // from `@lg`, which is where the row stops wrapping: below it the
        // window is on a line of its own and there is no column to hold.
        <span aria-hidden className="hidden w-[8.5rem] shrink-0 @lg:block" />
      )}

      <button
        type="button"
        onClick={() => onWeight(field.key, 0)}
        aria-label={`Remove ${field.label} from the comparison`}
        title="Remove from the comparison"
        className="shrink-0 rounded px-1 text-xs leading-none text-foreground/30 transition-colors hover:text-foreground/80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-active"
      >
        ✕
      </button>
    </li>
  );
}

/**
 * The weight, as five notches standing in a milled cut.
 *
 * Real radios under the bars, which is what buys the keyboard: a group is one
 * tab stop and the arrows walk the notches, which is exactly what the control
 * looks like it should do. **A press sets a tier and never steps one** — one
 * press is one decision and therefore one re-sort of the ladder, where stepping
 * would move the row under a finger trying to hold still.
 */
function Notches({
  field,
  tier,
  onWeight,
}: {
  field: CompsField;
  tier: number;
  onWeight: (key: string, weight: number) => void;
}) {
  return (
    <span
      role="radiogroup"
      aria-label={`${field.label} weight`}
      className="lab-channel flex shrink-0 gap-[2px] rounded p-[2px]"
    >
      {Array.from({ length: LADDER_TIERS }, (_, i) => i + 1).map((notch) => (
        <label
          key={notch}
          className="cursor-pointer"
          title={`Weight ${notch} of ${LADDER_TIERS}`}
        >
          <input
            type="radio"
            name={`tier-${field.key}`}
            className="peer sr-only"
            checked={tier === notch}
            onChange={() => onWeight(field.key, weightForTier(notch))}
          />
          <span
            aria-hidden
            className={`block h-3.5 w-3 rounded-[2px] transition-colors peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-active ${
              notch <= tier ? "lab-channel-bar-lit" : "lab-channel-bar"
            }`}
          />
          <span className="sr-only">
            {notch} of {LADDER_TIERS}
          </span>
        </label>
      ))}
    </span>
  );
}

/**
 * Which seasons this field is read over, as a slot cut into the row — the
 * app's grammar for a control you read a value out of rather than press.
 *
 * A real `<select>` under the styling, so keyboard and touch behaviour come
 * free; {@link compactSelect} is the 16px iOS-zoom floor, which is why the type
 * here is larger than everything around it. `[color-scheme:dark]` is what makes
 * the native option list match the panel it drops out of.
 */
function WindowSelect({
  field,
  window,
  onWindow,
}: {
  field: CompsField;
  window: CompsWindowKey;
  onWindow: (key: string, window: CompsWindowKey) => void;
}) {
  const moved = window !== DEFAULT_COMPS_WINDOW;
  return (
    <span className="lab-channel relative shrink-0 rounded">
      <select
        aria-label={`${field.label} — seasons read`}
        value={window}
        onChange={(event) =>
          onWindow(field.key, event.target.value as CompsWindowKey)
        }
        // 8.5rem is the measured floor, not a round number: at the 16px the
        // zoom rule pins this control to, `Career worst` and `This season` are
        // both ~95px, and at 7.5rem the default option clipped to "This seas…".
        className={`w-[8.5rem] cursor-pointer appearance-none truncate rounded bg-transparent pr-4 ${compactSelect} [color-scheme:dark] outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-active ${
          // The accent marks a window that is actually narrowing something. A
          // default recedes, because most rows carry one and a row of lit
          // "This season" would bury the ones doing work.
          moved ? "text-active" : "text-foreground/45"
        }`}
      >
        {COMPS_WINDOWS.map((option) => (
          <option key={option.key} value={option.key}>
            {option.label}
          </option>
        ))}
      </select>
      <span
        aria-hidden
        className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 text-[8px] text-foreground/40"
      >
        ▾
      </span>
    </span>
  );
}

/**
 * The catalogue, as chips to add — kept in its family bays, because what
 * adding one *costs* is a fact about the family and this is the moment a
 * reader is deciding to pay it.
 */
function Bin({
  fields,
  onAdd,
}: {
  fields: readonly CompsField[];
  onAdd: (key: string) => void;
}) {
  const families = FAMILIES.filter((family) =>
    fields.some((field) => field.family === family),
  );
  if (families.length === 0) return null;

  return (
    <div className="mt-3 grid items-start gap-3 @2xl:grid-cols-3">
      {families.map((family) => (
        <section key={family} className="lab-trough rounded-xl px-2.5 pb-2.5 pt-2 @2xl:px-3">
          <h3 className="lab-engraved-faint mb-2 px-1 font-display text-[10px] uppercase tracking-[0.18em] text-foreground/45">
            {FAMILY_LABELS[family]}
          </h3>
          <ul className="flex flex-wrap gap-1.5">
            {fields
              .filter((field) => field.family === family)
              .map((field) => (
                <li key={field.key}>
                  <button
                    type="button"
                    onClick={() => onAdd(field.key)}
                    className="lab-chip lab-chip-sm rounded-full px-2.5 py-1 text-[11px] text-foreground/70 hover:text-foreground"
                  >
                    + {field.label}
                  </button>
                </li>
              ))}
          </ul>
          <p className="mt-2 px-1 text-[11px] leading-4 text-foreground/40">
            {FAMILY_NOTES[family]}
          </p>
        </section>
      ))}
    </div>
  );
}
