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
 * they play against — where `week` is one *week's*: every player either side of
 * the week's games fielded.
 *
 * **`week` used to be two kinds**, `starter` and `opponent`, one per panel: the
 * players on the manager's own lineups and the players on the lineups facing
 * them. The two panels are one panel now, listing every player once with four
 * readings beside him, so two kinds would be two slots for one row — a reader
 * could pick the same player twice and the tray above the grid would name him
 * twice for one narrowing. Which of the four readings a row is narrowed on is
 * {@link Subject.readings}, which is a property of the pick rather than a
 * second kind of thing to pick.
 *
 * `leaguemate-player` is the one that is **not a panel**: it is picked from a
 * chip inside the leaguemate panel's own expanded row, so there is no drawer of
 * that kind and the rack never publishes a key for one. It has an entry in
 * `SHARES_COLUMNS_BY_KIND` all the same, because the seam is the point — the
 * `Record` is what makes a new kind a compile error until somebody has said
 * what a row of it would carry.
 */
export type SubjectKind =
  | "player"
  | "leaguemate"
  | "leaguemate-player"
  | "week";

/**
 * One of the four readings a week row can be narrowed on: which side fielded
 * him, and whether that side started him or sat him.
 *
 * **They are spelled as the four column ids the panel draws**, which is not a
 * coincidence to be tidied away: the tray's four keys *are* the row's four
 * cells, and a reading that named itself differently from the column it lights
 * would be two vocabularies for one fact. `WEEK_READING_COLUMN` in
 * `shares-columns.ts` is the `Record` that ties them, so a rename breaks a
 * compile rather than a cell.
 *
 * It lives here rather than beside those columns because this is the module
 * with no imports — the narrowing has to resolve under Node's test runner, and
 * `shares-columns.ts` is a `"use client"` wrapper over the device store.
 */
export type WeekReading = "start" | "bench" | "opp-start" | "opp-bench";

/** The four, in the order the panel offers them: mine, then theirs. */
export const WEEK_READINGS: readonly WeekReading[] = [
  "start",
  "bench",
  "opp-start",
  "opp-bench",
];

/**
 * Which leagues a *player* pick narrows to, of the three a stored roster set
 * can distinguish.
 *
 * **It lives on the subject rather than beside it**, which is what lets two
 * picks sit on two modes — and what lets the token tray name a narrowing
 * rather than a player. A copy held in the drawer would be a second spelling of
 * one fact, and the drawer is not what the grid reads.
 *
 * `owned` is the resting mode and the one an unmoded subject means: it is the
 * question the panel answered before there were three, so a subject carrying no
 * mode narrows exactly as it always did.
 */
export type SubjectMode = "owned" | "taken" | "available";

/**
 * One thing the reader picked. `kind` is what says which map answers for it,
 * and `mode` — on a `player` alone — which of three readings of that map.
 */
export type Subject = {
  kind: SubjectKind;
  id: string;
  /** Absent is {@link SubjectMode}'s `owned`, and is what every other kind is. */
  mode?: SubjectMode;
  /**
   * Which of a week row's four readings this pick narrows on — **unioned**, and
   * absent or empty meaning the kind's own resting reading.
   *
   * **A list rather than a mode, because these compose and the modes do not.**
   * A player is `owned` or `taken` or `available` and never two at once; a week
   * row's readings are four questions about the same player that a reader picks
   * any of, and the panel's four keys multi-select for exactly that.
   *
   * **Unioned, and that is the only operator with anything to say.** A player
   * sits on one roster per league, so every intersection of two of the four is
   * empty by construction: he is never started *and* benched in one league, and
   * never on his manager's roster *and* the opponent's. An intersecting
   * selection would therefore empty the grid whatever was picked, which is not
   * a narrowing a reader could learn from. See {@link holds}.
   *
   * Empty is the resting reading rather than "nothing matches", which is what
   * makes pressing a row before touching the tray mean what it always meant:
   * the leagues that fielded him at all, either side.
   */
  readings?: readonly WeekReading[];
};

/**
 * The maps a narrowing reads, one per kind — league id to the ids that league
 * holds — or **null for a map that has not arrived**, which is a third state
 * and not an empty one. See {@link matchesSubjects}.
 *
 * A resolver rather than one argument per kind, which is what the two callers
 * made necessary and what keeps this module honest: a page answers for the
 * kinds its own drawers pick and returns null for the rest, so adding a panel
 * costs a case here and nothing at every call site.
 *
 * **The mode is an argument because the three modes are three maps, not three
 * readings of one.** `owned` is the manager's own rosters, `taken` is every
 * *other* roster in the league, and `available` is every roster in it — which
 * {@link matchesSubjects} then reads inverted, since a player nobody names is
 * the one who is free.
 *
 * **The reading is a third argument for the same reason**, and it is the week
 * kind's alone: the four are four populations — who each side started, who each
 * side sat — and `undefined` asks for the resting one, everybody either side
 * fielded. A page that answers for no week drawer ignores it, which costs it
 * nothing, because a resolver may take fewer arguments than it is handed.
 */
export type SubjectRolls = (
  kind: SubjectKind,
  mode: SubjectMode | undefined,
  reading: WeekReading | undefined,
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

/**
 * **Which row a subject came from** — its kind and its id, and nothing else.
 *
 * The counterpart of {@link subjectKey}, and the split is the thing to get
 * right: a row holds at most one narrowing, so *picking* and *clearing* are
 * about the slot, while the token that names the narrowing, and the map that
 * answers it, are about the key. Toggling on the key instead would mean a row
 * switched to `Taken` could not be cleared by pressing it — the press would
 * carry no mode, miss the moded subject, and add a second one.
 */
export function subjectSlot(subject: Pick<Subject, "kind" | "id">): string {
  return `${subject.kind}:${subject.id}`;
}

/**
 * A subject's full identity — the slot plus the mode.
 *
 * The mode is in it because a player on `taken` is a **different narrowing**
 * from the same player on `owned`, not a different view of one: the two read
 * different maps and the token above the grid says different words. A player
 * and a user could share an id, which is what the kind is for.
 */
export function subjectKey(subject: Subject): string {
  const slot = subjectSlot(subject);
  // Absent and `owned` are one narrowing, so they must be one key — otherwise
  // a mode press that lands back on the resting mode would look like a change.
  const moded =
    subject.mode && subject.mode !== "owned" ? `${slot}:${subject.mode}` : slot;
  // The readings are in it on the mode's own argument, one kind over: a row on
  // `start` narrows to different leagues from the same row on `start+opp-start`
  // and the chip above the grid says different words. **Canonically ordered**,
  // so the same two readings picked in the other order are one key rather than
  // two — a reader who pressed Bench then Start would otherwise get a chip that
  // looked like a second narrowing of the row they already had.
  const readings = canonicalReadings(subject.readings);
  return readings.length > 0 ? `${moded}#${readings.join("+")}` : moded;
}

/**
 * The picked readings, deduped and in {@link WEEK_READINGS}' own order.
 *
 * The order is the vocabulary's rather than the presses', which is what lets
 * {@link subjectKey} compare two selections and what keeps a chip's legend
 * reading `start+opp-start` however the reader arrived at it.
 */
export function canonicalReadings(
  readings: readonly WeekReading[] | undefined,
): readonly WeekReading[] {
  if (!readings || readings.length === 0) return [];
  const held = new Set(readings);
  return WEEK_READINGS.filter((reading) => held.has(reading));
}

/**
 * Add that reading to the row's pick, or take it off — **in place**, on
 * {@link setSubjectMode}'s argument: the tray's order is the order things were
 * picked in, and refining a row is not a re-pick.
 *
 * A row that is not picked is left alone; the drawer picks it first, which is
 * what makes a press on an unpicked row's tray key do the obvious thing.
 * Clearing the last reading leaves the row picked on its resting reading rather
 * than clearing the row — the row's own press is where a reader reaches to
 * clear it, and the deck's chip carries a key for the readings alone.
 */
export function toggleSubjectReading(
  state: LeagueSubjects,
  kind: SubjectKind,
  id: string,
  reading: WeekReading,
): LeagueSubjects {
  const slot = subjectSlot({ kind, id });
  return {
    ...state,
    subjects: state.subjects.map((s) => {
      if (subjectSlot(s) !== slot) return s;
      const held = canonicalReadings(s.readings);
      const next = held.includes(reading)
        ? held.filter((r) => r !== reading)
        : canonicalReadings([...held, reading]);
      return { ...s, readings: next };
    }),
  };
}

/** Drop that row's readings, leaving the row picked on its resting reading. */
export function clearSubjectReadings(
  state: LeagueSubjects,
  kind: SubjectKind,
  id: string,
): LeagueSubjects {
  const slot = subjectSlot({ kind, id });
  return {
    ...state,
    subjects: state.subjects.map((s) =>
      subjectSlot(s) === slot ? { ...s, readings: [] } : s,
    ),
  };
}

export function subjectCount(state: LeagueSubjects): number {
  return state.subjects.length;
}

/**
 * The subject picked in that row, whatever mode it is on — or undefined.
 *
 * What a drawer reads to draw a row as pressed and to know which mode key is
 * lit. It is the only way to ask, because the mode lives on the subject and a
 * drawer holding its own copy would be a second spelling of it.
 */
export function pickedSubject(
  state: LeagueSubjects,
  kind: SubjectKind,
  id: string,
): Subject | undefined {
  const slot = subjectSlot({ kind, id });
  return state.subjects.find((s) => subjectSlot(s) === slot);
}

/**
 * Add the subject, or remove it if that row is already picked.
 *
 * **Matched on the slot, not the key** — see {@link subjectSlot}. A row is one
 * narrowing, so a press clears it whatever mode it is on.
 */
export function toggleSubject(
  state: LeagueSubjects,
  subject: Subject,
): LeagueSubjects {
  const slot = subjectSlot(subject);
  const without = state.subjects.filter((s) => subjectSlot(s) !== slot);
  return {
    ...state,
    subjects:
      without.length === state.subjects.length
        ? [...state.subjects, subject]
        : without,
  };
}

/** Drop that row's pick, on {@link toggleSubject}'s slot rule. */
export function removeSubject(
  state: LeagueSubjects,
  subject: Subject,
): LeagueSubjects {
  const slot = subjectSlot(subject);
  return {
    ...state,
    subjects: state.subjects.filter((s) => subjectSlot(s) !== slot),
  };
}

/**
 * Move one picked row onto another mode, **in place**.
 *
 * In place because the order of the tokens is the order they were picked in,
 * and a mode press is not a re-pick: remove-then-add would send the row to the
 * end of the tray every time the reader compared two readings of it.
 *
 * A row that is not picked is left alone. The modes are mutually exclusive and
 * one is always on, so there is no press here that clears a selection — that is
 * the row's own press, which is where a reader already reaches for it.
 */
export function setSubjectMode(
  state: LeagueSubjects,
  kind: SubjectKind,
  id: string,
  mode: SubjectMode,
): LeagueSubjects {
  const slot = subjectSlot({ kind, id });
  return {
    ...state,
    subjects: state.subjects.map((s) =>
      subjectSlot(s) === slot ? { ...s, mode } : s,
    ),
  };
}

/**
 * The composite id a `leaguemate-player` subject carries: this person, holding
 * this player.
 *
 * **One spelling, here, beside the kind that uses it.** The id is written by
 * the chip that picks it and read back by the token that names it, and those
 * are two files — a second spelling is a token naming somebody else.
 */
export function leaguematePlayerId(userId: string, playerId: string): string {
  return `${userId}:${playerId}`;
}

/**
 * The pair back out, or null where the id is not one.
 *
 * Split on the **first** separator: a Sleeper player id is a bare number or a
 * team code, so it never carries one, and splitting on the last would be the
 * same answer by luck rather than by rule.
 */
export function parseLeaguematePlayerId(
  id: string,
): { userId: string; playerId: string } | null {
  const at = id.indexOf(":");
  if (at <= 0 || at === id.length - 1) return null;
  return { userId: id.slice(0, at), playerId: id.slice(at + 1) };
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
  // **The readings are unioned, and one of them answering is enough.** See
  // {@link Subject.readings} for why union is the only operator here. A reading
  // whose own map has not arrived is skipped rather than counted against the
  // row — the same three-state rule this function keeps one grain out, applied
  // per population instead of per subject — and a row whose every reading is
  // unanswerable is unanswerable itself.
  const readings = canonicalReadings(subject.readings);
  if (readings.length > 0) {
    let answered = 0;
    for (const reading of readings) {
      const held = named(
        leagueId,
        subject,
        rolls(subject.kind, subject.mode, reading),
      );
      if (held === null) continue;
      answered++;
      if (held) return true;
    }
    return answered === 0 ? null : false;
  }
  return named(leagueId, subject, rolls(subject.kind, subject.mode, undefined));
}

/** One population's answer for one league, with {@link holds}' three states. */
function named(
  leagueId: string,
  subject: Subject,
  map: Record<string, readonly string[]> | null,
): boolean | null {
  if (!map) return null;
  // `""` and `"0"` are Sleeper's roster padding, and a blank subject id would
  // match them — which under `available` would then match every league on
  // earth. One never gets built from a blank; this is the belt.
  if (!subject.id) return false;
  const roll = map[leagueId];
  // A stored map with no row for this league *can* answer: it does not hold
  // them. Only a missing map is unanswerable.
  //
  // **`available` reads this the same way, which is the arm to get right.** The
  // map it is handed is every roster in the league, so a league with no row is
  // one whose rosters were never stored — and "nobody rosters him there" is a
  // claim nothing has seen the data to make. Read as a match it would sweep
  // every unsynced league into the answer, which is the mistake
  // `PlayerShares.league_count` is written to avoid one grain up.
  if (!roll) return false;
  const listed = roll.includes(subject.id);
  // The one inversion: under `available` the league that does **not** name him
  // is the match, because the map is who holds him rather than who wants him.
  return subject.mode === "available" ? !listed : listed;
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
