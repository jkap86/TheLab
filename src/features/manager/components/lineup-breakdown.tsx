"use client";

import type { LeagueLineup, LineupPlayer } from "@/shared/contract";
import { CONSOLE_TRACK } from "@/features/shared";

/**
 * A league card's rest-of-season lineup: the optimal starters in slot order,
 * the bench behind a disclosure, and a total for the seated starters.
 *
 * The number column is one lens at a time — rest-of-season points, or the
 * draft-capital value. Flipping the *whole* column is the point: a
 * draft-capital figure beside a points figure would read as the same unit, so
 * the two never share a column, and a player the current lens has nothing to
 * say about shows an em dash rather than a borrowed number.
 *
 * **The lens is owned by `LeagueTeams`, not by this component.** Its keys and
 * its total sit on the panes' shared control row, above both panes, because
 * neither pane is wide enough to carry a header of its own — so the state has
 * to live where both the keys and this list can see it. It is still per-card
 * and deliberately unpersisted: a peek at the other valuation, not a page
 * preference.
 *
 * The rows are a lit readout rather than plain text. It is the same surface as
 * the card's metric tiles and the account readout, and it is what keeps ten
 * rows of numbers from reading as a paragraph.
 */

/** Sleeper's slot names, shortened to fit a chip. Unmapped ones render as-is. */
const SLOT_LABELS: Record<string, string> = {
  SUPER_FLEX: "SF",
  WRRB_FLEX: "W/R",
  REC_FLEX: "W/T",
  IDP_FLEX: "IDP",
  FLEX: "FLX",
};

export type Lens = "points" | "capital";

function cell(player: LineupPlayer | null, lens: Lens): string {
  if (!player) return "—";
  if (lens === "points") {
    return player.points == null ? "—" : player.points.toFixed(1);
  }
  return player.adp_value == null
    ? "—"
    : player.adp_value.toLocaleString("en-US");
}

/**
 * The starters' total under the current lens, so the headline number always
 * agrees with the column beneath it. Capital sums client-side off the same
 * `adp_value` the rows show — no second valuation to disagree with. Null where
 * the lens has nothing to total, which is what keeps a `0.0 pts` off a card
 * whose projections never landed.
 */
export function lineupTotal(lineup: LeagueLineup, lens: Lens): string | null {
  if (lens === "points") {
    return lineup.projected_points > 0
      ? lineup.projected_points.toFixed(1)
      : null;
  }
  const capital = lineup.starters.reduce(
    (sum, seat) => sum + (seat.player?.adp_value ?? 0),
    0,
  );
  return capital > 0 ? capital.toLocaleString("en-US") : null;
}

/**
 * The lens keys, as a pair of tactile keys in one housing: the resting shadow
 * carries a 3px riser and the pressed one drops to 1px, so the key travels.
 */
export function LineupLensKeys({
  lens,
  onChange,
}: {
  lens: Lens;
  onChange: (lens: Lens) => void;
}) {
  return (
    <div
      role="group"
      aria-label="Value lens"
      className={`${CONSOLE_TRACK} inline-flex gap-1 p-1`}
    >
      {(["points", "capital"] as const).map((option) => (
        <button
          key={option}
          type="button"
          onClick={() => onChange(option)}
          aria-pressed={lens === option}
          // The unselected option is bare text *on the track*, not a second
          // key: two raised faces in one channel is a pair of buttons, where
          // one raised and one flush is a switch showing its position.
          className={`rounded-full border px-3.5 py-1.5 font-mono text-[0.625rem] uppercase tracking-[0.16em] transition-[color,box-shadow] duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-active/60 ${
            lens === option
              ? "border-active/45 bg-[image:var(--key-bg)] text-readout shadow-[var(--key-shadow)] [text-shadow:var(--readout-text-glow)]"
              : "border-transparent text-foreground/58 hover:text-readout"
          }`}
        >
          {option === "points" ? "Points" : "Capital"}
        </button>
      ))}
    </div>
  );
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
    <li className="relative flex h-8 items-center gap-2.5 border-b border-active/8 last:border-b-0">
      {slot !== undefined && (
        <span className="w-9 shrink-0 font-mono text-[0.6875rem] tracking-[0.12em] text-readout/60">
          {SLOT_LABELS[slot] ?? slot}
        </span>
      )}
      <span className="min-w-0 flex-1 truncate text-[0.8125rem] text-foreground/85">
        {player ? (player.name ?? player.player_id) : "Empty"}
      </span>
      <span className="shrink-0 font-mono text-[0.6875rem] tabular-nums text-readout">
        {cell(player, lens)}
      </span>
    </li>
  );
}

export function LineupBreakdown({
  lineup,
  lens,
}: {
  lineup: LeagueLineup;
  lens: Lens;
}) {
  return (
    <div className="relative overflow-hidden rounded-xl border border-black/85 bg-[image:var(--readout-bg)] px-3.5 py-1 shadow-[var(--readout-shadow)]">
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[image:var(--readout-scanlines)]"
      />

      <ul className="relative m-0 list-none p-0">
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
        <p className="relative m-0 py-2 font-mono text-[0.6875rem] uppercase tracking-[0.14em] text-foreground/60">
          Not shown: {lineup.unknown_slots.join(", ")}
        </p>
      )}

      {lineup.bench.length > 0 && (
        <details className="group/bench relative">
          <summary className="flex h-9 cursor-pointer list-none items-center font-mono text-[0.6875rem] uppercase tracking-[0.14em] text-foreground/60 transition-colors hover:text-readout">
            <span className="group-open/bench:hidden">
              Bench ({lineup.bench.length}) ▸
            </span>
            <span className="hidden group-open/bench:inline">
              Bench ({lineup.bench.length}) ▾
            </span>
          </summary>
          <ul className="m-0 list-none border-t border-active/8 p-0">
            {lineup.bench.map((player) => (
              <PlayerRow key={player.player_id} player={player} lens={lens} />
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
