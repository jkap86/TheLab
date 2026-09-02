import Link from "next/link";

import type { Tool } from "../types/tools.types";
import {
  TOOL_CARD_HOVER,
  TOOL_CARD_SURFACE,
  ToolCardContent,
} from "./tool-card";

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
      // stated too, since the account this is waiting on is resolved in a
      // readout several hundred pixels up the page.
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
