import { PageShell } from "@/features/shared";
import { TradesMockups } from "@/features/trades/mockups/trades-mockups";

/**
 * Four layouts for the trades page's filters, side by side with the real board.
 *
 * A throwaway route: it exists so the arrangements can be pressed rather than
 * looked at, and it goes when one of them is chosen. It reads no database — the
 * board is fixtures — so it renders anywhere the app does.
 *
 * `?v=a|b|c|d` opens on one directly, which is what the screenshots are taken
 * through.
 */
export default async function TradesMockupsPage({
  searchParams,
}: {
  searchParams: Promise<{ v?: string }>;
}) {
  const { v } = await searchParams;
  return (
    <PageShell width="wide">
      <TradesMockups initial={v ?? "a"} />
    </PageShell>
  );
}
