import Link from "next/link";

import type { Tool } from "../tools.data";
import {
  TOOL_CARD_HOVER,
  TOOL_CARD_SURFACE,
  ToolCardContent,
} from "./tool-card";

/**
 * A tool's card as a whole-card link — the default for every tool. The pick
 * tracker reuses it too, for the no-account-yet state where its league picker
 * has nothing to list.
 *
 * `disabled` renders the same glass card as an inert, dimmed element instead of
 * a link: every card on the grid is greyed until a Sleeper account is resolved,
 * because each tool reads that account (the manager card jumps straight to its
 * leagues, the pick tracker lists them) — the account is the key to the page. It
 * also drops the hover treatment, so a card you can't use doesn't light up.
 * `href` lets a caller override the destination, which is how the manager card
 * skips its own username search once the account is known.
 */
export function ToolLinkCard({
  tool,
  href = tool.href,
  disabled = false,
}: {
  tool: Tool;
  href?: string;
  disabled?: boolean;
}) {
  if (disabled) {
    return (
      <div
        aria-disabled
        className={`${TOOL_CARD_SURFACE} cursor-not-allowed opacity-45`}
      >
        <ToolCardContent text={tool.text} description={tool.description} arrow />
      </div>
    );
  }

  return (
    <Link href={href} className={`${TOOL_CARD_SURFACE} ${TOOL_CARD_HOVER}`}>
      <ToolCardContent text={tool.text} description={tool.description} arrow />
    </Link>
  );
}
