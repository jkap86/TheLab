import type { LeagueLineup, LineupPlayer } from "@/shared/contract";

/**
 * A league card's rest-of-season lineup: the optimal starters in slot order,
 * the bench behind a disclosure, and the starters' projected total.
 *
 * Two lenses share the rows, and the number column says which priced each one:
 * a projected player shows points, an unprojected one seated or sorted by
 * draft capital shows an em dash — the fallback is deliberately quiet, since a
 * draft-capital figure beside a points figure would read as the same unit.
 */

/** Sleeper's slot names, shortened to fit a chip. Unmapped ones render as-is. */
const SLOT_LABELS: Record<string, string> = {
  SUPER_FLEX: "SF",
  WRRB_FLEX: "W/R",
  REC_FLEX: "W/T",
  IDP_FLEX: "IDP",
  FLEX: "FLX",
};

function points(player: LineupPlayer | null): string {
  if (player?.points == null) return "—";
  return player.points.toFixed(1);
}

function PlayerRow({
  player,
  slot,
}: {
  player: LineupPlayer | null;
  slot?: string;
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
        {points(player)}
      </span>
    </li>
  );
}

export function LineupBreakdown({ lineup }: { lineup: LeagueLineup }) {
  return (
    <div className="mt-3 border-t border-foreground/10 pt-3">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-xs font-semibold tracking-wide text-foreground/60">
          ROS lineup
        </span>
        {lineup.projected_points > 0 && (
          <span className="font-display text-xs font-semibold tabular-nums text-active">
            {lineup.projected_points.toFixed(1)} pts
          </span>
        )}
      </div>

      <ul className="mt-1.5">
        {lineup.starters.map((seat, i) => (
          <PlayerRow key={`${seat.slot}-${i}`} slot={seat.slot} player={seat.player} />
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
              <PlayerRow key={player.player_id} player={player} />
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
