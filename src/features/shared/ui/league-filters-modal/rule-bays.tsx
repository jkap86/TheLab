import {
  type LeagueFilters,
  SIZE_KEYS,
  SLOT_GROUPS,
  matchesScoringRule,
  matchesSizeRule,
  matchesSlotRule,
  scoringKeyLabel,
} from "../../league-filters";
import type { ManagerLeague } from "@/shared/manager";

import {
  SCORING_PRESETS,
  SIZE_PRESETS,
  SLOT_PRESETS,
} from "./league-filters-modal.constants.ts";
import { RuleBay } from "./rule-bay.tsx";

/**
 * The three lists a reader writes: how big a league is, what its lineup starts,
 * and what its scoring pays.
 *
 * The two big ones are side by side as equal bays rather than stacked, which is
 * the layout decision the whole panel is arranged around — stacked, they fell
 * below a 60vh scroll box and the feature read as missing.
 *
 * **Size leads, full width, and is not a third equal bay.** It holds one key and
 * one number, so half a column of it would be mostly air beside a scoring bay
 * carrying six rules — and it is the closest of the three to the fixed segments
 * directly above it, which is the order the panel reads top to bottom: what a
 * league *is*, how big it is, what it starts, what it pays. Its five presets are
 * also a run that wants a full row rather than a wrapped one.
 *
 * The three are one component apiece and differ only in what they are handed.
 * The slot keys are a fixed table (`SLOT_GROUPS`, predicates derived from the
 * solver's own slot vocabulary, so a new flex counts the moment the solver
 * learns it) and so are the size keys; the scoring keys are read off the leagues
 * in hand, because what a league pays for is a house rule and a fixed list would
 * offer keys nobody scores while hiding the one someone wants. That is also why
 * the scoring bay's new rule falls back to `rec`: on a cold load there is no
 * first key to take.
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
      {/* Full width above the pair, not a third column — see the note above. */}
      <div className="md:col-span-2">
        <RuleBay
          label="League size"
          empty="Any size. Add a rule to narrow by how many teams a league holds."
          rules={draft.size}
          onChange={(size) => onChange({ ...draft, size })}
          keyOptions={SIZE_KEYS.map((option) => ({
            value: option.key,
            label: option.label,
            hint: option.hint,
          }))}
          newRule={{ key: "teams", op: "eq", value: 12 }}
          presets={SIZE_PRESETS}
          step={1}
          leagues={leagues}
          match={matchesSizeRule}
        />
      </div>

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
