"use client";

import { CONSOLE_WELL } from "@/features/shared";
import type { CompCriterionId, CompWindowId } from "@/shared/contract";
import {
  WEIGHT_MAX,
  WEIGHT_MIN,
  WEIGHT_STEP,
  WINDOWS,
  windowById,
} from "@/shared/comps";
import type { CompCriterion } from "@/shared/comps";

import { isWindowed, windowKeyDisabled } from "../helpers/criteria-state";
import { weightLabel } from "../helpers/format";
import { CAPTION, LIT, Rail, ToggleKey } from "./controls";

/** How many criteria the left column carries; the rest go right. */
const LEFT_COLUMN = 6;

/**
 * The criteria panel: eleven keys in two columns, each with its window keys
 * beside it and a weight rail per selected window under it.
 *
 * **A switched-off criterion shows no rails** — a tray of dead rails is a
 * control that cannot move — and its window keys are disabled at a tone that
 * is only legitimate *because* they are disabled. The last window on a live
 * criterion is disabled too: the bound is enforced by the key, never by
 * correcting the state after the press.
 */
export function CriteriaPanel({
  criteria,
  activeCount,
  position,
  sampleCorpus,
  resettable,
  onReset,
  onToggle,
  onWindow,
  onWeight,
}: {
  criteria: readonly CompCriterion[];
  activeCount: number;
  /** The subject's position, or null before one is picked. */
  position: string | null;
  /** Whether the copy's "two per player" clause applies. */
  sampleCorpus: boolean;
  /** Whether the table has been edited away from the position's preset. */
  resettable: boolean;
  onReset: () => void;
  onToggle: (id: CompCriterionId) => void;
  onWindow: (id: CompCriterionId, window: CompWindowId) => void;
  onWeight: (id: CompCriterionId, window: CompWindowId, weight: number) => void;
}) {
  const half = Math.min(LEFT_COLUMN, Math.ceil(criteria.length / 2));
  const columns = [criteria.slice(0, half), criteria.slice(half)];

  return (
    <section className={`${CONSOLE_WELL} mt-7 p-3.5 font-mono`}>
      <header className="flex flex-wrap items-baseline gap-2.5 px-1 pb-2.5">
        <h2 className="text-[length:var(--fs-11)] font-normal uppercase tracking-[0.16em] text-foreground/60">
          Criteria
        </h2>
        {position && (
          <span className={CAPTION}>
            {position} defaults
          </span>
        )}
        {/* The preset stops firing the moment the table is edited, which is
            what keeps a reader's own weights — and what would otherwise strand
            them on one position's criteria for the rest of the session. */}
        {resettable && (
          <button
            type="button"
            onClick={onReset}
            className="rounded-[0.4375rem] border border-foreground/10 bg-[image:var(--key-bg)] px-2 py-1 font-mono text-[length:var(--fs-9)] uppercase tracking-[0.14em] text-foreground/70 shadow-[var(--key-shadow-pressed)] transition-[color,box-shadow,border-color] duration-150 hover:text-readout focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-active/60"
          >
            Reset{position ? ` to ${position}` : ""}
          </button>
        )}
        <span
          className={`ml-auto text-[length:var(--fs-10)] uppercase tracking-[0.16em] tabular-nums ${LIT}`}
        >
          {activeCount} of {criteria.length} on
        </span>
      </header>

      <div className="grid items-start gap-x-7 [grid-template-columns:repeat(auto-fit,minmax(20rem,1fr))]">
        {columns.map((column, index) => (
          <div key={index} className="min-w-0">
            <div className="grid items-baseline gap-2 px-1 pb-1.5 [grid-template-columns:minmax(0,1fr)_9.25rem]">
              <span className={CAPTION}>Criterion</span>
              <span className={CAPTION}>Read over</span>
            </div>
            {column.map((criterion) => (
              <CriterionRow
                key={criterion.id}
                criterion={criterion}
                onToggle={() => onToggle(criterion.id)}
                onWindow={(window) => onWindow(criterion.id, window)}
                onWeight={(window, weight) => onWeight(criterion.id, window, weight)}
              />
            ))}
          </div>
        ))}
      </div>

      <p className="mx-1 mt-3.5 font-display text-[length:var(--fs-11)] leading-[1.45] text-foreground/[0.62] [text-wrap:pretty]">
        1Y last year · 2Y two-year average · CAR career average · BEST career
        high. Pick as many as you want per criterion — each gets its own weight
        and is compared separately.
        {sampleCorpus
          ? " Career reads the seasons on file, two per player in this sample corpus."
          : " Career reads every season on file up to the one being compared."}
        {" "}
        A window that could not read every season it asked for says so on the
        chip — <span className="whitespace-nowrap">1 of 2 yr</span> rather than
        2 yr — and a criterion the corpus cannot answer for a season costs that
        season stat coverage rather than counting as a zero.
      </p>
      {/* This line stands only while KTC is a plate figure and not a
          criterion — see `CRITERIA` for the decision it states. */}
      <p className="mx-1 mt-[0.4375rem] font-display text-[length:var(--fs-11)] leading-[1.45] text-foreground/[0.62] [text-wrap:pretty]">
        KTC is not a criterion. A historical season has no recoverable market
        price, so matching on it would mean inventing one — it sits on the
        subject plate instead, as what he costs today.
      </p>
    </section>
  );
}

function CriterionRow({
  criterion,
  onToggle,
  onWindow,
  onWeight,
}: {
  criterion: CompCriterion;
  onToggle: () => void;
  onWindow: (window: CompWindowId) => void;
  onWeight: (window: CompWindowId, weight: number) => void;
}) {
  const windowed = isWindowed(criterion);

  return (
    <div className="px-1 pb-[0.3125rem] pt-[0.1875rem]">
      <div className="grid items-center gap-2 [grid-template-columns:minmax(0,1fr)_9.25rem]">
        <ToggleKey on={criterion.on} onClick={onToggle} className="px-2.5">
          {criterion.label}
        </ToggleKey>
        {windowed ? (
          <span className="grid gap-[0.1875rem] [grid-template-columns:repeat(4,minmax(0,1fr))]">
            {WINDOWS.map((spec) => {
              const on = criterion.wins.some((w) => w.id === spec.id);
              const disabled = windowKeyDisabled(criterion, spec.id);
              return (
                <button
                  key={spec.id}
                  type="button"
                  title={`${criterion.label} · ${spec.label}`}
                  aria-pressed={on}
                  disabled={disabled}
                  onClick={() => onWindow(spec.id)}
                  className={`min-w-0 rounded-[0.4375rem] border bg-[image:var(--key-bg)] px-[0.0625rem] py-1.5 font-mono text-[length:var(--fs-8)] uppercase tracking-[0.02em] transition-[color,box-shadow,border-color] duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-active/60 ${
                    on
                      ? "border-active/45 shadow-[var(--key-shadow)]"
                      : "border-foreground/10 shadow-[var(--key-shadow-pressed)]"
                  } ${
                    !criterion.on
                      ? "cursor-default text-foreground/[0.34]"
                      : on
                        ? `${disabled ? "cursor-default" : ""} text-readout`
                        : "text-foreground/60"
                  }`}
                >
                  {spec.key}
                </button>
              );
            })}
          </span>
        ) : (
          <span
            aria-hidden
            className="text-center text-[length:var(--fs-10)] text-foreground/30"
          >
            —
          </span>
        )}
      </div>

      {criterion.on &&
        criterion.wins.map((w) => {
          const spec = windowById(w.id);
          return (
            <div
              key={w.id}
              className="grid items-center gap-2 pl-[1.0625rem] pt-[0.1875rem] [grid-template-columns:minmax(0,1fr)_5.5rem_2.5rem]"
            >
              <span className="min-w-0 truncate text-[length:var(--fs-9)] uppercase tracking-[0.14em] text-foreground/60">
                {windowed ? spec.label : "Weight"}
              </span>
              <Rail
                value={w.w}
                min={WEIGHT_MIN}
                max={WEIGHT_MAX}
                step={WEIGHT_STEP}
                label={`${criterion.label} · ${spec.label} weight`}
                onChange={(weight) => onWeight(w.id, weight)}
              />
              <span className={`text-right text-[length:var(--fs-11)] tabular-nums ${LIT}`}>
                {weightLabel(w.w)}
              </span>
            </div>
          );
        })}
    </div>
  );
}
