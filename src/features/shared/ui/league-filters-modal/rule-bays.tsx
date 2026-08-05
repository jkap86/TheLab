import {
  type LeagueFilters,
  SLOT_GROUPS,
  matchesScoringRule,
  matchesSlotRule,
  scoringKeyLabel,
} from "../../league-filters";
import type { ManagerLeague } from "@/shared/manager";

import {
  SCORING_PRESETS,
  SLOT_PRESETS,
} from "./league-filters-modal.constants.ts";
import { RuleBay } from "./rule-bay.tsx";

/**
 * The two lists a reader writes: what a lineup starts, and what a scoring page
 * pays.
 *
 * Side by side as equal bays rather than stacked, which is the layout decision
 * the whole panel is arranged around — stacked, they fell below a 60vh scroll
 * box and the feature read as missing.
 *
 * The two are one component apiece and differ only in what they are handed. The
 * slot keys are a fixed table (`SLOT_GROUPS`, predicates derived from the
 * solver's own slot vocabulary, so a new flex counts the moment the solver
 * learns it); the scoring keys are read off the leagues in hand, because what a
 * league pays for is a house rule and a fixed list would offer keys nobody
 * scores while hiding the one someone wants. That is also why the scoring bay's
 * new rule falls back to `rec`: on a cold load there is no first key to take.
 */
export function RuleBays({
  draft,
  onChange,
  leagues,
  scoringKeys,
}: {
  draft: LeagueFilters;
  onChange: (filters: LeagueFilters) => void;
  leagues: readonly ManagerLeague[];
  /** The scoring vocabulary these leagues actually pay for. */
  scoringKeys: string[];
}) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <RuleBay
        label="Roster slots"
        empty="Any lineup. Add a rule to narrow by what a league starts."
        rules={draft.slots}
        onChange={(slots) => onChange({ ...draft, slots })}
        keyOptions={SLOT_GROUPS.map((group) => ({
          value: group.key,
          label: group.label,
          hint: group.hint,
        }))}
        newRule={{ key: "QB+SF", op: "gte", value: 2 }}
        presets={SLOT_PRESETS}
        step={1}
        leagues={leagues}
        match={matchesSlotRule}
      />

      <RuleBay
        label="Scoring settings"
        empty="Any scoring. Add a rule to narrow by what a league pays."
        rules={draft.scoring}
        onChange={(scoring) => onChange({ ...draft, scoring })}
        keyOptions={scoringKeys.map((key) => ({
          value: key,
          label: scoringKeyLabel(key),
        }))}
        newRule={{ key: scoringKeys[0] ?? "rec", op: "eq", value: 1 }}
        presets={SCORING_PRESETS}
        step={0.5}
        leagues={leagues}
        match={matchesScoringRule}
      />
    </div>
  );
}
