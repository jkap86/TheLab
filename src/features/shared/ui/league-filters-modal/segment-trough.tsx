import {
  BEST_BALL_OPTIONS,
  type LeagueFilters,
  STATUS_OPTIONS,
  TYPE_OPTIONS,
} from "../../league-filters";
import type { ManagerLeague } from "@/shared/manager";

import { FilterRail } from "./filter-rail.tsx";
import type {
  ExtraSegment,
  LeagueFilterRow,
} from "./league-filters-modal.types.ts";

/**
 * The fixed filters, in one trough.
 *
 * They are grouped because they are the same kind of question — what a league
 * *is*, each a closed set of three or four answers — where the rule bays below
 * are lists a reader writes, and the season band above is the population all of
 * them are read against.
 *
 * Every `probe` closes over the draft, so each row's counts describe *this*
 * selection with one field changed rather than that filter in isolation: the
 * numbers say what picking an option would leave, which is the question the
 * dialog is opened to answer. Drawn as rails rather than as collapsed rows, that
 * makes the trough a live cross-tab — lighting Dynasty moves the Format row's
 * numbers underneath it, which is exactly what the popovers were hiding.
 *
 * A caller may seat a fourth row here ({@link ExtraSegment}) — the ADP board's
 * draft-kind chip, and nothing else. It is last because it is the one row that
 * is not a fact about a league, and it carries **no counts**: it cuts drafts
 * inside a league rather than leagues, so every option would show the identical
 * number and that number would be about something the row does not narrow.
 */
export function SegmentTrough({
  draft,
  onChange,
  leagues,
  omit,
  extra,
  extraDraft = "",
  onExtraChange,
}: {
  draft: LeagueFilters;
  onChange: (filters: LeagueFilters) => void;
  leagues: readonly ManagerLeague[];
  /** Rows the caller answers with a control of its own — see {@link LeagueFilterRow}. */
  omit?: readonly LeagueFilterRow[];
  /** The caller's fourth row; the fixed rows above it are drawn either way. */
  extra?: ExtraSegment;
  extraDraft?: string;
  onExtraChange?: (value: string) => void;
}) {
  return (
    <div className="lab-well flex flex-col gap-0.5 rounded-xl p-1.5">
      <FilterRail
        label="Status"
        options={STATUS_OPTIONS}
        value={draft.status}
        leagues={leagues}
        probe={(status) => ({ ...draft, status })}
        onPick={(status) => onChange({ ...draft, status })}
      />
      {!omit?.includes("type") && (
        <FilterRail
          label="Type"
          options={TYPE_OPTIONS}
          value={draft.type}
          leagues={leagues}
          probe={(type) => ({ ...draft, type })}
          onPick={(type) => onChange({ ...draft, type })}
        />
      )}
      <FilterRail
        label="Format"
        options={BEST_BALL_OPTIONS}
        value={draft.bestBall}
        leagues={leagues}
        probe={(bestBall) => ({ ...draft, bestBall })}
        onPick={(bestBall) => onChange({ ...draft, bestBall })}
      />
      {extra && onExtraChange && (
        <FilterRail
          label={extra.label}
          options={extra.options}
          value={extraDraft}
          leagues={leagues}
          onPick={onExtraChange}
        />
      )}
    </div>
  );
}
