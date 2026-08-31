import { UserInfo } from "@/shared/contract";

import { tools } from "../constants/tools"

import { toolHref } from "../helpers/tool-href";

import { ToolLinkCard } from "./tool-link-card";

export function ToolGrid({ user }: { user: UserInfo | null }) {
  return (
    <ul className="grid gap-4 sm:grid-cols-2">
      {tools.map((tool) => (
        <li key={tool.text}>
          <ToolLinkCard
            tool={tool}
            href={toolHref(tool, user?.username ?? null)}
            disabled={!user && !tool.accountless}
          />
        </li>
      ))}
    </ul>
  );
}