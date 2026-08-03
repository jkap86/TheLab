"use client";

import { useState } from "react";

import { TradeCard } from "../components/trade-card";
import { DEFAULT_TRADE_FILTERS } from "../filters";
import type { TradeFilters } from "../filters";
import { TRADE_METRICS } from "../trade-metrics";
import {
  MOCK_KTC,
  MOCK_LEAGUES,
  MOCK_MANAGERS,
  MOCK_PLAYERS,
  MOCK_TRADES,
} from "./fixtures";
import { Trigger } from "./parts";
import { VariantA, VariantB, VariantC, VariantD } from "./variants";

/**
 * The four inline-filter layouts, over the real board.
 *
 * A mockup route rather than a design file: the cards, the option lists and the
 * app bar above them are the shipped components, so what is being compared is
 * the arrangement and its cost in vertical space — which is the whole question —
 * rather than four re-drawings of a trade card.
 *
 * The page heading and the scope line are gone from all four, which is what pays
 * for the filters' new room. What each variant still has to say is the count and
 * the selection, and where they put those is most of what separates them.
 */

const VARIANTS = [
  { key: "a", name: "Control bar", note: "one row, a key per filter" },
  { key: "b", name: "Token field", note: "one search over all three lists" },
  { key: "c", name: "Expanding ledge", note: "the panel, seated and closed" },
  { key: "d", name: "Side rail", note: "everything open, beside the board" },
] as const;

type VariantKey = (typeof VARIANTS)[number]["key"];

export function TradesMockups({ initial = "a" }: { initial?: string }) {
  const [variant, setVariant] = useState<VariantKey>(
    (VARIANTS.find((v) => v.key === initial)?.key ?? "a") as VariantKey,
  );
  // One selection across all four, so switching between them compares the same
  // narrowed board rather than four different ones.
  const [filters, setFilters] = useState<TradeFilters>({
    ...DEFAULT_TRADE_FILTERS,
    range: { ...DEFAULT_TRADE_FILTERS.range, preset: "30d" },
    managers: ["m1", "m2"],
    players: ["pl1"],
  });

  const active = VARIANTS.find((v) => v.key === variant)!;
  const props = { filters, onChange: setFilters, neighbours: <Neighbours /> };
  const board = <Board />;

  return (
    <>
      {/* The switcher is the mockup's own chrome and is not part of any
          proposal — it sits above the app's content, in the app's material, so
          it can't be mistaken for a control the page would ship. */}
      <div className="mb-5 flex flex-wrap items-center gap-2 border-b border-foreground/10 pb-4">
        <span className="mr-1 text-xs font-bold uppercase tracking-[0.16em] text-foreground/35">
          Layout
        </span>
        {VARIANTS.map((option) => (
          <button
            key={option.key}
            type="button"
            onClick={() => setVariant(option.key)}
            className={`rounded-full px-3 py-1 text-xs font-semibold ${
              option.key === variant
                ? "lab-chip-on lab-chip-sm"
                : "lab-chip lab-chip-sm text-foreground/75"
            }`}
          >
            {option.key.toUpperCase()} · {option.name}
          </button>
        ))}
        <span className="ml-auto text-xs text-foreground/40">{active.note}</span>
      </div>

      {variant === "a" && (
        <>
          <VariantA {...props} />
          {board}
        </>
      )}
      {variant === "b" && (
        <>
          <VariantB {...props} />
          {board}
        </>
      )}
      {variant === "c" && (
        <>
          <VariantC {...props} />
          {board}
        </>
      )}
      {variant === "d" && <VariantD {...props}>{board}</VariantD>}
    </>
  );
}

/**
 * The two controls that keep their place in every variant — the league filters
 * and the value picker — as inert stand-ins.
 *
 * Stand-ins rather than the real components because both carry a query behind
 * them and neither is what is being decided here; what matters is that they take
 * up their real width in the row the filters are moving into.
 */
function Neighbours() {
  return (
    <>
      <Trigger label="Leagues" caret={false} />
      <Trigger label="KTC" />
    </>
  );
}

/** The board itself — the real card, un-virtualised at this length. */
function Board() {
  const leagues = new Map(MOCK_LEAGUES.map((l) => [l.league_id, l]));
  return (
    <div className="flex flex-col gap-3">
      {MOCK_TRADES.map((trade) => (
        <TradeCard
          key={trade.transaction_id}
          trade={trade}
          league={leagues.get(trade.league_id) ?? null}
          players={MOCK_PLAYERS}
          managers={MOCK_MANAGERS}
          metric={TRADE_METRICS[0]}
          ktc={MOCK_KTC}
        />
      ))}
    </div>
  );
}
