"use client";

import { useMemo } from "react";

import { type AdpControls, seedFromLeague } from "../adp-controls";
import type { ManagerLeague } from "../types";

const DRAFT_TYPE_OPTS = [
  { value: "snakelinear", label: "Snake / Linear" },
  { value: "snake", label: "Snake" },
  { value: "linear", label: "Linear" },
  { value: "auction", label: "Auction" },
] as const;

const LEAGUE_TYPE_OPTS = [
  { value: "all", label: "All types" },
  { value: "0", label: "Redraft" },
  { value: "1", label: "Keeper" },
  { value: "2", label: "Dynasty" },
] as const;

const SCORING_OPTS = [
  { value: "all", label: "All scoring" },
  { value: "std", label: "Standard" },
  { value: "half_ppr", label: "Half PPR" },
  { value: "ppr", label: "PPR" },
] as const;

const SUPERFLEX_OPTS = [
  { value: "all", label: "SF & 1QB" },
  { value: "yes", label: "Superflex" },
  { value: "no", label: "1QB" },
] as const;

const BEST_BALL_OPTS = [
  { value: "all", label: "BB & lineup" },
  { value: "no", label: "Lineup" },
  { value: "yes", label: "Best ball" },
] as const;

const ROUNDS_OPTS = [
  { value: "all", label: "All rounds" },
  { value: "rookie", label: "≤5 (rookie)" },
  { value: "full", label: "12+ (startup)" },
] as const;

/**
 * The Players tab's ADP controls: which crawled drafts the column averages over,
 * plus a caption that says so. The bar is fully controlled — every change is an
 * immutable replace of the whole {@link AdpControls} object — so its state lives
 * up in `ManagerPlayers` and survives a background refresh.
 *
 * Season and team size are dropdowns because their options depend on the data
 * (the manager's leagues, the seasons on offer); the fixed enums are dropdowns
 * too, to keep one control language across a wide bar. "Match a league" is an
 * action rather than a selection — it seeds the four league settings from a
 * chosen league and snaps back to its placeholder.
 */
export function AdpFilters({
  controls,
  onChange,
  leagues,
  seasons,
  draftCount,
  loading,
  error,
}: {
  controls: AdpControls;
  onChange: (controls: AdpControls) => void;
  leagues: ManagerLeague[];
  seasons: string[];
  /** Drafts the current filters matched; null while the first board loads. */
  draftCount: number | null;
  loading: boolean;
  error: string | null;
}) {
  // Only the sizes this manager actually plays, so seeding from any of their
  // leagues always lands on a listed option.
  const teamSizes = useMemo(
    () =>
      Array.from(new Set(leagues.map((l) => l.total_rosters))).sort(
        (a, b) => a - b,
      ),
    [leagues],
  );

  const seasonLabel = controls.season === "all" ? "all seasons" : controls.season;

  return (
    <div className="flex flex-col gap-2.5 rounded-xl border border-foreground/10 bg-foreground/[0.02] px-3 py-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-foreground/50">
          ADP
        </span>

        <Field label="Match">
          {/* An action, not a selection: value stays "" so it re-arms after use. */}
          <select
            value=""
            onChange={(e) => {
              const league = leagues.find((l) => l.league_id === e.target.value);
              if (league) onChange(seedFromLeague(controls, league));
            }}
            className={SELECT_CLASS}
            aria-label="Match one of this manager's leagues"
          >
            <option value="" disabled>
              a league…
            </option>
            {leagues.map((league) => (
              <option key={league.league_id} value={league.league_id}>
                {league.name}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Season">
          <select
            value={controls.season}
            onChange={(e) => onChange({ ...controls, season: e.target.value })}
            className={SELECT_CLASS}
          >
            {seasons.map((season) => (
              <option key={season} value={season}>
                {season === "all" ? "All seasons" : season}
              </option>
            ))}
          </select>
        </Field>

        <EnumField
          label="Draft"
          value={controls.draftType}
          options={DRAFT_TYPE_OPTS}
          onChange={(draftType) => onChange({ ...controls, draftType })}
        />
        <EnumField
          label="Rounds"
          value={controls.rounds}
          options={ROUNDS_OPTS}
          onChange={(rounds) => onChange({ ...controls, rounds })}
        />
        <EnumField
          label="Type"
          value={controls.leagueType}
          options={LEAGUE_TYPE_OPTS}
          onChange={(leagueType) => onChange({ ...controls, leagueType })}
        />
        <EnumField
          label="Scoring"
          value={controls.scoring}
          options={SCORING_OPTS}
          onChange={(scoring) => onChange({ ...controls, scoring })}
        />
        <EnumField
          label="QBs"
          value={controls.superflex}
          options={SUPERFLEX_OPTS}
          onChange={(superflex) => onChange({ ...controls, superflex })}
        />
        <EnumField
          label="Format"
          value={controls.bestBall}
          options={BEST_BALL_OPTS}
          onChange={(bestBall) => onChange({ ...controls, bestBall })}
        />

        <Field label="Teams">
          <select
            value={controls.teams}
            onChange={(e) => onChange({ ...controls, teams: e.target.value })}
            className={SELECT_CLASS}
          >
            <option value="all">All sizes</option>
            {teamSizes.map((size) => (
              <option key={size} value={String(size)}>
                {size} teams
              </option>
            ))}
          </select>
        </Field>
      </div>

      {/* The ADP is averaged over the drafts this app happens to have crawled, so
          it describes this database, not the market — said here, right above the
          column, per the same rule that makes a projection ship its horizon. */}
      <p className="text-xs text-foreground/45">
        {error ? (
          <span className="text-amber-300">ADP unavailable — {error}</span>
        ) : draftCount === null ? (
          "Loading ADP…"
        ) : draftCount === 0 ? (
          "No crawled drafts match these filters."
        ) : (
          <>
            Averaged over{" "}
            <b className="font-semibold text-foreground/70">
              {draftCount.toLocaleString()}
            </b>{" "}
            crawled {draftCount === 1 ? "draft" : "drafts"} from {seasonLabel} in
            this app’s data — not market ADP.
            {loading && <span className="text-foreground/35"> Updating…</span>}
          </>
        )}
      </p>
    </div>
  );
}

const SELECT_CLASS =
  "rounded-md border border-foreground/10 bg-foreground/5 px-2 py-1 text-sm text-foreground transition-colors hover:border-foreground/20 focus:border-active/50 focus:outline-none [color-scheme:dark]";

/** A labelled control cell — the label sits to the left of whatever it wraps. */
function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex items-center gap-1.5">
      <span className="text-xs font-medium uppercase tracking-wide text-foreground/40">
        {label}
      </span>
      {children}
    </label>
  );
}

/** A {@link Field} wrapping a select over a fixed set of string options. */
function EnumField<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <Field label={label}>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        className={SELECT_CLASS}
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </Field>
  );
}
