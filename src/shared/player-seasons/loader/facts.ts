import type { CompPlayerFacts } from "@/shared/contract";

/**
 * A player's age, experience and draft slot **at a past season**, derived from
 * the stored Sleeper players map.
 *
 * The map is Sleeper's *current* players and every dated field on it is
 * current too, so none of the three can be read off it directly; each is a
 * derivation, and each has a failure mode the loader would otherwise write
 * into a NOT NULL column and never mention again. Pure, with the record as an
 * argument, so all four arms are testable without a database.
 *
 * **Age is exact and the others are not.** A birth date and a season give an
 * age to the day; everything below is about the two that do not.
 */

/** What the loader reads off one row of the players map. */
export type PlayerRecord = {
  player_id: string;
  name: string | null;
  position: string | null;
  /** `YYYY-MM-DD` where Sleeper has one. */
  birth_date: string | null;
  /** `metadata.rookie_year`, where Sleeper has one. */
  rookie_year: number | null;
  /** Sleeper's *current* years of experience. */
  years_exp: number | null;
  /** Overall NFL draft pick, where any source could supply one. */
  draft_pick: number | null;
};

/** How the experience figure was arrived at, for the load report. */
export type ExperienceBasis = "rookie_year" | "years_exp";

export type FactsResolution =
  | { ok: true; facts: CompPlayerFacts; basis: ExperienceBasis }
  | { ok: false; reason: string };

/**
 * The instant a season's age is measured at.
 *
 * The first of September: near enough to every season's opening week that the
 * figure matches the age a reader would say the player "was" that year, and
 * fixed rather than read off a schedule so two loads of the same season cannot
 * disagree by a few days of kickoff drift.
 */
function seasonInstant(season: number): number {
  return Date.UTC(season, 8, 1);
}

/**
 * A player's facts at a season, or the reason he cannot be written.
 *
 * **A row that cannot be resolved is skipped and counted, never defaulted.**
 * `age` and `experience` are NOT NULL columns and there is no honest zero for
 * either: an age of 0 is a claim and an experience of 0 says "rookie", which
 * is a specific and checkable falsehood about a nine-year veteran. The
 * loader's report names how many were skipped and why, which is what makes a
 * thin season visible instead of merely small.
 */
export function playerFactsAt(
  record: PlayerRecord,
  season: number,
  /** The season the players map currently describes — `years_exp`'s baseline. */
  currentSeason: number,
): FactsResolution {
  const age = ageAt(record.birth_date, season);
  if (age === null) {
    return { ok: false, reason: "no birth date on the players map" };
  }

  const experience = experienceAt(record, season, currentSeason);
  if (experience === null) {
    return { ok: false, reason: "no rookie year or usable experience on the players map" };
  }

  return {
    ok: true,
    facts: { age: age.value, exp: experience.value, draft: draftPick(record) },
    basis: experience.basis,
  };
}

/** Age in years to one decimal at the season's instant, or null. */
export function ageAt(birthDate: string | null, season: number): { value: number } | null {
  if (!birthDate || !/^\d{4}-\d{2}-\d{2}/.test(birthDate)) return null;
  const born = Date.parse(`${birthDate.slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(born)) return null;
  const years = (seasonInstant(season) - born) / (365.25 * 24 * 60 * 60 * 1000);
  // A negative or implausible age is a bad birth date rather than a young
  // player, and the column would carry it forever.
  if (!(years > 15) || years > 60) return null;
  return { value: Math.round(years * 10) / 10 };
}

/**
 * Seasons of experience entering `season`, and which reading answered.
 *
 * **`rookie_year` first, because it is exact**: it names the year the player
 * entered, so the arithmetic is a subtraction with nothing to drift. It is the
 * same field the shares drawer dates a draft class by, for the same reason.
 *
 * **`years_exp` second, and it is a derivation with a known failure mode.**
 * Sleeper's figure is current, so experience at a past season is it less the
 * years since — which is right for a player who has played every year and
 * wrong by a season for one who missed a whole year, because Sleeper does not
 * increment it for a season nobody played. The repo's usual call on a
 * derivation like this is to decline it (`PlayerShareSummary.draft_class`
 * refuses exactly this fallback), and that call is right for a UI column where
 * the alternative is an em dash. Here the alternative is dropping the row from
 * the corpus entirely, which costs the comparison a player rather than a cell,
 * so the derivation is taken — and the loader reports how many rows leaned on
 * it, so a corpus mostly built this way is visible rather than assumed.
 */
export function experienceAt(
  record: PlayerRecord,
  season: number,
  currentSeason: number,
): { value: number; basis: ExperienceBasis } | null {
  if (
    record.rookie_year !== null &&
    Number.isInteger(record.rookie_year) &&
    record.rookie_year >= 1930
  ) {
    const value = season - record.rookie_year;
    if (value >= 0 && value <= 30) return { value, basis: "rookie_year" };
  }

  if (record.years_exp !== null && Number.isInteger(record.years_exp)) {
    const value = record.years_exp - (currentSeason - season);
    if (value >= 0 && value <= 30) return { value, basis: "years_exp" };
  }

  return null;
}

/**
 * The overall draft pick, or null.
 *
 * **Null is the ordinary answer under the Sleeper source**, and the difference
 * between that and "undrafted" is the one thing about this column worth
 * knowing. `/v1/players/nfl` does not publish an NFL draft position, so the
 * loader has nowhere to read one from and writes null — which the distance
 * reads as {@link UDFA_PICK}, "after everyone".
 *
 * The consequence is not a wrong ranking: with every row null the criterion is
 * a constant, so its z-gap is zero for every candidate and it orders nothing.
 * It is a criterion that quietly stops discriminating, which is why the
 * loader's report names the fill rate rather than leaving it to be discovered.
 * A source that does publish draft capital — nflverse's own ids file carries
 * `draft_ovr` beside a `sleeper_id` — fills this column with no other change,
 * which is why it is read here rather than hard-coded to null.
 */
export function draftPick(record: PlayerRecord): number | null {
  const pick = record.draft_pick;
  if (pick === null || !Number.isInteger(pick)) return null;
  if (pick < 1 || pick > 500) return null;
  return pick;
}
