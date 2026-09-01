import { PageShell } from "@/features/shared";
import { ToolsHome } from "@/features/tools";

export default function ToolsPage() {
  return (
    <PageShell>
      {/* The heading is passed in rather than owned by `ToolsHome`, which is a
          client component: this keeps the page's one piece of static copy on
          the server side of the boundary. */}
      <ToolsHome
        heading={
          <h1 className="font-display text-3xl font-semibold tracking-tight">
            The Lab
          </h1>
        }
      />
    </PageShell>
  );
}
