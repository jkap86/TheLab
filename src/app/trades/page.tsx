import { PageShell } from "@/features/shared";
import { ToolPlaceholder } from "@/features/tools";

export default function Page() {
  return (
    <PageShell>
      <ToolPlaceholder href="/trades" />
    </PageShell>
  );
}
