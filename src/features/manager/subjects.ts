import type { LeaguemateView, ManagerLeague, PlayerSummary } from "./types";

/**
 * Narrowing the league list by *who is in a league* — a player on the manager's
 * roster there, or a leaguemate they share it with.
 *
 * **This is a set of subjects, not a list of rules, and that is why it is here
 * rather than in `features/shared/league-filters`.** Every filter in that package
 * is a key, a comparison and a number read off the league's own settings, and its
 * predicate is the same one the trades board runs over a whole season. Holding a
 * player is `rosters[league_id]` and sharing a league is `members[league_id]` —
 * lookups a `ManagerLeague` does not carry and a trades reader has no account to
 * build. So this narrows *after* `matchesFilters`, in `useFilteredLeagues`, where
 * both maps are in hand, and `features/shared` stays free of anything only a
 * manager page can answer.
 *
 * Pure, and beside `shares` and `leaguemates` for the same reason: what counts as
 * "in this league" is a rule worth reading and testing without a fetch behind it.
 * Everything from `./types` arrives as an erased `import type`.
 */

export type SubjectKind = "player" | "leaguemate";

/** One thing being asked about: a Sleeper player id, or a Sleeper user id. */
export type Subject = { kind: SubjectKind; id: string };

/**
 * Whether every subject has to be present or only one of them.
 *
 * The league rules are AND-only on purpose — each narrows on an *attribute*, and
 * "dynasty leagues that start two QBs" is the question people arrive with. These
 * are subjects, where "Bijan **or** Chase" is asked as often as "both", which is
 * the same case the trades selection makes. One mode over the whole selection
 * rather than one per kind: "all of these players, any of these managers" is a
 * sentence nobody can read off a filter bar.
 */
export type SubjectMatch = "all" | "any";

export type SubjectFilters = {
  subjects: readonly Subject[];
  match: SubjectMatch;
};

/** Every filter narrows, so the default mode is `all` — as the trades board's is. */
export const DEFAULT_SUBJECT_FILTERS: SubjectFilters = {
  subjects: [],
  match: "all",
};

/**
 * The two membership maps, exactly as the `players` and `leaguemates` routes send
 * them: league id → the ids in it.
 *
 * A league *absent* from a map is one whose rosters or member list the leagues
 * sync hasn't written — which is not the same as a league holding nobody, and the
 * difference is the whole of {@link holdsSubject}'s null.
 */
export type SubjectIndex = {
  /** League id → the player ids on the manager's roster there. */
  rosters: Record<string, readonly string[]>;
  /** League id → the user ids in that league's member list. */
  members: Record<string, readonly string[]>;
};

export const EMPTY_SUBJECT_INDEX: SubjectIndex = { rosters: {}, members: {} };

/** A stable identity for a subject — two kinds share an id space at their peril. */
export function subjectKey(subject: Subject): string {
  return `${subject.kind}:${subject.id}`;
}

/**
 * Whether a league holds this subject, or null when it can't be known.
 *
 * Null and false are different answers, and keeping them apart is the same rule
 * `slotCount` keeps: a league whose rosters were never synced is not evidence
 * that a player is absent from it. A rule against an unknown league *fails*
 * rather than passing on an assumed empty — the honest reading, since the
 * question asked was "does this league hold him" and the answer is "we don't
 * know".
 *
 * A league that is present and empty is a real answer: a pre-draft roster holds
 * nobody, which is exactly what {@link playerShares} counts around.
 */
export function holdsSubject(
  leagueId: string,
  subject: Subject,
  index: SubjectIndex,
): boolean | null {
  const ids =
    subject.kind === "player" ? index.rosters[leagueId] : index.members[leagueId];
  if (!ids) return null;
  // A linear scan rather than a prebuilt set: this runs once per league per
  // subject over a hundred-odd leagues holding ~30 ids each, and a selection is
  // one or two names. Building a set per call would cost more than it saves.
  for (const id of ids) if (id === subject.id) return true;
  return false;
}

/**
 * Whether a league passes the subject selection.
 *
 * An empty selection passes everything, so the caller never has to ask whether
 * one is set before applying it.
 */
export function matchesSubjects(
  leagueId: string,
  filters: SubjectFilters,
  index: SubjectIndex,
): boolean {
  if (filters.subjects.length === 0) return true;
  if (filters.match === "any") {
    for (const subject of filters.subjects) {
      if (holdsSubject(leagueId, subject, index) === true) return true;
    }
    return false;
  }
  for (const subject of filters.subjects) {
    if (holdsSubject(leagueId, subject, index) !== true) return false;
  }
  return true;
}

/** Whether this subject is already selected. */
export function hasSubject(filters: SubjectFilters, subject: Subject): boolean {
  const key = subjectKey(subject);
  return filters.subjects.some((s) => subjectKey(s) === key);
}

/**
 * Add a subject, or remove it if it is already selected — one gesture, since the
 * search panel's result rows double as the way back off a selection.
 */
export function toggleSubject(
  filters: SubjectFilters,
  subject: Subject,
): SubjectFilters {
  const key = subjectKey(subject);
  const without = filters.subjects.filter((s) => subjectKey(s) !== key);
  return {
    ...filters,
    subjects:
      without.length === filters.subjects.length
        ? [...filters.subjects, subject]
        : without,
  };
}

/**
 * Drop the subject at a position.
 *
 * By position rather than by value for the reason `clearFilter` addresses a rule
 * that way: the tokens are drawn in order and a reader dismissing the second one
 * means *that* one, whatever it holds.
 */
export function removeSubjectAt(
  filters: SubjectFilters,
  index: number,
): SubjectFilters {
  return { ...filters, subjects: filters.subjects.filter((_, i) => i !== index) };
}

/** One row of the search panel: what it is, what it says, and what it would leave. */
export type SubjectOption = {
  subject: Subject;
  /** Falls back to the id, as the roster and standings views do. */
  name: string;
  /** The dim trailing detail — an NFL team on a player, nothing on a person. */
  note: string | null;
  /** A player's position, for the pill; null on a person. */
  position: string | null;
  avatarUrl: string | null;
  /** How many of the leagues counted over hold this subject. */
  count: number;
};

/**
 * Everything a reader could pick, most-held first.
 *
 * **Counted over the leagues the *other* filters leave, never over the subject
 * selection itself.** Counting over the narrowed list would collapse the menu to
 * what is already picked the moment anything is picked, and there would be no way
 * to widen it again without clearing first — the rule the trades board's facets
 * keep for the same reason.
 *
 * The manager's own id is dropped from the leaguemate half: they are in every
 * league on the list, so an option matching all of them narrows nothing. Its
 * presence in `members` is still what marks a league as cached, which is why the
 * drop happens here rather than in the payload.
 */
export function subjectOptions(
  leagues: readonly ManagerLeague[],
  index: SubjectIndex,
  players: Record<string, PlayerSummary>,
  users: Record<string, LeaguemateView>,
  /** The searched manager's own id — an option nobody can use. */
  selfId: string,
): SubjectOption[] {
  const counts = new Map<string, { subject: Subject; count: number }>();

  const tally = (kind: SubjectKind, ids: readonly string[] | undefined) => {
    if (!ids) return;
    // A league can list an id twice — a duplicate on a roster, a doubled member
    // row — and a subject held twice in one league is still one league.
    const seen = new Set<string>();
    for (const id of ids) {
      // Sleeper pads roster slots with an empty id or a literal "0".
      if (!id || id === "0" || seen.has(id)) continue;
      if (kind === "leaguemate" && id === selfId) continue;
      seen.add(id);
      const key = `${kind}:${id}`;
      const entry = counts.get(key);
      if (entry) entry.count += 1;
      else counts.set(key, { subject: { kind, id }, count: 1 });
    }
  };

  for (const league of leagues) {
    tally("player", index.rosters[league.league_id]);
    tally("leaguemate", index.members[league.league_id]);
  }

  const options: SubjectOption[] = [];
  for (const { subject, count } of counts.values()) {
    if (subject.kind === "player") {
      const player = players[subject.id];
      options.push({
        subject,
        name: player?.name ?? subject.id,
        note: player?.team ?? null,
        position: player?.position ?? null,
        avatarUrl: null,
        count,
      });
    } else {
      const user = users[subject.id];
      options.push({
        subject,
        name: user?.display_name || subject.id,
        note: null,
        position: null,
        avatarUrl: user?.avatar_url ?? null,
        count,
      });
    }
  }

  // Most-held first, ties broken by name so the order is stable between renders.
  options.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  return options;
}

/**
 * The options a query matches, best first, capped.
 *
 * Prefix matches lead, because someone typing "cha" means Chase before they mean
 * Christian McCaffrey — but a word-start match anywhere in the name counts as a
 * prefix, or a surname would be unreachable without the first name. Everything
 * else that contains the query follows in the input's own most-held-first order.
 *
 * The cap is what keeps an empty query from rendering several hundred rows into a
 * floating panel; an empty query is a real state here, since opening the panel
 * with nothing typed should still show the players held in the most leagues.
 */
export function searchSubjects(
  options: readonly SubjectOption[],
  query: string,
  limit: number,
): SubjectOption[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return options.slice(0, limit);

  const leading: SubjectOption[] = [];
  const rest: SubjectOption[] = [];
  for (const option of options) {
    const name = option.name.toLowerCase();
    const at = name.indexOf(needle);
    if (at < 0) continue;
    // Start of the name, or the start of any word in it.
    if (at === 0 || name[at - 1] === " " || name[at - 1] === ".") leading.push(option);
    else rest.push(option);
    if (leading.length >= limit) break;
  }
  return [...leading, ...rest].slice(0, limit);
}

/**
 * The selection in words, for the plate's scope line — `owns bijan robinson`,
 * `with @jkap86`, `any of 3 players`.
 *
 * Lower case, because it reads mid-sentence beside the league filters' own
 * summary ("counting dynasty · owns bijan robinson"), which is the rule
 * `activeFilters` already keeps.
 *
 * A long selection is summarised by *count* rather than spelled out: the line
 * shares a plate with the record it qualifies, and four names is a wrap. Which
 * names those are is on the tokens in the rail, a few pixels below.
 */
export function subjectSummary(
  filters: SubjectFilters,
  /**
   * What a subject is called, or null while the rosters and member lists that
   * name it are still being read.
   *
   * Null falls through to the counted form rather than printing a raw Sleeper
   * id: the line sits on the plate beside the record it qualifies, and "owns
   * 4034" is worse than "1 player" at saying what the number was counted over.
   */
  label: (subject: Subject) => string | null,
): string | null {
  const { subjects, match } = filters;
  if (subjects.length === 0) return null;

  if (subjects.length === 1) {
    const [only] = subjects;
    const name = label(only);
    if (name) {
      return `${only.kind === "player" ? "owns" : "with"} ${name.toLowerCase()}`;
    }
    return only.kind === "player" ? "1 player" : "1 leaguemate";
  }

  const players = subjects.filter((s) => s.kind === "player").length;
  const mates = subjects.length - players;
  const parts: string[] = [];
  if (players > 0) parts.push(`${players} player${players === 1 ? "" : "s"}`);
  if (mates > 0) parts.push(`${mates} leaguemate${mates === 1 ? "" : "s"}`);
  return `${match} of ${parts.join(" and ")}`;
}
