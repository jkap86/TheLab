/**
 * What a ranked list in this app can be a list *of*.
 *
 * A closed set rather than a free string, because it is the key two things
 * agree on: a tool declares what it browses (`Tool.browses`) and the browse
 * itself is opened for that kind. A typo in one of those two places is a drawer
 * that never opens, with nothing to catch it.
 */
export type SubjectKind = "player" | "leaguemate";
