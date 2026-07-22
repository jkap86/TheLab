import Link from "next/link";

import { tools } from "../tools.data";

export function ToolGrid() {
  return (
    <ul className="grid gap-4 sm:grid-cols-2">
      {tools.map((l) => (
        <li key={l.href}>
          <Link
            href={l.href}
            className="group flex h-full flex-col rounded-xl border border-foreground/10 bg-foreground/[0.02] p-6 transition-colors hover:border-foreground/25 hover:bg-foreground/[0.05] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground/50"
          >
            <span className="flex items-center justify-between text-xl font-medium">
              {l.text}
              <span
                aria-hidden
                className="text-foreground/30 transition-transform group-hover:translate-x-1 group-hover:text-foreground/60"
              >
                →
              </span>
            </span>
            <span className="mt-2 text-sm text-foreground/55">
              {l.description}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
