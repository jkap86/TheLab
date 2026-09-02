import { PageShell } from "@/features/shared";
import { LabWordmark, ToolsHome } from "@/features/tools";

export default function ToolsPage() {
  return (
    // `wide` because the grid is three across now; the default gutters were cut
    // for a two-column page.
    <PageShell width="wide">
      {/* The heading is passed in rather than owned by `ToolsHome`, which is a
          client component: this keeps the page's one piece of static copy on
          the server side of the boundary. */}
      <ToolsHome heading={<LabWordmark />} />
    </PageShell>
  );
}
