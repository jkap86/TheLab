import { PageHeading, PageShell } from "@/features/shared";
import { ToolsHome } from "@/features/tools";

export default function ToolsPage() {
  return (
    <PageShell>
      {/* The `hero` size is this page's alone: everywhere else the title names a
          tool the app bar has already named, where here the wordmark *is* the
          page. The aurora behind it is the root layout's now. */}
      <PageHeading
        eyebrow="Fantasy football tools"
        title="The Lab"
        lede="Pick a tool to get started."
        size="hero"
        className="mb-12"
      />
      <ToolsHome />
    </PageShell>
  );
}
