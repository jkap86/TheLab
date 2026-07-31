import { tools } from "@/features/shared";

/**
 * The stand-in page for a tool that is listed on the tools grid but not built
 * yet. Title and blurb are read from the shared catalogue, so the grid, the app
 * bar's menu and the page itself can never describe the same tool differently.
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
