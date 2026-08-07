// Every member of every league the manager is in. It moved to `features/shared`
// with `use-manager-players` beside it and for the same reason — the lineup
// checker's rail and leaguemate-shares sheet read it.
export { useManagerLeaguemates } from "@/features/shared/use-manager-leaguemates";
export type { ManagerLeaguematesState } from "@/features/shared/use-manager-leaguemates";
