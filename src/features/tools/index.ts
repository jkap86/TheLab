export { ToolsHome } from "./components/tools-home";
export { ToolPlaceholder } from "./components/tool-placeholder";
// The catalogue moved to `features/shared` when the app bar became its second
// reader; re-exported from where this feature's consumers already import it.
export { tools, toolHref, type Tool } from "@/features/shared";
