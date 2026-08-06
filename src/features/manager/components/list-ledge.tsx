// The heading billet moved to `features/shared/ui` when the lineup checker
// started heading its own list with it, and is re-exported here so this feature's
// components keep importing it from where they always have — one canonical
// definition under two names, the usual mover's rule.
export { ListLedge } from "@/features/shared/ui/list-ledge";
