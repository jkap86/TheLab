/**
 * The *who is in it* selection, re-exported from where this feature's modules
 * already import it.
 *
 * It moved to `features/shared` when the lineup checker grew the same rail — a
 * piece read by a second tool moves, it does not get imported across features —
 * and this file is the mover's other half: one canonical definition, read under
 * the name the components and the filtered-leagues hook here already use.
 *
 * Relative with an explicit `.ts` extension, since the module on the far side is
 * pure and tested and Node's runner doesn't know the `@/*` aliases.
 */
export {
  DEFAULT_SUBJECT_FILTERS,
  EMPTY_SUBJECT_INDEX,
  hasSubject,
  holdsSubject,
  matchesSubjects,
  removeSubjectAt,
  searchSubjects,
  subjectKey,
  subjectOptions,
  subjectSummary,
  toggleSubject,
} from "../shared/subjects.ts";
export type {
  Subject,
  SubjectFilters,
  SubjectIndex,
  SubjectKind,
  SubjectLabel,
  SubjectMatch,
  SubjectOption,
} from "../shared/subjects.ts";
