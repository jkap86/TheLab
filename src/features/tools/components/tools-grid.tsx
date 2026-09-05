import type { UserInfo } from "@/shared/contract";

import { tools } from "../constants/tools";
import { toolHref } from "../helpers/tool-href";
import { ToolLinkCard } from "./tool-link-card";

export function ToolGrid({ user }: { user: UserInfo | null }) {
  return (
    // Three across at the top breakpoint: the grid is sized for the ~8-10 tools
    // this page is growing into, not the five it has.
    //
    // Each `<li>` owns the `perspective` (so every card is projected from its
    // own centre rather than from one vanishing point at the grid's middle) and
    // is itself `flex`, which is what lets the card be `flex-1` instead of
    // `h-full` — see the note in `tool-card.tsx`. The row gap leaves room for
    // the hover rise; the column gap does not need to.
    //
    // The perspective carries `pointer-fine:` with the rest of the depth: a
    // coarse pointer has no hover to flatten the tilt, so the projection is a
    // stacking context per card bought with nothing to spend it on.
    <ul className="grid grid-cols-1 gap-x-[1.125rem] gap-y-7 sm:grid-cols-2 lg:grid-cols-3">
      {tools.map((tool) => (
        <li key={tool.href} className="flex pointer-fine:[perspective:2400px]">
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
