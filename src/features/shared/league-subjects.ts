/**
 * The second narrowing on a league grid: a set of *subjects* — the players and
 * the people the reader picked out of a shares drawer — and the mode that
 * combines them.
 *
 * It sits beside `matchesFilters` rather than inside it, because the two are
 * different kinds of question and are answered from different data. A league
 * filter reads what a league *is*, off blobs the league itself carries; a
 * subject reads *who is in it*, off maps that arrive from separate reads and may
 * not have arrived at all.
 *
 * **It moved here from `features/manager` when the lineup checker grew drawers
 * of its own** — the line `CONSOLE_KEY`, `ManagerPlate` and `LineupColumnsDialog`
 * all moved on, and the same folder rule: a second feature reads it, and
 * `features/lineupchecker` may not import from `features/manager`.
 *
 * Pure and type-free of the contract, so it resolves under Node's test runner.
 */

/**
 * Which panel a subject was picked in, which is also which population answers
 * for it.
 *
 * **One union for the four panels, and it is the exhaustive seam.**
 * `SHARES_COLUMNS_BY_KIND` is a `Record` over it, so a fifth panel does not
 * compile until it has been given columns — and {@link matchesSubjects} takes
 * its maps through a resolver keyed on it, so a fifth panel does not narrow
 * until it has been given a population either. The two halves cannot drift.
 *
 * `player` and `leaguemate` are a season's — who the manager rosters, and who
 * they play against — where `starter` and `opponent` are one *week's*: the
 * players on their own lineups, and the players on the lineups facing them.
 */
export type SubjectKind = "player" | "leaguemate" | "starter" | "opponent";

/** One thing the reader picked. `kind` is what says which map answers for it. */
export type Subject = { kind: SubjectKind; id: string };

/**
 * The maps a narrowing reads, one per kind — league id to the ids that league
 * holds — or **null for a map that has not arrived**, which is a third state
 * and not an empty one. See {@link matchesSubjects}.
 *
 * A resolver rather than one argument per kind, which is what the two callers
 * made necessary and what keeps this module honest: a page answers for the
 * kinds its own drawers pick and returns null for the rest, so adding a panel
 * costs a case here and nothing at every call site.
 */
export type SubjectRolls = (
  kind: SubjectKind,
) => Record<string, readonly string[]> | null;

/**
 * `all` narrows to leagues holding **every** subject, `any` to leagues holding
 * at least one. Two modes rather than one because they answer opposite
 * questions: "where do I have both of these players" and "where do I have
 * either".
 */
export type SubjectMatch = "all" | "any";

export type LeagueSubjects = {
  subjects: Subject[];
  match: SubjectMatch;
};

/** Nothing picked. `all` is the resting mode: with one subject the two agree. */
export const NO_SUBJECTS: LeagueSubjects = { subjects: [], match: "all" };

/** A subject's identity across the two kinds — a player and a user could share an id. */
export function subjectKey(subject: Subject): string {
  return `${subject.kind}:${subject.id}`;
}

export function subjectCount(state: LeagueSubjects): number {
  return state.subjects.length;
}

/** Add the subject, or remove it if it is already picked. */
export function toggleSubject(
  state: LeagueSubjects,
  subject: Subject,
): LeagueSubjects {
  const key = subjectKey(subject);
  const without = state.subjects.filter((s) => subjectKey(s) !== key);
  return {
    ...state,
    subjects:
      without.length === state.subjects.length
        ? [...state.subjects, subject]
        : without,
  };
}

export function removeSubject(
  state: LeagueSubjects,
  subject: Subject,
): LeagueSubjects {
  const key = subjectKey(subject);
  return { ...state, subjects: state.subjects.filter((s) => subjectKey(s) !== key) };
}

/**
 * Whether one league holds a subject — or `null` where the map that would
 * answer has not arrived.
 *
 * The three states matter: false is "this league does not hold them", null is
 * "nothing here can say". See {@link matchesSubjects} for what null does.
 */
function holds(
  leagueId: string,
  subject: Subject,
  rolls: SubjectRolls,
): boolean | null {
  const map = rolls(subject.kind);
  if (!map) return null;
  const roll = map[leagueId];
  // A stored map with no row for this league *can* answer: it does not hold
  // them. Only a missing map is unanswerable.
  if (!roll) return false;
  // `""` and `"0"` are Sleeper's roster padding and can never equal a real
  // subject id, so no extra guard is needed here — but a subject id of `""`
  // would match them, which is why one is never built from a blank.
  return Boolean(subject.id) && roll.includes(subject.id);
}

/**
 * Whether a league survives the current selection.
 *
 * **No subjects passes every league.** An empty selection is not a narrowing
 * that matches nothing; it is the absence of one.
 *
 * **A subject whose map has not arrived is ignored rather than failed.** Both
 * alternatives lie: failing it closed empties the grid the moment a payload is
 * slow, and failing the whole predicate open would leave a lit token above a
 * list it did not narrow. Ignoring it is the only reading that matches what is
 * on screen — and it is reachable for a frame at most, because the drawer that
 * picks a subject is also what fetches the map, and the selection resets during
 * render when the manager changes.
 *
 * If *every* picked subject is unanswerable the league passes, which is the
 * same rule stated once rather than a special case.
 */
export function matchesSubjects(
  leagueId: string,
  state: LeagueSubjects,
  rolls: SubjectRolls,
): boolean {
  if (state.subjects.length === 0) return true;

  let answered = 0;
  let matched = 0;
  for (const subject of state.subjects) {
    const held = holds(leagueId, subject, rolls);
    if (held === null) continue;
    answered++;
    if (held) matched++;
  }

  if (answered === 0) return true;
  return state.match === "all" ? matched === answered : matched > 0;
}
