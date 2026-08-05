"use client";

import { useEffect, useId, useRef } from "react";

import type { DraftDensityMonth } from "@/shared/manager";

import {
  type AdpRange,
  adpRangePresets,
  boardLabel,
  rangeBounds,
} from "../../adp-controls";
import { useReturnFocus } from "../../use-return-focus";
import type { AdpDensityState } from "../../use-adp-density";
import { LookbackPanel, RangeSparkline } from "../lookback-panel";
import { KeyChip } from "./key-chip";

/**
 * The window control: one line at rest, the lookback counter floating over the
 * panel when it is opened.
 *
 * The line's shape predates the counter and survives it unchanged — a window is
 * chosen once and then read, so the control that sets it lives behind one
 * press, exactly as the filter row answers the same case. What changed is only
 * the panel behind the press: a counter instrument (last N days, ending on a
 * date that defaults to today) in place of the brush-over-a-histogram, whose
 * gesture grammar was the complexity the redesign removed. See
 * {@link LookbackPanel} for the decisions the instrument itself carries.
 *
 * Three things keep the collapsed line affordable rather than merely shorter:
 *
 *   - **The resting line keeps the density's argument.** The strip earned its
 *     place by saying where the drafts *are* before you pick a window; behind a
 *     press it would say that only afterwards. So the trigger carries a
 *     {@link RangeSparkline} of the same bars over the same domain, and the
 *     answer is still on screen at rest.
 *   - **The panel floats; it does not push.** Expanding in place would shove the
 *     filters, the curve and the board down — the reader would be back where
 *     they started, one press later. It is a raised face over the pinned
 *     block's own ground, the material grammar the app bar and the league
 *     filters' floating rows already use.
 *   - **The presets stay outside it.** They fill the counter's fields, but they
 *     are also the whole of what most readers want from this control, and
 *     drawing them in both places would be two controls for one selection. They
 *     sit on the resting line, so "last 30 days" is still the single press it
 *     was — and the one anchor no fixed chip can carry, "since the NFL draft",
 *     lives inside as the panel's ◆ key, computed from the calendar table.
 */
export function AdpRangeControl({
  range,
  season,
  defaultSeason,
  months,
  density,
  today,
  open,
  onToggle,
  onClose,
  onChange,
}: {
  range: AdpRange;
  season: string;
  defaultSeason: string;
  /** The density rows for this season — what the strip is drawn from. */
  months: DraftDensityMonth[];
  density: AdpDensityState;
  /** `YYYY-MM-DD`, resolving the relative presets. */
  today: string;
  /** The counter panel is up. */
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
  onChange: (range: AdpRange) => void;
}) {
  const wrapper = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  const presets = adpRangePresets(season, defaultSeason);
  const bounds = rangeBounds(range, today);
  // Only a board that can contain today gets an axis running to it.
  const live = season === "all" || season === defaultSeason;

  // Held in a ref for the reason the drawer holds `onClose` in one: the parent
  // passes a fresh arrow every render and re-renders on every pointer move of a
  // drag, so a listener keyed on its identity would be torn down and re-attached
  // once a frame for the whole of a gesture.
  const latestClose = useRef(onClose);
  useEffect(() => {
    latestClose.current = onClose;
  }, [onClose]);

  // A press anywhere else dismisses it — the third of the three behaviours a
  // floating control owes (with Escape, handled by the drawer, and one open at a
  // time, handled by its `openPanel`). Containment covers the trigger too, so a
  // press on it toggles rather than closing and immediately reopening.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!wrapper.current?.contains(e.target as Node)) latestClose.current();
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  // Closing takes the focused element with it when the focus was inside the
  // panel, which drops the reader on `body` with no way back into the drawer by
  // keyboard. The trigger is where they were. Written inline here first; it is
  // `useReturnFocus` now, because four other floating controls owe the same.
  useReturnFocus(open, trigger);

  return (
    <div ref={wrapper} className="relative">
      {/* It wraps rather than compressing, and the wrap is decided by the
          trigger's own min-content width: every part of it below is `shrink-0`
          except the sparkline, so the line breaks exactly when the words stop
          fitting and never truncates the one thing on it that answers the
          question. A phone, and a desktop showing a spelled-out custom window,
          put the presets on a second 18px line. */}
      <div className="flex flex-wrap items-center gap-2">
        {/*
          One key holding everything the line says, the shape `AdpTrigger` already
          has: the label, the board it resolves to, and a picture of it. It never
          takes `.lab-chip-on` — a window is always chosen, so tinting it would
          spend the drawer's one "something is narrowed" signal on a constant,
          and the lit preset chip beside it already carries that where it means
          something.
        */}
        <button
          ref={trigger}
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          aria-controls={open ? panelId : undefined}
          className="lab-chip lab-chip-sm flex flex-1 items-center gap-2 rounded-full py-[3px] pl-2.5 pr-2 text-left"
        >
          <span className="shrink-0 text-[0.55rem] font-semibold uppercase tracking-[0.14em] text-foreground/40">
            Window
          </span>
          {/* The board's name and nothing else. The dates behind a preset's name
              are `rangeSummary`'s job and they belong *inside* the panel,
              where the lenses are sitting on them — out here the name is exact
              and stays true as time passes, which is the whole reason a preset
              keeps its name. */}
          <span className="shrink-0 whitespace-nowrap text-[0.7rem] font-semibold text-active">
            {boardLabel(range, season)}
          </span>
          {/* The elastic member, so the line fits a phone and a laptop without a
              breakpoint: everything else on it is content-sized. */}
          <RangeSparkline
            months={months}
            live={live}
            today={today}
            bounds={bounds}
            className="h-4 min-w-[2.25rem] flex-1"
          />
          <span aria-hidden className="shrink-0 text-[0.6rem] text-foreground/40">
            {open ? "▴" : "▾"}
          </span>
        </button>

        {/* A finished season leaves one preset, and a row of one is no choice at
            all — the strip and its calendar markers are the control there, which
            is what they were for. */}
        {presets.length > 1 && (
          <span className="flex shrink-0 items-center gap-1">
            {presets.map((preset) => (
              <KeyChip
                key={preset.value}
                small
                on={range.preset === preset.value}
                onClick={() => onChange({ preset: preset.value, from: null, to: null })}
              >
                {preset.chip}
              </KeyChip>
            ))}
          </span>
        )}
      </div>

      {open && (
        // Raised over the pinned block rather than expanding it, and machined
        // rather than flat: the face falls away from a lit near corner, with a
        // specular hairline along its top — the billet grammar at panel scale,
        // for the one part of the drawer that is an instrument rather than a
        // row of chips. The counter's channel and lenses carry their own
        // grounds, so the face is free to grade where the old scrubber needed
        // the panel colour exactly. `z-30` clears the board's sticky headings
        // (`z-10`) below it.
        <div
          id={panelId}
          className="absolute inset-x-0 top-full z-30 mt-1.5 rounded-lg border border-active/20 bg-[linear-gradient(148deg,#1a3140,#12242f_46%,#0c1c28)] p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.12),inset_0_-6px_11px_rgba(0,0,0,0.45),0_20px_44px_rgba(0,0,0,0.6)]"
        >
          <LookbackPanel
            range={range}
            season={season}
            bounds={bounds}
            months={months}
            live={live}
            error={density.error}
            loading={density.loading}
            today={today}
            onChange={onChange}
          />
        </div>
      )}
    </div>
  );
}
