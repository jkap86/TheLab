"use client";

import { CONSOLE_TRACK, CONSOLE_TRACK_SHELL } from "../console-chrome";

export type ModeTrackOption<T extends string> = {
  id: T;
  label: string;
  /** Null while the read behind it is in flight — the key draws a dash. */
  count: number | null;
};

/**
 * A stamped legend, a track of single-select keys each carrying a count, and a
 * lit sentence saying what the lit key means.
 *
 * It is the manager shares console's `PlayerModeTrack` with its vocabulary
 * taken out, which is what let the gametime stat board's pane draw the same
 * part over its own four readings: one spelling of the look, two sets of
 * words. The keys' faces are that component's to the class.
 *
 * **`wrap` is for a pane too narrow for one line of keys.** Five readings at
 * `--fs-10` are ~460px and gametime's pane is 320, so the track takes a line of
 * its own under the legend and the sentence (`order-last basis-full`), wraps,
 * and gives up the lozenge for a radius — see `CONSOLE_TRACK_SHELL`. Unwrapped,
 * a key never shrinks, because a clipped count is a wrong number.
 *
 * **A count of null is an em dash, never a zero** — "Available 0" is a claim,
 * where a dash is the read still being in flight.
 */
export function ModeTrack<T extends string>({
  legend,
  label,
  options,
  value,
  onPick,
  note,
  wrap = false,
  className = "",
}: {
  legend: string;
  /** The group's accessible name. */
  label: string;
  options: readonly ModeTrackOption<T>[];
  value: T;
  onPick: (id: T) => void;
  note: string;
  wrap?: boolean;
  /** The caller's own padding — the row it sits under decides it. */
  className?: string;
}) {
  return (
    <div className={`flex flex-wrap items-center gap-[0.4375rem] ${className}`}>
      <span className="shrink-0 font-mono text-[length:var(--fs-8)] uppercase tracking-[0.18em] text-foreground/42">
        {legend}
      </span>

      <span
        className={`${
          wrap
            ? `${CONSOLE_TRACK_SHELL} order-last flex basis-full flex-wrap rounded-[0.875rem]`
            : `${CONSOLE_TRACK} inline-flex`
        } items-center gap-1 p-1`}
        role="group"
        aria-label={label}
      >
        {options.map(({ id, label: keyLabel, count }) => {
          const on = value === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => onPick(id)}
              aria-pressed={on}
              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-[0.3125rem] font-mono text-[length:var(--fs-10)] uppercase tracking-[0.14em] transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-active/60 ${
                wrap ? "flex-auto justify-center" : "shrink-0"
              } ${
                on
                  ? "border-active/55 bg-[image:var(--key-bg)] text-readout [text-shadow:var(--readout-text-glow)] shadow-[var(--key-shadow),inset_0_0_14px_color-mix(in_srgb,var(--accent)_16%,transparent)]"
                  : "border-transparent text-foreground/58 hover:text-readout"
              }`}
            >
              {keyLabel}
              <span className={`tabular-nums ${on ? "text-readout-label" : "text-foreground/42"}`}>
                {count ?? "—"}
              </span>
            </button>
          );
        })}
      </span>

      <span className="min-w-0 flex-[1_1_8rem] truncate font-mono text-[length:var(--fs-9)] uppercase tracking-[0.16em] text-active">
        {note}
      </span>
    </div>
  );
}
