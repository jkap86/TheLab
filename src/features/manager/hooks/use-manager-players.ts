// The manager's rosters. It moved to `features/shared` when the lineup checker
// started drawing this tool's subject rail and player-shares sheet, both of which
// read exactly this query under exactly this key; re-exported here so this
// feature's own consumers keep the import they have always had.
export { useManagerPlayers } from "@/features/shared/use-manager-players";
export type { ManagerPlayersState } from "@/features/shared/use-manager-players";
