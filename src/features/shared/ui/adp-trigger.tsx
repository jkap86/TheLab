"use client";

import { type AdpRange, boardLabel } from "../adp-controls";

/**
 * The button that opens the board, seated in the app bar.
 *
 * **It says one word.** It used to carry the window and the matched draft count
 * — `All of 2026 · 1,204 drafts` — which was right in the manager header's
 * control dock, where a line of chrome could afford a sentence. The bar is a row
 * of *names* (the mark, the tool you are in, Tools), it is the width a phone has
 * for all of them at once, and the drawer states the board and the count in its
 * own header one press away. So the label is the tool's name and the sentence is
 * inside. The board is still named on hover, which is the desktop backstop the
 * roster panel's contracted names already use — not the plan, since a phone has
 * no hover and is the width the change was made for.
 *
 * **It is a block, not a face** (`.lab-billet`). The bar's other parts extrude
 * straight down at 3px; this one carries a 6px wall down and to the right,
 * graded from a lit near corner to a dark far one. At 3px a wall is a line and
 * its colour is decoration; at 6px it is a face you read the shading of, which
 * is the difference between an object sitting on the bar and a rectangle drawn
 * in it. That is what lets the part be recognisable at three characters — and
 * what keeps it from being the Tools key in a second colour, which is the
 * failure mode of drawing it in the bar's existing material.
 *
 * **It wears its own subject.** An accent rail down the leading face — the
 * manager plate's mark for "a readout follows" — and three descending bars,
 * which is what an ADP curve looks like at 13px. The bars stand in a milled
 * channel (`.lab-channel`) rather than being painted on the face, because at
 * this size the eye reads the *inside* of a part before it reads the outline:
 * three cyan rectangles are a texture, three solids with a lit top edge and a
 * dark side standing in a cut are objects.
 *
 * **Those bars carry the one fact the label gave up.** The old trigger never
 * took an accent state, on the grounds that a board is always chosen and tinting
 * a constant spends a signal; that argument held *because the trigger named the
 * board*. It doesn't now, so whether this reader's board is narrowed away from
 * everybody else's lights the bars ({@link adpNarrowingCount}) — the part that
 * already means "board" — and raises the block's own glow. Never the face: the
 * bar keeps exactly one fully lit key, and that is Tools.
 */
export function AdpTrigger({
  range,
  season,
  draftCount,
  narrowed,
  onClick,
}: {
  range: AdpRange;
  season: string;
  /** Drafts the current board matched; null before the first board lands. */
  draftCount: number | null;
  /** Settings narrowing the board away from the default — 0 is everyone's board. */
  narrowed: number;
  onClick: () => void;
}) {
  const board = boardLabel(range, season);

  return (
    <button
      type="button"
      onClick={onClick}
      aria-haspopup="dialog"
      // The board and its size, for a pointer that rests on the part. Everything
      // it says is stated again inside the drawer, so nothing here is the only
      // place a fact lives.
      title={
        draftCount === null
          ? `ADP board — ${board}`
          : `ADP board — ${board}, ${draftCount.toLocaleString()} draft${
              draftCount === 1 ? "" : "s"
            }`
      }
      className={`lab-billet lab-notch-all inline-flex h-[38px] flex-none pb-[6px] pr-[6px] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-active/70 ${
        narrowed > 0 ? "lab-billet-lit" : ""
      }`}
    >
      <span className="lab-billet-face lab-notch-all flex h-[32px] items-center gap-[9px] whitespace-nowrap pr-3 font-display text-[11px] font-extrabold uppercase tracking-[0.13em] text-foreground/90">
        {/* The rail is flush to the block's leading edge — no inset — because it
            is the *side* of the part catching the light, not a stripe on it. */}
        <span aria-hidden className="lab-billet-rail w-[6px] flex-none self-stretch" />
        <span
          aria-hidden
          className="lab-channel flex flex-none items-end gap-[2px] rounded-[2px] px-1 py-[3px]"
        >
          {/* Three descending heights: the shape of a board, and data rather
              than material, so it stays here and not in the class. */}
          {[13, 9, 5].map((height) => (
            <span
              key={height}
              style={{ height }}
              className={`block w-[3px] rounded-[1px] ${
                narrowed > 0 ? "lab-channel-bar-lit" : "lab-channel-bar"
              }`}
            />
          ))}
        </span>
        ADP
        {/* Nothing visible says what the lit bars mean, and there is no room to
            write it. */}
        {narrowed > 0 && (
          <span className="sr-only">
            — board narrowed by {narrowed} setting{narrowed === 1 ? "" : "s"}
          </span>
        )}
      </span>
    </button>
  );
}
