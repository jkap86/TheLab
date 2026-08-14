"use client";

import { compactSelect } from "@/features/shared/control-type";

import {
  COMPS_FIELDS,
  compsFieldTakesWindow,
} from "../../../shared/comps/fields";
import {
  COMPS_WINDOWS,
  DEFAULT_COMPS_WINDOW,
} from "../../../shared/comps/windows";

import type { CompsField, CompsPosition } from "../../../shared/comps/fields";
import type { CompsWindowKey } from "../../../shared/comps/windows";

/**
 * The comparison bench: every weight and every window at once, committing live —
 * the debounce upstream is what keeps a drag from firing a request per notch.
 *
 * It is built as an instrument rather than a form, and the material is doing
 * work rather than decoration. A weight board is the one control on this page
 * whose *shape* is the answer: which stats are in, how hard each pulls, and
 * over what stretch of career each is read. A column of labelled sliders states
 * all three and shows none of them, so the panel says each in the app's own
 * grammar — the mix strip is the proportions at a glance, a lit rail per row is
 * membership, and a recessed slot per window is the axis a row is read on. The
 * classes are `globals.css`'s, so this reads as the same machine as the app bar
 * and the league panel rather than as a settings page that happens to be dark.
 *
 * Three decisions in it are decisions rather than styling:
 *
 * - **A window control on every field that takes one, lit or not.** The
 *   tempting economy is to draw it only where the field carries weight — it is
 *   the majority of the panel's width and it changes nothing while the weight
 *   is 0. It is wrong twice: the control appearing mid-drag resizes the very
 *   slider under the reader's finger, and a control that only exists after you
 *   have already committed to a field is a control most readers never learn is
 *   there.
 * - **Sliders rather than number fields**, the panel's original call and worth
 *   restating now that the row has a second control: a weight is a proportion,
 *   and `type="range"` is the one focusable control exempt from the 16px iOS
 *   floor because nothing is typed into it. The window select is *not* exempt
 *   and wears {@link compactSelect} accordingly.
 * - **The bays are the field families**, and each says what weighting one of
 *   its fields costs — a market weight excludes unpriced seasons, a window
 *   excludes seasons with no career behind them. That note is the honest half
 *   of the feature: every dimension added here narrows the population, and the
 *   counts under the results are where it lands.
 */

const FAMILY_LABELS = {
  production: "Production",
  profile: "Profile",
  market: "Market values",
} as const;

/** The families in their own bays, production first — it is most of the board. */
const SIDE_FAMILIES = ["profile", "market"] as const;

const FAMILY_NOTES = {
  production:
    "Air yards, snaps and the usage rates only exist where the stat feed supplies them — weighting one narrows the comparison to seasons that can answer it. So does a window: a season with no career behind it can't answer one, and the counts under the results are where that lands.",
  profile:
    "Career and recent form read stored prior seasons — weighting one removes first-year seasons, which have no prior form to measure.",
  market:
    "Weighting a market value removes players it doesn't price from the comparison — unpriced seasons can't be measured against it.",
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
  const active = COMPS_FIELDS.filter((field) => (weights[field.key] ?? 0) > 0);
  const load = active.reduce((sum, field) => sum + weights[field.key], 0);
  const windowed = active.filter(
    (field) => (windows[field.key] ?? DEFAULT_COMPS_WINDOW) !== DEFAULT_COMPS_WINDOW,
  ).length;

  const row = (field: CompsField) => (
    <WeightRow
      key={field.key}
      field={field}
      weight={weights[field.key] ?? 0}
      window={windows[field.key] ?? DEFAULT_COMPS_WINDOW}
      share={load > 0 ? (weights[field.key] ?? 0) / load : 0}
      onWeight={onWeight}
      onWindow={onWindow}
    />
  );

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
              { value: String(active.length), caption: "fields" },
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

        <MixStrip fields={active} weights={weights} load={load} />

        <div className="mt-3 space-y-3">
          <Bay family="production">
            <ul className="grid gap-y-0.5 @4xl:grid-cols-2 @4xl:gap-x-5">
              {COMPS_FIELDS.filter((f) => f.family === "production").map(row)}
            </ul>
          </Bay>
          {/* `items-start`, so the shorter bay is its own height rather than
              stretching to the taller one's and trailing a panel of empty
              trough under its note. */}
          <div className="grid items-start gap-3 @2xl:grid-cols-2">
            {SIDE_FAMILIES.map((family) => (
              <Bay key={family} family={family}>
                <ul className="grid gap-y-0.5">
                  {COMPS_FIELDS.filter((f) => f.family === family).map(row)}
                </ul>
              </Bay>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}

/**
 * A bay: the family's fields in a milled trough with the caption cut into the
 * plate above it. The caption is engraved rather than lit — there are three of
 * these and the accent is spent on what the reader is actually setting.
 */
function Bay({
  family,
  children,
}: {
  family: keyof typeof FAMILY_LABELS;
  children: React.ReactNode;
}) {
  return (
    <section className="lab-trough rounded-xl px-2.5 pb-2.5 pt-2 @2xl:px-3">
      <h3 className="lab-engraved-faint mb-1.5 px-1 font-display text-[10px] uppercase tracking-[0.18em] text-foreground/45">
        {FAMILY_LABELS[family]}
      </h3>
      {children}
      <p className="mt-2 px-1 text-[11px] leading-4 text-foreground/40">
        {FAMILY_NOTES[family]}
      </p>
    </section>
  );
}

/**
 * The gauge run: the board's own numbers, in the trade card's bezel. Four facts
 * that are otherwise only inferable by reading seventeen sliders — how many
 * fields are in, how hard the board pulls in total, how many are read over
 * something other than this season, and which position's board this is.
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
 * The mix: each weighted field's share of the total, as lit bars standing in a
 * cut. It is the one thing the sliders cannot show — a slider says how much a
 * field weighs and nothing about how much of the *comparison* it is, which is
 * what the distance actually reads. Aria-hidden: the numbers it summarises are
 * on the rows below it, and a bar chart read aloud is noise.
 */
function MixStrip({
  fields,
  weights,
  load,
}: {
  fields: readonly CompsField[];
  weights: Record<string, number>;
  load: number;
}) {
  return (
    <div className="lab-channel flex h-3 gap-px overflow-hidden rounded p-[2px]" aria-hidden>
      {load > 0 &&
        fields.map((field) => (
          <span
            key={field.key}
            className="lab-channel-bar-lit rounded-[1px]"
            style={{ width: `${(weights[field.key] / load) * 100}%` }}
            title={`${field.label} · ${Math.round((weights[field.key] / load) * 100)}%`}
          />
        ))}
    </div>
  );
}

function WeightRow({
  field,
  weight,
  window,
  share,
  onWeight,
  onWindow,
}: {
  field: CompsField;
  weight: number;
  window: CompsWindowKey;
  share: number;
  onWeight: (key: string, weight: number) => void;
  onWindow: (key: string, window: CompsWindowKey) => void;
}) {
  const active = weight > 0;
  const takesWindow = compsFieldTakesWindow(field);
  const moved = window !== DEFAULT_COMPS_WINDOW;

  return (
    <li className="relative flex flex-wrap items-center gap-x-2.5 gap-y-1 py-1 pl-2.5">
      {/* The lit rail is membership: what is in the comparison at all, said the
          way the manager plate says "a readout follows". Unlit it stays a
          groove rather than vanishing, so the row keeps its left edge. */}
      <span
        aria-hidden
        className={`absolute left-0 top-1/2 h-4 w-[3px] -translate-y-1/2 rounded-full ${
          active ? "lab-billet-rail" : "bg-foreground/10"
        }`}
      />
      <label
        htmlFor={`weight-${field.key}`}
        // Measured rather than picked: 7.5rem holds every production label at
        // 12px, and the two long ones — `Prev 3 seasons PPR/g`, `KTC 90-day
        // trend (SF)` — live in the side bays, which have the room to give at
        // the tier where they sit two-up.
        className={`w-[7.5rem] shrink-0 truncate text-xs @2xl:w-[9.5rem] ${
          active ? "text-foreground/80" : "text-foreground/35"
        }`}
        title={field.label}
      >
        {field.label}
      </label>
      <input
        id={`weight-${field.key}`}
        type="range"
        min={0}
        max={100}
        step={5}
        value={weight}
        onChange={(event) => onWeight(field.key, Number(event.target.value))}
        className="lab-slider min-w-[4.5rem] flex-1 basis-20"
      />
      <span
        className={`lab-readout w-8 shrink-0 rounded px-1 py-0.5 text-center font-display text-[10px] tabular-nums ${
          active ? "text-active" : "text-foreground/30"
        }`}
        // The share is what the mix strip draws; on the row it is the hover,
        // since a second number per row would compete with the weight itself.
        title={active ? `${Math.round(share * 100)}% of the comparison` : undefined}
      >
        {weight}
      </span>
      {takesWindow && (
        <WindowSelect
          field={field}
          window={window}
          active={active}
          moved={moved}
          onWindow={onWindow}
        />
      )}
    </li>
  );
}

/**
 * Which seasons a stat is read over, as a slot cut into the bay's floor — the
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
  active,
  moved,
  onWindow,
}: {
  field: CompsField;
  window: CompsWindowKey;
  active: boolean;
  moved: boolean;
  onWindow: (key: string, window: CompsWindowKey) => void;
}) {
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
        // both ~95px, and at 7.5rem the *default* option truncated to "This
        // seas…" — a clipped value on the state most rows are in, which is the
        // one truncation this app treats as broken rather than as long.
        className={`w-[8.5rem] cursor-pointer appearance-none truncate rounded bg-transparent pr-4 ${compactSelect} [color-scheme:dark] outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-active ${
          // The accent marks a *moved* window on a field that is in the
          // comparison — the whole of what this control has to say at a
          // glance. A default window recedes even on an active row, because
          // sixteen rows reading "This season" in the same weight as the label
          // beside them would bury the two that are doing something.
          moved && active
            ? "text-active"
            : active
              ? "text-foreground/45"
              : "text-foreground/25"
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
