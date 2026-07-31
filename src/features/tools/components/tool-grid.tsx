import type { UserInfo } from "@/shared/contract";

import { tools } from "../tools.data";
import { ToolLinkCard } from "./tool-link-card";

/**
 * Every card stays disabled until an account is resolved — each tool reads it,
 * so `user` gates the whole grid. Once resolved, a tool with an `hrefFor` skips
 * the username search it would otherwise land you on (the three manager views
 * each link straight to that account's tab).
 *
 * The pick tracker is a plain link like the rest: it needs a league *id* rather
 * than a username, and its picker lives on `/picktracker`, which reads the same
 * stored account to list that account's leagues. Choosing a league is a step of
 * the tracker, not of picking a tool.
 *
 * Cards are keyed by name rather than href, because the manager views share the
 * account-less one.
 */
export function ToolGrid({ user }: { user: UserInfo | null }) {
  return (
    <ul className="grid gap-4 sm:grid-cols-2">
      {tools.map((tool) => (
        <li key={tool.text}>
          <ToolLinkCard
            tool={tool}
            href={
              user && tool.hrefFor
                ? tool.hrefFor(encodeURIComponent(user.username))
                : tool.href
            }
            disabled={!user}
          />
        </li>
      ))}
    </ul>
  );
}
