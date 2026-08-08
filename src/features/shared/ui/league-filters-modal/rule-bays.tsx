import {
  type LeagueFilters,
  SLOT_GROUPS,
  TEAMS_KEY,
  matchesScoringRule,
  matchesSettingRule,
  matchesSlotRule,
  scoringKeyLabel,
  settingKeyLabel,
} from "../../league-filters";
import { SETTING_KEY_BY_KEY } from "../../league-filters";
import type { ManagerLeague } from "@/shared/manager";

import {
  SCORING_PRESETS,
  SETTING_PRESETS,
  SLOT_PRESETS,
} from "./league-filters-modal.constants.ts";
import { RuleBay } from "./rule-bay.tsx";

/**
 * The three lists a reader writes: how a league is configured, what its lineup
 * starts, and what its scoring pays.
 *
 * The two big ones are side by side as equal bays rather than stacked, which is
 * the layout decision the whole panel is arranged around — stacked, they fell
 * below a 60vh scroll box and the feature read as missing. **Where there is no
 * room to put them side by side they stack anyway**, which is what the container
 * query below is for: the ADP drawer draws this panel at ~450px, and a bay that
 * insisted on its pair there would be the same failure spelled the other way.
 *
 * **Settings leads, full width, and is not a third equal bay.** It was `League
 * size`, holding one key, and it led for a smaller reason then: one key and one
 * number would have been half a column of air beside a scoring bay carrying six
 * rules. It now earns the width outright — it is the bay with a dozen keys, the
 * one a reader will build three rules in, and the one whose rows are widest
 * (a named value, or a sentinel key beside a number field). A rule row at a
 * third of the panel could not hold `Trade deadline · ≥ · 13 · No deadline · 71
 * · ×` without truncating the key it is named by. The order the panel reads top
 * to bottom is unchanged: what a league *is*, how it is set up, what it starts,
 * what it pays.
 *
 * The three are one component apiece and differ only in what they are handed.
 * The slot keys are a fixed table (`SLOT_GROUPS`, predicates derived from the
 * solver's own slot vocabulary, so a new flex counts the moment the solver
 * learns it); the settings and scoring keys are read off the leagues in hand,
 * because how a league is configured and what it pays for are house rules and a
 * fixed list would offer keys nobody sets while hiding the one someone wants.
 * That is also why the scoring bay's new rule falls back to `rec`: on a cold
 * load there is no first key to take. The settings bay needs no such fallback —
 * `teams` is not in the blob, so `settingKeyOptions` always offers it.
 */
export function RuleBays({
  draft,
  onChange,
  leagues,
  scoringKeys,
  settingKeys,
}: {
  draft: LeagueFilters;
  onChange: (filters: LeagueFilters) => void;
  leagues: readonly ManagerLeague[];
  /** The scoring vocabulary these leagues actually pay for. */
  scoringKeys: string[];
  /** The settings vocabulary these leagues actually carry. */
  settingKeys: string[];
}) {
  return (
    // A bare `@container` wrapper, so the pair splits on **this box's** width
    // rather than the viewport's. It was `md:` (768px of screen), which is the
    // right answer in a 1000px dialog and the wrong one in a 32rem ADP drawer on
    // the same laptop — two rule rows in ~215px each, every key menu truncated.
    // `@2xl` is 42rem, which reproduces where `md:` used to fire inside the
    // dialog (its left column is ~696px at that viewport, ~744px once the match
    // rail steps beside it) and never fires in the drawer.
    <div className="@container">
      <div className="grid gap-4 @2xl:grid-cols-2">
        {/* Full width above the pair, not a third column — see the note above. */}
        <div className="@2xl:col-span-2">
          <RuleBay
            label="Settings"
            empty="Any settings. Add a rule to narrow by how a league is set up."
            rules={draft.settings}
            onChange={(settings) => onChange({ ...draft, settings })}
            keyOptions={settingKeys.map((key) => ({
              value: key,
              label: settingKeyLabel(key),
              hint: SETTING_KEY_BY_KEY.get(key)?.hint,
            }))}
            newRule={{ key: TEAMS_KEY, op: "eq", value: 12 }}
            presets={SETTING_PRESETS}
            step={1}
            leagues={leagues}
            match={matchesSettingRule}
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
          // `Scoring` rather than `Scoring settings`, which is one word doing two
          // jobs beside a bay now called Settings.
          label="Scoring"
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
    </div>
  );
}
