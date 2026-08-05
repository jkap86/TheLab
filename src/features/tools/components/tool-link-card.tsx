import Link from "next/link";

import type { Tool } from "@/features/shared";
import {
  TOOL_CARD_HOVER,
  TOOL_CARD_SURFACE,
  ToolCardContent,
} from "./tool-card";

/**
 * A tool's card as a whole-card link — how every tool on the grid renders.
 *
 * `disabled` renders the same glass card as an inert, dimmed element instead of
 * a link: every card on the grid is greyed until a Sleeper account is resolved,
 * because each tool reads that account (the manager cards jump straight to that
 * account's tabs, the pick tracker lists its leagues once you land there) — the
 * account is the key to the page. It also drops the hover treatment, so a card
 * you can't use doesn't light up. `href` lets a caller override the destination,
 * which is how the manager cards skip their own username search once the account
 * is known.
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
      // `role="link"` is what gives `aria-disabled` something to attach to: on a
      // bare `<div>` the attribute has no host role and is simply dropped, so
      // the card announced as ordinary text and the dimming — the only thing
      // saying it is inert — was invisible to a screen reader. The reason is
      // stated too, since the account this is waiting on is resolved in a card
      // several hundred pixels up the page.
      <div
        role="link"
        aria-disabled="true"
        className={`${TOOL_CARD_SURFACE} cursor-not-allowed opacity-45`}
      >
        <ToolCardContent text={tool.text} description={tool.description} />
        <span className="sr-only">
          Unavailable until a Sleeper account is connected.
        </span>
      </div>
    );
  }

  return (
    <Link href={href} className={`${TOOL_CARD_SURFACE} ${TOOL_CARD_HOVER}`}>
      <ToolCardContent text={tool.text} description={tool.description} />
    </Link>
  );
}
