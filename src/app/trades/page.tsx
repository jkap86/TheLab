import { AdpControlsProvider, PageShell } from "@/features/shared";
import { TradesHome } from "@/features/trades";
import { getActiveSeason } from "@/shared/season";

/**
 * Rendered per request rather than prerendered, because the season it hands down
 * is now *resolved* rather than compiled in — and a page baked at build time
 * would freeze that resolution into the bundle, which is the hardcoded constant
 * again with extra steps. The page is a shell around a client fetch, so dynamic
 * rendering costs nothing.
 */
export const dynamic = "force-dynamic";

export default async function TradesPage() {
  const season = await getActiveSeason();
  return (
    <PageShell width="wide">
      {/* The season crosses from the server the way the manager layout hands its
          ADP controls one: which league year is current is a server fact, not
          something for pure client code to guess off a clock. `AdpControlsProvider`
          is mounted here rather than shared with the manager tool's own store —
          this page's board describes every crawled draft, not one manager's
          leagues, so there is no reason for the two selections to be one. */}
      <AdpControlsProvider season={season}>
        <TradesHome season={season} />
      </AdpControlsProvider>
    </PageShell>
  );
}
