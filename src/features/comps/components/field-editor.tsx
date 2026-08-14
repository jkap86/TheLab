"use client";

import { COMPS_FIELDS } from "../../../shared/comps/fields";

import type { CompsPosition } from "../../../shared/comps/fields";

/**
 * Every weight at once, in three family bays, committing live — the debounce
 * upstream is what keeps a drag from firing a request per notch. Sliders
 * rather than text fields: a weight is a proportion, and `type="range"` is
 * exempt from the iOS 16px floor because nothing is typed into it.
 */

const FAMILY_LABELS = {
  production: "Production",
  profile: "Profile",
  market: "Market values",
} as const;

const FAMILIES = ["production", "profile", "market"] as const;

export function FieldEditor({
  position,
  weights,
  customized,
  onWeight,
  onReset,
}: {
  position: CompsPosition;
  weights: Record<string, number>;
  customized: boolean;
  onWeight: (key: string, weight: number) => void;
  onReset: () => void;
}) {
  return (
    <section className="rounded-xl border border-foreground/10 bg-foreground/[0.02] p-4">
      <div className="mb-3 flex items-center gap-3">
        <h2 className="text-sm font-semibold text-foreground/80">
          Comparison weights
        </h2>
        <button
          type="button"
          onClick={onReset}
          disabled={!customized}
          className={`lab-chip lab-chip-sm ml-auto rounded-full px-3 py-1 text-xs ${
            customized ? "text-foreground/80" : "text-foreground/30"
          }`}
        >
          Reset to {position} defaults
        </button>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {FAMILIES.map((family) => (
          <div key={family}>
            <h3 className="mb-2 text-[11px] font-medium uppercase tracking-[0.18em] text-foreground/40">
              {FAMILY_LABELS[family]}
            </h3>
            <ul className="space-y-2">
              {COMPS_FIELDS.filter((field) => field.family === family).map(
                (field) => (
                  <li key={field.key} className="flex items-center gap-3">
                    <label
                      htmlFor={`weight-${field.key}`}
                      className={`w-32 shrink-0 truncate text-xs ${
                        weights[field.key] > 0
                          ? "text-foreground/75"
                          : "text-foreground/35"
                      }`}
                    >
                      {field.label}
                    </label>
                    <input
                      id={`weight-${field.key}`}
                      type="range"
                      min={0}
                      max={100}
                      step={5}
                      value={weights[field.key] ?? 0}
                      onChange={(event) =>
                        onWeight(field.key, Number(event.target.value))
                      }
                      className="lab-slider min-w-0 flex-1"
                    />
                    <span className="w-7 shrink-0 text-right text-xs tabular-nums text-foreground/60">
                      {weights[field.key] ?? 0}
                    </span>
                  </li>
                ),
              )}
            </ul>
            {family === "market" && (
              <p className="mt-2 text-[11px] leading-4 text-foreground/40">
                Weighting a market value removes players it doesn&apos;t price
                from the comparison — unpriced seasons can&apos;t be measured
                against it.
              </p>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
