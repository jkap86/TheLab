import type { Tool } from "../types/tools.types";

export function toolHref(tool: Tool, username: string | null): string {
  if (!username || !tool.hrefFor) return tool.href;
  return tool.hrefFor(encodeURIComponent(username));
}