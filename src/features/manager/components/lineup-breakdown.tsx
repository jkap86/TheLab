"use client";

import { useState } from "react";

import type { LeagueLineup, LineupPlayer } from "@/shared/contract";

/**
 * A league card's rest-of-season lineup: the optimal starters in slot order,
 * the bench behind a disclosure, and a total for the seated starters.
 *
 * The number column is one lens at a time — rest-of-season points, or the
 * draft-capital value — flipped by the toggle in the header. Flipping the
 * *whole* column is the point: a draft-capital figure beside a points figure
 * would read as the same unit, so the two never share a column, and a player
 * the current lens has nothing to say about shows an em dash rather than a
 * borrowed number. The lens is per-card `useState`, deliberately unpersisted —
 * it is a peek at the other valuation, not a page preference.
 */

/** Sleeper's slot names, shortened to fit a chip. Unmapped ones render as-is. */
const SLOT_LABELS: Record<string, string> = {
  SUPER_FLEX: "SF",
  WRRB_FLEX: "W/R",
  REC_FLEX: "W/T",
  IDP_FLEX: "IDP",
  FLEX: "FLX",
};

type Lens = "points" | "capital";

function cell(player: LineupPlayer | null, lens: Lens): string {
  if (!player) return "—";
  if (lens === "points") {
    return player.points == null ? "—" : player.points.toFixed(1);
  }
  return player.adp_value == null
    ? "—"
    : player.adp_value.toLocaleString("en-US");
}

function PlayerRow({
  player,
  slot,
  lens,
}: {
  player: LineupPlayer | null;
  slot?: string;
  lens: Lens;
}) {
  return (
    <li className="flex items-center gap-2 py-1">
      {slot !== undefined && (
        <span className="w-9 shrink-0 rounded bg-foreground/[0.06] px-1 py-0.5 text-center text-[10px] font-semibold tracking-wide text-foreground/60">
          {SLOT_LABELS[slot] ?? slot}
        </span>
      )}
      <span className="min-w-0 flex-1 truncate text-xs text-foreground/80">
        {player ? (player.name ?? player.player_id) : "Empty"}
      </span>
      <span className="shrink-0 text-xs tabular-nums text-foreground/60">
        {cell(player, lens)}
      </span>
    </li>
  );
}

export function LineupBreakdown({ lineup }: { lineup: LeagueLineup }) {
  const [lens, setLens] = useState<Lens>("points");

  // The starters' total under the current lens, so the headline number always
  // agrees with the column beneath it. Capital sums client-side off the same
  // `adp_value` the rows show — no second valuation to disagree with.
  const starterCapital = lineup.starters.reduce(
    (sum, seat) => sum + (seat.player?.adp_value ?? 0),
    0,
  );
  const total =
    lens === "points"
      ? lineup.projected_points > 0
        ? `${lineup.projected_points.toFixed(1)} pts`
        : null
      : starterCapital > 0
        ? `${starterCapital.toLocaleString("en-US")} cap`
        : null;

  return (
    <div className="mt-3 border-t border-foreground/10 pt-3">
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs font-semibold tracking-wide text-foreground/60">
          ROS lineup
        </span>
        <div className="flex items-center gap-2">
          <div
            role="group"
            aria-label="Value lens"
            className="flex rounded-md bg-foreground/[0.06] p-0.5"
          >
            {(["points", "capital"] as const).map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setLens(option)}
                aria-pressed={lens === option}
                className={`rounded px-1.5 py-0.5 text-[10px] font-semibold transition-colors ${
                  lens === option
                    ? "bg-background text-foreground/90"
                    : "text-foreground/55 hover:text-foreground/80"
                }`}
              >
                {option === "points" ? "Points" : "Capital"}
              </button>
            ))}
          </div>
          {total && (
            <span className="font-display text-xs font-semibold tabular-nums text-active">
              {total}
            </span>
          )}
        </div>
      </div>

      <ul className="mt-1.5">
        {lineup.starters.map((seat, i) => (
          <PlayerRow
            key={`${seat.slot}-${i}`}
            slot={seat.slot}
            player={seat.player}
            lens={lens}
          />
        ))}
      </ul>

      {lineup.unknown_slots.length > 0 && (
        // A partial lineup must say so — see `unknown_slots` on the contract.
        <p className="mt-1 text-[10px] text-foreground/50">
          Not shown: {lineup.unknown_slots.join(", ")}
        </p>
      )}

      {lineup.bench.length > 0 && (
        <details className="group mt-1.5">
          <summary className="cursor-pointer list-none text-xs text-foreground/50 transition-colors hover:text-foreground/80">
            <span className="group-open:hidden">
              Bench ({lineup.bench.length}) ▸
            </span>
            <span className="hidden group-open:inline">
              Bench ({lineup.bench.length}) ▾
            </span>
          </summary>
          <ul className="mt-1">
            {lineup.bench.map((player) => (
              <PlayerRow key={player.player_id} player={player} lens={lens} />
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
