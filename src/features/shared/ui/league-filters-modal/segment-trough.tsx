import type { RefObject } from "react";

import {
  BEST_BALL_OPTIONS,
  type LeagueFilters,
  STATUS_OPTIONS,
  TYPE_OPTIONS,
} from "../../league-filters";
import type { ManagerLeague } from "@/shared/manager";

import type { SegmentKey } from "./league-filters-modal.types.ts";
import { SegmentRow } from "./segment-row.tsx";

/**
 * The three fixed filters, in one trough.
 *
 * They are grouped because they are the same kind of question — what a league
 * *is*, each a closed set of three or four answers — where the rule bays below
 * are lists a reader writes. Status, type and format each get a row rather than
 * a section, which is what let the bays come up out of the fold.
 *
 * Every `probe` closes over the draft, so each row's counts describe *this*
 * selection with one field changed rather than that filter in isolation: the
 * numbers say what picking an option would leave, which is the question the
 * dialog is opened to answer.
 */
export function SegmentTrough({
  troughRef,
  draft,
  onChange,
  leagues,
  openGroup,
  onToggle,
  onClose,
}: {
  /** Held by the modal, which dismisses an open row on a press outside this box. */
  troughRef: RefObject<HTMLDivElement | null>;
  draft: LeagueFilters;
  onChange: (filters: LeagueFilters) => void;
  leagues: readonly ManagerLeague[];
  openGroup: SegmentKey | null;
  onToggle: (key: SegmentKey) => void;
  onClose: () => void;
}) {
  return (
    /*
      One trough for the three fixed segments, as three collapsed rows.
      `relative z-10` is what lets an open row's options paint over the rule
      bays below it — a later sibling would otherwise win, whatever the
      popover's own z-index.
    */
    <div
      ref={troughRef}
      className="lab-well relative z-10 flex flex-col gap-0.5 rounded-xl p-1.5"
    >
      <SegmentRow
        label="Status"
        options={STATUS_OPTIONS}
        value={draft.status}
        leagues={leagues}
        probe={(value) => ({ ...draft, status: value })}
        onPick={(status) => onChange({ ...draft, status })}
        open={openGroup === "status"}
        onToggle={() => onToggle("status")}
        onClose={onClose}
      />
      <SegmentRow
        label="Type"
        options={TYPE_OPTIONS}
        value={draft.type}
        leagues={leagues}
        probe={(value) => ({ ...draft, type: value })}
        onPick={(type) => onChange({ ...draft, type })}
        open={openGroup === "type"}
        onToggle={() => onToggle("type")}
        onClose={onClose}
      />
      <SegmentRow
        label="Format"
        options={BEST_BALL_OPTIONS}
        value={draft.bestBall}
        leagues={leagues}
        probe={(value) => ({ ...draft, bestBall: value })}
        onPick={(bestBall) => onChange({ ...draft, bestBall })}
        open={openGroup === "format"}
        onToggle={() => onToggle("format")}
        onClose={onClose}
      />
    </div>
  );
}
