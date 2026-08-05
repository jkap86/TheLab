import { useMemo } from "react";

import {
  type ActiveFilter,
  type LeagueFilters,
  activeFilters,
  clearFilter,
  leagueBreakdown,
} from "../../league-filters";
import type { ManagerLeague } from "@/shared/manager";

import { CAPTION } from "./league-filters-modal.constants.ts";
import { chipKey, matchShare } from "./league-filters-modal.utils.ts";

/**
 * The live readout: how many leagues survive the draft, what is doing the
 * narrowing, and what the survivors are.
 *
 * Three things it says that a footer count can't. The **meter** puts the number
 * against the account it came out of, so "17" reads as a fifth of the leagues
 * rather than as a bare figure. The **chips** are the selection restated outside
 * the controls that built it — which matters most for the rules, since a slot
 * rule and a scoring rule live in different bays and a reader narrowing to
 * nothing otherwise has two lists to audit; each strikes itself out in place, so
 * backing off one filter costs a click rather than a hunt. And the **breakdown**
 * answers the question the count raises — 17 of what kind — along the axes that
 * say what game a league is playing.
 *
 * It edits the same draft the controls do rather than holding state, so a chip's
 * `×` and the row it names are one selection seen twice.
 */
export function MatchRail({
  matched,
  total,
  filters,
  onChange,
}: {
  matched: readonly ManagerLeague[];
  total: number;
  filters: LeagueFilters;
  onChange: (filters: LeagueFilters) => void;
}) {
  const active = activeFilters(filters);
  const breakdown = useMemo(() => leagueBreakdown(matched), [matched]);
  const share = matchShare(matched.length, total);

  return (
    // A labelled group rather than an `<aside>`: an aside that is not inside
    // sectioning content maps to the `complementary` landmark, and a `<dialog>`
    // is not sectioning content — so this was publishing a page-level landmark
    // from inside a modal.
    <div
      role="group"
      aria-label="Matching leagues"
      className="lab-well flex flex-col gap-4 rounded-xl p-4 lg:sticky lg:top-0 lg:self-start"
    >
      {/* The one number the dialog exists to move, so it is announced when it
          moves rather than only when a reader goes looking for it. `polite`, and
          on the count alone — the breakdown under it is read on demand. */}
      <div role="status" className="flex flex-col gap-1">
        <span className={CAPTION}>Leagues matching</span>
        <div className="flex items-baseline gap-2">
          <span className="font-mono text-[2.5rem] font-bold leading-none tabular-nums text-active [text-shadow:0_0_22px_rgba(0,255,229,0.45)]">
            {matched.length}
          </span>
          <span className="text-xs text-foreground/45">
            of {total}
            {share !== null && ` · ${Math.round(share * 100)}%`}
          </span>
        </div>
      </div>

      <div className="h-1.5 overflow-hidden rounded-full bg-foreground/10 shadow-[inset_0_1px_2px_rgba(0,0,0,0.7)]">
        <div
          className="h-full rounded-full bg-gradient-to-r from-[#00b8a4] to-active shadow-[0_0_10px_rgba(0,255,229,0.7)] transition-[width] duration-200"
          style={{ width: `${(share ?? 0) * 100}%` }}
        />
      </div>

      <Divider />

      <div className="flex flex-col gap-2">
        <span className={CAPTION}>Narrowing</span>
        {active.length === 0 ? (
          <p className="text-xs text-foreground/35">
            Nothing yet — every league is in.
          </p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {active.map((entry) => (
              <ActiveChip
                key={chipKey(entry)}
                entry={entry}
                onRemove={() => onChange(clearFilter(filters, entry))}
              />
            ))}
          </div>
        )}
      </div>

      {matched.length > 0 && (
        <>
          <Divider />
          <div className="flex flex-col gap-1.5">
            <span className={CAPTION}>Of these {matched.length}</span>
            <dl className="flex flex-col gap-1">
              {breakdown.map((row) => (
                <div
                  key={row.key}
                  className="flex items-baseline justify-between gap-2 text-xs"
                >
                  <dt className="text-foreground/55">{row.label}</dt>
                  <dd className="font-mono tabular-nums text-foreground/90">
                    {row.count}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        </>
      )}
    </div>
  );
}

function ActiveChip({
  entry,
  onRemove,
}: {
  entry: ActiveFilter;
  onRemove: () => void;
}) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md border border-active/25 bg-active/10 py-0.5 pl-2 pr-1 font-mono text-[11px] text-foreground/85">
      {entry.label}
      <button
        type="button"
        aria-label={`Stop filtering by ${entry.label}`}
        onClick={onRemove}
        className="leading-none text-foreground/45 transition-colors hover:text-[#ff5f6d]"
      >
        ×
      </button>
    </span>
  );
}

function Divider() {
  return <span aria-hidden="true" className="h-px bg-foreground/10" />;
}
