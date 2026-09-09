import type { WeekGame } from "../week-record";
import { sharePercentile } from "../rank-ramp";
import { GameChip, RampFigure, StandingBay } from "./card-plate";

/**
 * One comparison on a card's standing strip, as a signed margin polished in
 * the ramp's own hue — and the week's games as one chip apiece.
 *
 * The lineup checker's two strip parts, shared since the gametime card draws
 * the same strip over live figures: a margin read one way on one page and
 * another on the other would be the drift the two cards exist to remove.
 *
 * **The colour is the margin's size, not which way it went** — the chip beside
 * it already says that, and a rank ramp fed a win/lose boolean would paint a
 * 0.4-point squeaker the same green as a thirty-point rout. `sharePercentile`
 * is the scale the standings table already reads its totals on: a margin as a
 * share of what the two sides average, saturating at ±10%.
 *
 * **The sign is decided after rounding**, so a margin that rounds to nothing
 * prints `0.0` rather than `−0.0` — and a `0.0` beside an `L` is true rather
 * than contradictory: the game was that close, and the chip is what settles
 * it. An explicit `+` because the sign is the reading: a margin printed bare
 * would read as a score.
 */
export function MarginBay({
  label,
  mine,
  against,
}: {
  label: string;
  mine: number;
  against: number;
}) {
  const margin = Number((mine - against).toFixed(1));
  const sign = margin > 0 ? "+" : margin < 0 ? "−" : "";

  return (
    <StandingBay label={label} stretch>
      <RampFigure percentile={sharePercentile(mine, [mine, against])}>
        {sign}
        {Math.abs(margin).toFixed(1)}
      </RampFigure>
    </StandingBay>
  );
}

/** The ramp's own ends and middle: a win, a loss, a dead heat. */
const OUTCOME_PERCENTILE: Record<WeekGame["result"], number> = {
  win: 100,
  loss: 0,
  tie: 50,
};

const OUTCOME_LETTER: Record<WeekGame["result"], string> = {
  win: "W",
  loss: "L",
  tie: "T",
};

/** What each chip's sentence names, so `W W` is never announced as "W W". */
const AGAINST: Record<WeekGame["against"], string> = {
  opponent: "this week’s opponent",
  median: "the league median",
};

/**
 * One chip per game, head-to-head first — the strip's own left-to-right order,
 * so the first maps onto the head-to-head bay and the second onto the median
 * bay, and the part itself says which is which. That is a reading `1–1` cannot
 * make. The bay draws no ink of its own, because each chip carries its own —
 * see `StandingBay`'s `tone`.
 *
 * `verb` is the sentence's own word for the result — `Projected` before a
 * game, `On course for` during one — since the chip is the same shape either
 * way and only the claim behind it differs.
 */
export function OutcomeChips({
  games,
  verb = "Projected",
}: {
  games: readonly WeekGame[];
  verb?: string;
}) {
  return (
    <span className="inline-flex items-center gap-1">
      {games.map((game) => (
        <GameChip
          key={game.against}
          percentile={OUTCOME_PERCENTILE[game.result]}
          name={`${verb} ${game.result} against ${AGAINST[game.against]}`}
        >
          {OUTCOME_LETTER[game.result]}
        </GameChip>
      ))}
    </span>
  );
}
