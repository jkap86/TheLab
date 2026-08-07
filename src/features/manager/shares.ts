// Player shares moved to `features/shared` with the browse that reads them —
// the lineup checker opens the same sheet — and are re-exported here so this
// feature's own consumers (`manager-players`, the sheet's manager-side shim)
// keep the import they have always had. Relative with an explicit `.ts`
// extension, since the module on the far side is pure and tested.
export { playerShares } from "../shared/shares.ts";
export type { PlayerShare, PlayerShares } from "../shared/shares.ts";
