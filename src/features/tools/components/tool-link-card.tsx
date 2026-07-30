import Link from "next/link";

import type { Tool } from "../tools.data";

/**
 * A tool's card as a whole-card link — the default for every tool. The pick
 * tracker reuses it too, for the no-account-yet state where its league picker
 * has nothing to list and the manual-entry page is the way in.
 */
export function ToolLinkCard({ tool }: { tool: Tool }) {
  return (
    <Link
      href={tool.href}
      className="group flex h-full flex-col rounded-xl border border-foreground/10 bg-foreground/[0.02] p-6 transition-colors hover:border-foreground/25 hover:bg-foreground/[0.05] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground/50"
    >
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
    </Link>
  );
}
