import { tools } from "../tools.data";

/**
 * The stand-in page for a tool that is listed on the tools grid but not built
 * yet. Title and blurb are read from `tools.data`, so the grid and the page can
 * never describe the same tool differently.
 */
export function ToolPlaceholder({ href }: { href: string }) {
  const tool = tools.find((t) => t.href === href);

  return (
    <div>
      <h1 className="text-3xl font-semibold tracking-tight">
        {tool?.text ?? "Coming soon"}
      </h1>
      {tool && <p className="mt-2 text-foreground/60">{tool.description}</p>}
    </div>
  );
}
