import type { UserInfo } from "@/shared/contract";

import { toolHref, tools } from "@/features/shared";

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
 * account-less one. Destinations go through `toolHref`, which the app bar's menu
 * also calls — the username is URL-encoded there, once, rather than at each
 * call site.
 */
export function ToolGrid({ user }: { user: UserInfo | null }) {
  return (
    <ul className="grid gap-4 sm:grid-cols-2">
      {tools.map((tool) => (
        <li key={tool.text}>
          <ToolLinkCard
            tool={tool}
            href={toolHref(tool, user?.username ?? null)}
            disabled={!user}
          />
        </li>
      ))}
    </ul>
  );
}
