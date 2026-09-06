/**
 * Folding Sleeper's weekly stat rows into one season line per player.
 *
 * **Weekly rather than a season endpoint, and that is a deliberate narrowing
 * to what this repo has verified.** `shared/projections/ros-read` fetches
 * `api.sleeper.com/projections/nfl/<season>/<week>?season_type=regular`, and
 * `SleeperProjection`'s own doc says the same endpoint shape is used for
 * actual stats. So the loader mirrors that path exactly and sums the weeks,
 * which is the same arrangement `projections/aggregate` already argues for:
 * sum stat lines, then derive once — the arithmetic is linear, so it is exact.
 * A season-total endpoint may well exist; taking one on faith is how a loader
 * ends up parsing a shape nobody checked.
 *
 * **Every field is read defensively.** The data host promises nothing about
 * its shape — the rule `SleeperScoreGame` states at length — so an
 * unrecognisable value reads as absent rather than as a zero, and the whole
 * fold is pure so the reading of every key is testable against a fixture.
 *
 * Three derivations are worth knowing about before a number off this is
 * trusted:
 *
 * - **Target share is the player's share of his team's targets in the weeks he
 *   appeared**, not across the whole season. Sleeper publishes no team target
 *   total, so the denominator is built here by summing every player's targets
 *   within a team-week — which is exactly the number, and which is only
 *   available for the weeks the player has a row in. Season-long is the more
 *   conventional definition and is the wrong one for a comp: a receiver who
 *   played eight games would read at half his actual role, and `gp` is a
 *   criterion of its own for a reader who cares about the games.
 * - **Snap share is the same shape**: offensive snaps over the team's, summed
 *   across the weeks he appeared. Null where Sleeper does not carry the team
 *   figure, never zero.
 * - **Yards per route run is null, always, under this source.** Routes run is
 *   not published by Sleeper at any grain, and there is nothing here to derive
 *   it from. It is left null rather than approximated, which is the column's
 *   own documented rule — and it is the reason weighted coverage exists: a
 *   criterion the corpus cannot answer narrows the comparison rather than
 *   silently scoring as a zero.
 */

/** The subset of a Sleeper stat row this reads. Everything is optional. */
export type SleeperStatRow = {
  player_id?: string | null;
  team?: string | null;
  stats?: Record<string, unknown> | null;
  player?: Record<string, unknown> | null;
};

/** One week of the season, as fetched. */
export type WeekStats = {
  week: number;
  rows: readonly SleeperStatRow[];
};

/**
 * The three fantasy bases Sleeper publishes, and the key each is under.
 *
 * A corpus is on **one** of them for the whole table, stated in its metadata —
 * see the migration. Half-PPR is the default because it is the sample corpus's
 * basis and the middle of the three, so a reader who never chooses is not
 * shown a board tuned to a format they do not play.
 */
export const SCORING_KEYS = {
  half_ppr: "pts_half_ppr",
  ppr: "pts_ppr",
  std: "pts_std",
} as const;

export type CompsScoring = keyof typeof SCORING_KEYS;

export const DEFAULT_SCORING: CompsScoring = "half_ppr";

export function isCompsScoring(value: string): value is CompsScoring {
  return Object.prototype.hasOwnProperty.call(SCORING_KEYS, value);
}

/** One player's season, summed from his weeks. */
export type SeasonAggregate = {
  player_id: string;
  /** The last team he recorded a row for, which is the row's attribution. */
  team: string | null;
  /** The position the feed inlined, where it did. The players map wins. */
  position: string | null;
  /** The name the feed inlined, where it did. The players map wins. */
  name: string | null;
  games: number;
  fantasy_pts: number;
  rec: number;
  rec_yards: number;
  rush_yards: number;
  rush_att: number;
  targets: number;
  /** Null where Sleeper carried no team total in any of his weeks. */
  target_share: number | null;
  /** Null where Sleeper carried no team snap total in any of his weeks. */
  snap_share: number | null;
};

/**
 * A finite number off an untyped blob, or null.
 *
 * Numeric strings are accepted because the data host has been seen to send
 * both; anything else — a boolean, an object, `"—"` — is absent, never zero.
 */
export function statNumber(stats: Record<string, unknown> | null | undefined, key: string): number | null {
  if (!stats) return null;
  const raw = stats[key];
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (typeof raw === "string" && raw.trim() !== "") {
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/** The name the stats feed inlines on a row, in whichever shape it carries. */
function inlineName(player: Record<string, unknown> | null | undefined): string | null {
  const full = stringField(player, "full_name");
  if (full) return full;
  const parts = [stringField(player, "first_name"), stringField(player, "last_name")]
    .filter((part): part is string => part !== null)
    .join(" ");
  return parts === "" ? null : parts;
}

function stringField(source: Record<string, unknown> | null | undefined, key: string): string | null {
  if (!source) return null;
  const raw = source[key];
  return typeof raw === "string" && raw.trim() !== "" ? raw.trim() : null;
}

type Running = {
  team: string | null;
  position: string | null;
  name: string | null;
  games: number;
  fantasy_pts: number;
  rec: number;
  rec_yards: number;
  rush_yards: number;
  rush_att: number;
  targets: number;
  teamTargets: number;
  teamTargetWeeks: number;
  offSnaps: number;
  teamOffSnaps: number;
};

/**
 * Every player's season, folded from the weeks given.
 *
 * A week with no rows contributes nothing rather than zeroing anybody — a
 * fetch that came back empty is not a week in which nobody played, and the
 * caller decides whether an empty week is a failure worth refusing the season
 * over.
 */
export function foldSeasonStats(
  weeks: readonly WeekStats[],
  scoring: CompsScoring = DEFAULT_SCORING,
): SeasonAggregate[] {
  const pointsKey = SCORING_KEYS[scoring];
  const running = new Map<string, Running>();

  for (const week of weeks) {
    // The denominator target share needs, built from the same rows: a team's
    // targets that week are every target its players recorded.
    const teamTargets = new Map<string, number>();
    const teamSnaps = new Map<string, number>();
    for (const row of week.rows) {
      const team = row.team?.trim() || null;
      if (!team) continue;
      const targets = statNumber(row.stats, "rec_tgt");
      if (targets !== null && targets > 0) {
        teamTargets.set(team, (teamTargets.get(team) ?? 0) + targets);
      }
      // Sleeper carries the team's offensive snap count on each player's row;
      // any one of them is the whole answer, so this is a max rather than a
      // sum — summing would multiply it by the size of the offence.
      const teamOff = statNumber(row.stats, "tm_off_snp");
      if (teamOff !== null && teamOff > 0) {
        teamSnaps.set(team, Math.max(teamSnaps.get(team) ?? 0, teamOff));
      }
    }

    for (const row of week.rows) {
      const id = row.player_id?.trim();
      if (!id) continue;
      const stats = row.stats ?? null;

      const entry = running.get(id) ?? blank();
      running.set(id, entry);

      const team = row.team?.trim() || null;
      if (team) entry.team = team;
      entry.position ??= stringField(row.player, "position");
      entry.name ??= inlineName(row.player);

      const targets = statNumber(stats, "rec_tgt") ?? 0;
      const rec = statNumber(stats, "rec") ?? 0;
      const recYards = statNumber(stats, "rec_yd") ?? 0;
      const rushYards = statNumber(stats, "rush_yd") ?? 0;
      const rushAtt = statNumber(stats, "rush_att") ?? 0;
      const points = statNumber(stats, pointsKey) ?? 0;
      const offSnaps = statNumber(stats, "off_snp");

      // A week is played when Sleeper says so, and otherwise when the row
      // shows any activity at all — a `gp` this feed omits must not turn a
      // real season into zero games, which would divide a points-per-game by
      // nothing.
      const gp = statNumber(stats, "gp");
      const active =
        gp !== null
          ? gp
          : (offSnaps ?? 0) > 0 || targets > 0 || rushAtt > 0 || points !== 0
            ? 1
            : 0;

      entry.games += active;
      entry.fantasy_pts += points;
      entry.rec += rec;
      entry.rec_yards += recYards;
      entry.rush_yards += rushYards;
      entry.rush_att += rushAtt;
      entry.targets += targets;

      if (team) {
        const weekTeamTargets = teamTargets.get(team);
        if (weekTeamTargets !== undefined && weekTeamTargets > 0) {
          entry.teamTargets += weekTeamTargets;
          entry.teamTargetWeeks++;
        }
        const weekTeamSnaps = teamSnaps.get(team);
        if (weekTeamSnaps !== undefined && weekTeamSnaps > 0 && offSnaps !== null) {
          entry.offSnaps += offSnaps;
          entry.teamOffSnaps += weekTeamSnaps;
        }
      }
    }
  }

  const out: SeasonAggregate[] = [];
  for (const [player_id, entry] of running) {
    out.push({
      player_id,
      team: entry.team,
      position: entry.position,
      name: entry.name,
      games: entry.games,
      fantasy_pts: round(entry.fantasy_pts, 1),
      rec: Math.round(entry.rec),
      rec_yards: Math.round(entry.rec_yards),
      rush_yards: Math.round(entry.rush_yards),
      rush_att: Math.round(entry.rush_att),
      targets: Math.round(entry.targets),
      target_share:
        entry.teamTargetWeeks > 0 && entry.teamTargets > 0
          ? round((entry.targets / entry.teamTargets) * 100, 2)
          : null,
      snap_share:
        entry.teamOffSnaps > 0
          ? round(Math.min(100, (entry.offSnaps / entry.teamOffSnaps) * 100), 2)
          : null,
    });
  }
  out.sort((a, b) => b.fantasy_pts - a.fantasy_pts || a.player_id.localeCompare(b.player_id));
  return out;
}

/** Points per game, on the corpus's rule that zero games is not a divisor. */
export function pointsPerGame(points: number, games: number): number {
  if (games <= 0) return 0;
  return round(points / games, 2);
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function blank(): Running {
  return {
    team: null,
    position: null,
    name: null,
    games: 0,
    fantasy_pts: 0,
    rec: 0,
    rec_yards: 0,
    rush_yards: 0,
    rush_att: 0,
    targets: 0,
    teamTargets: 0,
    teamTargetWeeks: 0,
    offSnaps: 0,
    teamOffSnaps: 0,
  };
}
