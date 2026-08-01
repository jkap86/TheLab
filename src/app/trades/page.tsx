import { PageShell } from "@/features/shared";
import { TradesHome } from "@/features/trades";
import { DEFAULT_SEASON } from "@/shared/sleeper";

export default function TradesPage() {
  return (
    <PageShell width="wide">
      {/* The season crosses from the server the way the manager layout hands its
          ADP controls one: which league year is current is a server fact, not
          something for pure client code to guess off a clock. */}
      <TradesHome season={DEFAULT_SEASON} />
    </PageShell>
  );
}
