import { CompsHome } from "@/features/comps";
import { PageShell } from "@/features/shared";

/**
 * Statically prerendered on purpose: nothing server-resolved is handed down —
 * the subject's default season is resolved per player by the API route, and
 * "today" enters only as the market anchor's clamp inside the pool read.
 */
export default function CompsPage() {
  return (
    <PageShell width="wide">
      <CompsHome />
    </PageShell>
  );
}
