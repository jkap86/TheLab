import { PageHeading, tools } from "@/features/shared";

/**
 * The stand-in page for a tool that is listed on the tools grid but not built
 * yet. Title and blurb are read from the shared catalogue, so the grid, the app
 * bar's menu and the page itself can never describe the same tool differently.
 *
 * It wears the same {@link PageHeading} a finished tool does, on purpose: a page
 * that looks unfinished as well as being unfinished reads as broken.
 */
export function ToolPlaceholder({ href }: { href: string }) {
  const tool = tools.find((t) => t.href === href);

  return (
    <PageHeading
      eyebrow="Coming soon"
      title={tool?.text ?? "Coming soon"}
      lede={tool?.description}
    />
  );
}
