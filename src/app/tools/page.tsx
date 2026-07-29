import { PageShell } from "@/features/shared";
import { ToolGrid, UserLookup } from "@/features/tools";

export default function ToolsPage() {
  return (
    <PageShell>
      <header className="mb-12">
        <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
          The Lab
        </h1>
        <p className="mt-3 text-lg text-foreground/60">
          Pick a tool to get started.
        </p>
      </header>

      <UserLookup />

      <ToolGrid />
    </PageShell>
  );
}
