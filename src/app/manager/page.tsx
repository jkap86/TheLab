import { PageShell } from "@/features/shared";
// The module path, not `@/features/manager` — that barrel also names the three
// tab views, and a barrel is one module to the bundler, so this page's username
// field would ship the whole tool. See the note on that file.
import { ManagerSearch } from "@/features/manager/components/manager-search";

export default function ManagerPage() {
  return (
    <PageShell>
      <ManagerSearch title="Manager" />
    </PageShell>
  );
}
