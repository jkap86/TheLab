import type { ManagerLeague } from "@/shared/manager";

import type { AdpControls } from "../../adp-controls";
import { ChipSelect } from "./adp-filter-control";
import { AdpLeagueSeedControl } from "./adp-league-seed-control";
import { narrowingFilters } from "./adp-drawer.utils.ts";
import type { FilterSpec } from "./adp-drawer.types.ts";

/**
 * The filters, showing only what is actually narrowing the board.
 *
 * All seven sat on screen permanently, wrapping to three rows on a laptop and
 * four on a phone — and six of the seven usually read "All", which is a control
 * spending a row to report that it is doing nothing. Closed, this is one key and
 * whatever is set; open, it is the full set. A filter that *is* narrowing stays
 * a live `<select>`, so changing one is the single press it always was — what
 * costs a second press is reaching for a filter that was off, which is the case
 * where the drawer was previously spending the height.
 *
 * The open tray holds **every** filter rather than only the unset ones, so the
 * set doesn't reshuffle as it is used; the summary chips step aside while it is
 * up, since two controls for one filter is a worse answer than either.
 */
export function AdpFilterBar({
  controls,
  filters,
  seedLeagues,
  open,
  onToggle,
  onChange,
}: {
  controls: AdpControls;
  filters: readonly FilterSpec[];
  /** See {@link AdpDrawer}'s own prop — empty means no seed control at all. */
  seedLeagues: readonly ManagerLeague[];
  open: boolean;
  onToggle: () => void;
  onChange: (controls: AdpControls) => void;
}) {
  const narrowing = narrowingFilters(filters, controls);

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          className={`lab-chip lab-chip-sm inline-flex items-center gap-1.5 rounded-full px-3 py-[3px] text-xs font-semibold transition-colors ${
            narrowing.length > 0 && !open ? "lab-chip-on" : "text-foreground/70"
          }`}
        >
          Filters
          {narrowing.length > 0 ? (
            <span
              className={`rounded-full px-1.5 text-[0.6rem] font-bold tabular-nums ${
                open ? "bg-active text-[#052029]" : "bg-[#052029]/25"
              }`}
            >
              {narrowing.length}
            </span>
          ) : (
            <span aria-hidden className="text-[0.6rem] text-foreground/40">
              {open ? "▴" : "▾"}
            </span>
          )}
        </button>

        {/* Open, the tray below holds these — two controls for one filter would
            be a worse answer than either of them alone. */}
        {!open &&
          narrowing.map((f) => (
            <ChipSelect
              key={f.key}
              value={f.get(controls)}
              options={f.options}
              ariaLabel={f.ariaLabel}
              narrowed
              onChange={(value) => onChange(f.set(controls, value))}
            />
          ))}

        <AdpLeagueSeedControl
          controls={controls}
          leagues={seedLeagues}
          onChange={onChange}
        />
      </div>

      {open && (
        <div className="flex flex-wrap gap-1.5 border-t border-foreground/[0.07] pt-2">
          {filters.map((f) => (
            <ChipSelect
              key={f.key}
              value={f.get(controls)}
              options={f.options}
              ariaLabel={f.ariaLabel}
              narrowed={f.get(controls) !== "all"}
              onChange={(value) => onChange(f.set(controls, value))}
            />
          ))}
        </div>
      )}
    </div>
  );
}
