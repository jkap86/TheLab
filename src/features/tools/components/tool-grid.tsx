import type { UserInfo } from "@/shared/contract";

import { tools } from "../tools.data";
import { PicktrackerCard } from "./picktracker-card";
import { ToolLinkCard } from "./tool-link-card";

/** The pick tracker card lists a resolved account's leagues; the rest just link. */
const PICKTRACKER_HREF = "/picktracker";

export function ToolGrid({ user }: { user: UserInfo | null }) {
  return (
    <ul className="grid gap-4 sm:grid-cols-2">
      {tools.map((tool) => (
        <li key={tool.href}>
          {tool.href === PICKTRACKER_HREF ? (
            <PicktrackerCard tool={tool} user={user} />
          ) : (
            <ToolLinkCard tool={tool} />
          )}
        </li>
      ))}
    </ul>
  );
}
