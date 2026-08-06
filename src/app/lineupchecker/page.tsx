import { PageShell } from "@/features/shared";
import { LineupCheckerHome } from "@/features/lineupchecker";

/**
 * `wide` for the same reason the manager tabs are: this is a list of a hundred-odd
 * rows carrying stat columns, and the default gutters give those columns less
 * room than the names beside them need.
 */
export default function LineupCheckerPage() {
  return (
    <PageShell width="wide">
      <LineupCheckerHome />
    </PageShell>
  );
}
