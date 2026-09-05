import { ConsoleGround, PageShell } from "@/features/shared";
import { TradesHome } from "@/features/trades";
import { getActiveSeason } from "@/shared/season";

// The season is resolved per request rather than baked at build time: a
// prerendered page would carry whatever season was current when it was built,
// which is `DEFAULT_SEASON` with extra steps.
export const dynamic = "force-dynamic";

export default async function TradesPage() {
  const season = await getActiveSeason();

  return (
    <>
      {/* The page's surface runs to the viewport edges rather than being a
          panel drawn inside the shell — see `ConsoleGround`. It is rendered per
          route rather than in `layout.tsx` because the pages that still draw
          their own panel would get a panel on a panel. */}
      <ConsoleGround />
      {/* `console` rather than `wide`, for the leagues page's measured reason: a
          trade card is two side-by-side panes of names, and the narrower shell
          truncates them. It is the same variant `/manager` passes, and with the
          panel gone a trade card is now the same width as a league card. */}
      <PageShell width="console">
        {/* The heading is passed in rather than owned by `TradesHome`, which is
            a client component — this keeps the page's one piece of static copy
            on the server side of the boundary. */}
        <TradesHome
          season={season}
          heading={
            <h1 className="font-mono text-[length:var(--fs-11)] uppercase tracking-[0.16em] text-foreground/60">
              Trades
            </h1>
          }
        />
      </PageShell>
    </>
  );
}
