import type { UserInfo } from "@/shared/contract";

import { tools } from "../tools.data";
import { PicktrackerCard } from "./picktracker-card";
import { ToolLinkCard } from "./tool-link-card";

/** The pick tracker card lists a resolved account's leagues; the rest just link. */
const PICKTRACKER_HREF = "/picktracker";

/**
 * Every card stays disabled until an account is resolved — each tool reads it,
 * so `user` gates the whole grid. Once resolved, a tool with an `hrefFor` skips
 * the username search it would otherwise land you on (the three manager views
 * each link straight to that account's tab); the pick tracker lists the leagues
 * inline instead (and stays disabled until one is picked).
 *
 * Cards are keyed by name rather than href, because the manager views share the
 * account-less one.
 */
export function ToolGrid({ user }: { user: UserInfo | null }) {
  return (
    <ul className="grid gap-4 sm:grid-cols-2">
      {tools.map((tool) => (
        <li key={tool.text}>
          {tool.href === PICKTRACKER_HREF ? (
            <PicktrackerCard tool={tool} user={user} />
          ) : (
            <ToolLinkCard
              tool={tool}
              href={
                user && tool.hrefFor
                  ? tool.hrefFor(encodeURIComponent(user.username))
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
