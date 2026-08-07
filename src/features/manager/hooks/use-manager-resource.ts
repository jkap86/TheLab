// The shared sub-resource read, re-exported from where this feature's own hooks
// already import it. It moved to `features/shared` with the two hooks built on
// it that the lineup checker's rail now calls — see `manager-query.ts`.
export { useManagerResource } from "@/features/shared/use-manager-resource";
export type { ManagerResourceState } from "@/features/shared/use-manager-resource";
