"use client";

import { useEffect, useId, useRef, useState } from "react";

import type {
  KtcBoardChoice,
  TradeValueBasis,
  TradeValueSources,
} from "@/shared/contract";
import {
  CONSOLE_KEY_PILL,
  CONSOLE_READOUT,
  KtcBoardKeys,
  TRADE_VALUE_BASES,
  rankColor,
  storeKtcBoard,
} from "@/features/shared";

/**
 * The board's value basis, as one key that names its own state and opens a
 * panel.
 *
 * **Every figure on this board used to be KeepTradeCut and nothing said so.**
 * KTC is one answer to "what is this worth" and the app already derives two
 * others — the ADP curve the manager page prices a roster's capital with, and a
 * rest-of-season projection under the league's own scoring — so the board
 * offers all three and the key names which is in force. That is the whole
 * reason it is a key with a legend rather than an icon: a closed panel still
 * has to say what the numbers on screen are.
 *
 * **A panel rather than a track of three keys**, which is what the explorations
 * rejected. Three bases need a sentence each — a reader has to be told that
 * capital is a draft curve and points are this league's scoring, or the figures
 * are three unlabelled scales — and a rail key has room for a word.
 *
 * **The KeepTradeCut board keys moved in here with it.** Auto/Dynasty/Redraft
 * is a KTC question and says nothing on the other two bases, so out on the rail
 * it read as a second control over every number on the page. Inside, it is
 * plainly what it is: part of what *one* of the three bases means. It is the
 * same move that put it at the foot of the manager page's Columns dialog, and
 * for the same reason.
 *
 * **Not a `<dialog>`**, on `ToolsMenu`'s terms: a modal that trapped focus and
 * dimmed the page to offer three lamps would be heavier than the lamps are
 * worth, and — the part that matters here — **the panel deliberately stays open
 * on a press.** Switching basis is comparative: a reader flips between two to
 * watch the same card change, and a panel that closed on the first press would
 * make the second one two presses. So the dismissal a `<dialog>` gives for free
 * is spelled out below.
 *
 * **The panel is the rail's width, not the key's**, which is why this renders a
 * fragment and the caller's rail carries the `relative`. Anchored to the key it
 * would be a 23rem box hanging off a control two thirds of the way along a
 * 362px row, and at a phone's width it would leave the viewport on the left.
 * Anchored to the rail its right edge is the shell's own gutter and it can
 * never do that — the same reasoning `display: contents` earns in the rack.
 */
export function ValuePanel({
  basis,
  onBasis,
  board,
  sources,
}: {
  basis: TradeValueBasis;
  onBasis: (basis: TradeValueBasis) => void;
  /** The reader's KeepTradeCut market choice — see `useKtcBoard`. */
  board: KtcBoardChoice;
  /** What answered on each basis; null before the first page lands. */
  sources: TradeValueSources | null;
}) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    // Pointerdown rather than click, and in the capture phase: a press that
    // starts outside should dismiss before whatever it landed on acts on it.
    const onDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (panel.current?.contains(target)) return;
      if (trigger.current?.contains(target)) return;
      setOpen(false);
    };
    // Escape returns focus to the key it came from — the one piece of the
    // `<dialog>` behaviour that is not optional.
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      trigger.current?.focus();
    };

    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const ktcBasis = basis === "ktc";

  return (
    <>
      <button
        ref={trigger}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen((value) => !value)}
        // **Always lit**, because a basis is always in effect. The key is not a
        // toggle that is on or off; it is a readout of a setting that has no
        // neutral state, so an unlit face would be a face that never renders.
        className={`${CONSOLE_KEY_PILL} border-active/40 bg-[image:var(--key-bg)] text-readout shadow-[var(--key-shadow)] [text-shadow:var(--readout-text-glow)]`}
      >
        Value · {keyLegend(basis, board)}
      </button>

      {open && (
        <div
          ref={panel}
          id={panelId}
          role="dialog"
          aria-label="Asset value"
          className="absolute right-0 top-full z-40 mt-2.5 w-[min(23rem,100%)] overflow-hidden rounded-[1.25rem] border border-foreground/12 bg-background bg-[image:var(--panel-bg)] p-5 text-left shadow-[var(--panel-shadow),0_24px_60px_-34px_var(--surface-shadow)]"
        >
          <span
            aria-hidden
            className="pointer-events-none absolute inset-0 bg-[image:var(--panel-grain)]"
          />
          <div className="relative">
            <div className="flex items-center justify-between gap-3">
              <h2 className="m-0 font-display text-base font-semibold tracking-[-0.01em]">
                Asset value
              </h2>
              {/* The unit in force, on glass: the one thing on this panel that
                  is a readout rather than a control. */}
              <span
                className={`${CONSOLE_READOUT} inline-flex shrink-0 items-center rounded-full px-2.5 py-1`}
              >
                <span
                  aria-hidden
                  className="pointer-events-none absolute inset-0 bg-[image:var(--readout-scanlines)]"
                />
                <span className="relative font-mono text-[0.6875rem] uppercase tracking-[0.16em] text-readout [text-shadow:var(--readout-text-glow)]">
                  {BASES[basis].unit}
                </span>
              </span>
            </div>
            <p className="mt-1.5 font-mono text-[0.6875rem] leading-normal text-foreground/58">
              One basis at a time. Every value on the board is on it, and the
              colour is that asset&rsquo;s place among the priced assets in its
              own league.
            </p>

            <ul
              role="radiogroup"
              aria-label="Value basis"
              className="m-0 mt-4 flex list-none flex-col gap-0.5 p-0"
            >
              {TRADE_VALUE_BASES.map((id) => (
                <li key={id}>
                  <BasisLamp
                    id={id}
                    lit={id === basis}
                    onPick={() => onBasis(id)}
                    sources={sources}
                  />
                </li>
              ))}
            </ul>

            <div className="mt-4 border-t border-foreground/10 pt-4">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1.5">
                <span className="font-mono text-[0.625rem] uppercase tracking-[0.16em] text-foreground/50">
                  KTC board
                </span>
                {/* What answered and when, the courtesy the manager page's own
                    board keys extend: these are someone else's numbers on a
                    fifteen-minute cache. Silent where nothing could be read —
                    the board is already a column of em dashes and saying it
                    twice adds nothing. */}
                {sources?.ktc && (
                  <span className="font-mono text-[0.625rem] uppercase tracking-[0.16em] text-foreground/45">
                    {board === "auto" ? sources.ktc.auto_board : board}
                    {scrapedLabel(board, sources.ktc)}
                  </span>
                )}
              </div>
              {/* **Disabled rather than dimmed-but-pressable.** The prototype
                  leaves the keys live on the other two bases; a key that
                  visibly changes nothing is a key a reader presses twice and
                  then distrusts, and this app's own rule is to make an
                  ineffective control unreachable rather than to let it be
                  pressed and ignored — the columns picker greys its fifth box,
                  the shares drawer hides its all/any toggle above one subject.
                  Real `disabled` rather than `aria-disabled` is safe here
                  because nothing inside this group has focus when the basis
                  moves: the press that disables them landed on a lamp above. */}
              <KtcBoardKeys
                board={board}
                onChange={storeKtcBoard}
                disabled={!ktcBasis}
                className={`mt-2 ${ktcBasis ? "" : "opacity-40"}`}
              />
              <p className="mt-2 font-mono text-[0.6875rem] leading-normal text-foreground/52">
                {ktcBasis
                  ? "Auto reads a dynasty league on the dynasty board and everything else on redraft."
                  : "Only the KTC basis reads a board."}
              </p>
            </div>

            <div className="mt-4 border-t border-foreground/10 pt-4">
              <span className="font-mono text-[0.625rem] uppercase tracking-[0.16em] text-foreground/50">
                Colour
              </span>
              {/* The ramp is read from `rankColor` rather than transcribed as
                  three `oklch()` literals: its ends come off `--rank-l` and
                  `--rank-c`, which are what invert for light mode. A literal
                  legend would be right in one theme and wrong in the other,
                  under a card whose bars were still right in both. */}
              <span
                aria-hidden
                className="mt-2 block h-1.5 w-full rounded-full shadow-[inset_0_1px_3px_rgba(0,0,0,0.95)]"
                style={{
                  backgroundImage: `linear-gradient(to right, ${rankColor(0)}, ${rankColor(50)}, ${rankColor(100)})`,
                }}
              />
              <div className="mt-1.5 flex items-baseline justify-between gap-2 font-mono text-[0.5625rem] uppercase tracking-[0.18em] text-foreground/45">
                <span>Last in the league</span>
                <span>Mid-pack</span>
                <span>First</span>
              </div>
              <p className="mt-2 font-mono text-[0.6875rem] leading-normal text-foreground/52">
                The manager page&rsquo;s rank ramp. It colours what a side{" "}
                <em className="not-italic text-foreground/70">received</em> only
                — the give track stays muted, and no total is coloured.
              </p>
            </div>

            <div className="mt-4 flex justify-end">
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  trigger.current?.focus();
                }}
                className={`${CONSOLE_KEY_PILL} border-active/50 bg-[image:var(--key-bg)] px-5 text-[0.625rem] text-readout shadow-[var(--key-shadow),0_0_22px_-8px_var(--accent-glow)] [text-shadow:var(--readout-text-glow)]`}
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/**
 * The three bases, as the panel names them.
 *
 * `unit` is the short form the side headers and the panel's own readout print —
 * three figures on three scales never share a column without one, which is the
 * rule the manager card's lens keys already live by.
 */
const BASES: Record<
  TradeValueBasis,
  { title: string; unit: string; legend: string; note: string }
> = {
  capital: {
    title: "Capital",
    unit: "CAP",
    legend: "Capital",
    note: "Draft capital — the ADP curve, 10,000 at pick 1",
  },
  ktc: {
    title: "KTC",
    unit: "KTC",
    legend: "KTC",
    note: "KeepTradeCut — the market board",
  },
  ros: {
    title: "Pts ROS",
    unit: "PTS",
    legend: "Pts ROS",
    note: "Projected points — rest of season, this league's scoring",
  },
};

/**
 * The key's own legend: the basis, and — on KeepTradeCut alone — which board.
 *
 * The board is named only where it means something, which is the same rule that
 * moved the keys into the panel. `Value · Capital` with a market appended would
 * be a key claiming a setting it is not on.
 */
function keyLegend(basis: TradeValueBasis, board: KtcBoardChoice): string {
  if (basis !== "ktc") return BASES[basis].legend;
  return `KTC ${board.charAt(0).toUpperCase()}${board.slice(1)}`;
}

/**
 * How long ago the market in force was scraped, or nothing where it has not
 * been read.
 *
 * On `auto` the two markets can have been scraped at different moments and both
 * are in play, so the **older** is what is reported: a staleness line has to be
 * the worst true thing it can say, not the best.
 */
function scrapedLabel(
  board: KtcBoardChoice,
  ktc: NonNullable<TradeValueSources["ktc"]>,
): string {
  const times =
    board === "auto"
      ? [ktc.scraped_at.dynasty, ktc.scraped_at.redraft]
      : [ktc.scraped_at[board]];
  const oldest = times
    .filter((iso): iso is string => iso !== null)
    .map((iso) => Date.parse(iso))
    .filter((at) => Number.isFinite(at))
    .sort((a, b) => a - b)[0];
  return oldest === undefined ? "" : ` · ${scrapedAt(oldest)}`;
}

/**
 * How long ago, in the coarsest unit that is still true — the same reading the
 * columns dialog gives its own board, and coarse for the same reason: the
 * sync's TTL is fifteen minutes, so anything finer is precision the number does
 * not have.
 */
function scrapedAt(at: number): string {
  const minutes = Math.floor((Date.now() - at) / 60_000);
  if (!Number.isFinite(minutes) || minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours}h ago` : `${Math.floor(hours / 24)}d ago`;
}

/**
 * One basis, as an indicator lamp over a title and a line of copy.
 *
 * A `radio` rather than the columns picker's checkbox, because these are one of
 * three rather than four of nine — and the lamp itself is the same object drawn
 * the same way, with the real input underneath it so the keyboard behaviour,
 * the label association and the group semantics stay the browser's.
 *
 * **A basis that can price nothing says so and stays pressable.** It is not an
 * invalid state — a reader is entitled to look at a board of dashes and see
 * that the basis has no data behind it — and the alternative, a lamp greyed out
 * with no reason given, is the failure this note exists to prevent: a control
 * that is unreachable for a reason nothing on screen states.
 */
function BasisLamp({
  id,
  lit,
  onPick,
  sources,
}: {
  id: TradeValueBasis;
  lit: boolean;
  onPick: () => void;
  sources: TradeValueSources | null;
}) {
  const empty = sources !== null && !hasSource(id, sources);
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-[0.625rem] px-2 py-[0.4375rem] transition-colors hover:bg-foreground/[0.04]">
      <input
        type="radio"
        name="trade-value-basis"
        checked={lit}
        onChange={onPick}
        className="peer sr-only"
      />
      <span
        aria-hidden
        className="mt-0.5 inline-flex size-[1.125rem] shrink-0 items-center justify-center rounded-[0.3125rem] border border-black/80 bg-[image:var(--key-bg)] shadow-[inset_0_2px_5px_rgba(0,0,0,0.6)] transition-[box-shadow,border-color] duration-150 peer-checked:border-active/55 peer-checked:bg-[image:var(--readout-bg)] peer-checked:shadow-[var(--readout-shadow),0_0_14px_-4px_var(--accent-glow)] peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-active/60"
      >
        <span
          className={`size-[0.4375rem] rounded-full transition-opacity duration-150 ${
            lit ? "bg-active opacity-100 shadow-[0_0_9px_var(--accent-glow)]" : "opacity-0"
          }`}
        />
      </span>
      <span className="min-w-0 flex-1">
        <span
          className={`block font-display text-[0.8125rem] font-semibold ${
            lit ? "text-readout" : "text-foreground/88"
          }`}
        >
          {BASES[id].title}
        </span>
        <span className="block font-mono text-[0.6875rem] leading-normal text-foreground/52">
          {BASES[id].note}
        </span>
        {empty && (
          <span className="mt-0.5 block font-mono text-[0.625rem] uppercase tracking-[0.16em] text-foreground/45">
            Nothing stored to price against
          </span>
        )}
      </span>
    </label>
  );
}

/** Whether the page could read anything at all on this basis. */
function hasSource(id: TradeValueBasis, sources: TradeValueSources): boolean {
  if (id === "ktc") return sources.ktc !== null;
  return (id === "capital" ? sources.capital : sources.ros) !== null;
}
