import Link from "next/link";

import type { Tool } from "../tools.data";

/**
 * A tool's card as a whole-card link — the default for every tool. The pick
 * tracker reuses it too, for the no-account-yet state where its league picker
 * has nothing to list.
 *
 * `disabled` renders the same card as an inert, dimmed element instead of a
 * link: every card on the grid is greyed until a Sleeper account is resolved,
 * because each tool reads that account (the manager card jumps straight to its
 * leagues, the pick tracker lists them) — the account is the key to the page.
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
  const body = (
    <>
      <span className="flex items-center justify-between text-xl font-medium">
        {tool.text}
        <span
          aria-hidden
          className="text-foreground/30 transition-transform group-hover:translate-x-1 group-hover:text-foreground/60"
        >
          →
        </span>
      </span>
      <span className="mt-2 text-sm text-foreground/55">{tool.description}</span>
    </>
  );

  if (disabled) {
    return (
      <div
        aria-disabled
        className="flex h-full cursor-not-allowed flex-col rounded-xl border border-foreground/10 bg-foreground/[0.02] p-6 opacity-45"
      >
        {body}
      </div>
    );
  }

  return (
    <Link
      href={href}
      className="group flex h-full flex-col rounded-xl border border-foreground/10 bg-foreground/[0.02] p-6 transition-colors hover:border-foreground/25 hover:bg-foreground/[0.05] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground/50"
    >
      {body}
    </Link>
  );
}
