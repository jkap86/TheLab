import type { UserInfo } from "@/shared/contract";

import { tools } from "../tools.data";
import { PicktrackerCard } from "./picktracker-card";
import { ToolLinkCard } from "./tool-link-card";

/** The pick tracker card lists a resolved account's leagues; the rest just link. */
const PICKTRACKER_HREF = "/picktracker";
/** The manager card jumps straight to the resolved account's leagues. */
const MANAGER_HREF = "/manager";

/**
 * Every card stays disabled until an account is resolved — each tool reads it,
 * so `user` gates the whole grid. Once resolved, the manager card skips its own
 * username search and links straight to that account's leagues; the pick tracker
 * lists them inline (and stays disabled until one is picked).
 */
export function ToolGrid({ user }: { user: UserInfo | null }) {
  return (
    <ul className="grid gap-4 sm:grid-cols-2">
      {tools.map((tool) => (
        <li key={tool.href}>
          {tool.href === PICKTRACKER_HREF ? (
            <PicktrackerCard tool={tool} user={user} />
          ) : (
            <ToolLinkCard
              tool={tool}
              href={
                tool.href === MANAGER_HREF && user
                  ? `/manager/${encodeURIComponent(user.username)}/leagues`
                  : tool.href
              }
              disabled={!user}
            />
          )}
        </li>
      ))}
    </ul>
  );
}
