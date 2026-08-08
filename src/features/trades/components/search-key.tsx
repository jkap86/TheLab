"use client";

import { SEATS } from "@/features/shared/ui/league-filters-seat";

/**
 * The key that opens the board's search, on the pinned control rail.
 *
 * **The bays are behind a press now, and this is the press.** They led the list
 * permanently — two half-width plates and a swap key above every board, whether
 * or not anyone was composing a question with them — which is a control paying
 * for its height out of the cards on a page whose whole content is cards. A
 * reader who arrives wanting *the market* rather than a particular player never
 * touches them, and the rail above already says what they hold.
 *
 * **Collapsing is only safe because two things keep saying what is in there**,
 * and both are on this rail rather than in the panel: the narrowing line spells
 * the selection out in words (`tradeFilterSummary`), and this key carries the
 * count. That is the same bargain the league filters' own dialog makes one seat
 * over — a modal hides its state, so the state is restated outside it.
 *
 * **It is a glyph and a badge, where the key beside it carries a word, and that
 * asymmetry is bought from the same slack.** This rail's container caps at ~900px,
 * so its width is fixed on every desktop rather than growing with the viewport:
 * measured, spelling `Search` out contracted the narrowing line to `2026 · all…`
 * at every width from `sm` up — and that line is precisely what has to keep
 * speaking now that the bays are shut. A magnifier is the one glyph on this rail
 * that reads without its word; `aria-label` and `title` are what it says to a
 * reader who needs it spelled, the desktop backstop the contracted player names
 * already use.
 *
 * **The box is the league filters key's, less the padding that word needs.** Two
 * keys on one milled face at different heights is a row that reads as a mistake
 * before it reads as a hierarchy, so the seat's own type scale, radius and
 * vertical padding are read from {@link SEATS} rather than respelled; what a
 * key with nothing but a glyph in it cannot take is `pl-3 pr-3.5`, which is
 * lopsided around a centred mark. So the horizontal inset is this part's and
 * everything deciding its height is the seat's.
 *
 * The lit face means the same thing it means everywhere else here: something is
 * narrowing. Expanded-but-empty stays unlit — what a reader can see is not a
 * filter — so the two states are told apart by `aria-expanded` and by the bays
 * being on screen, not by the accent.
 */
export function SearchKey({
  expanded,
  active,
  controls,
  onToggle,
}: {
  expanded: boolean;
  /** How many things the bays hold — see `sideSelectionCount`. */
  active: number;
  /** The bays' own id, while they are on screen to point at. */
  controls: string | undefined;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={expanded}
      aria-controls={controls}
      aria-label="Search trades"
      title="Search trades"
      className={`inline-flex shrink-0 items-center px-2.5 font-semibold ${
        SEAT_HEIGHT
      } ${active > 0 ? "lab-chip-on" : "lab-chip text-foreground/85"}`}
    >
      <SearchGlyph dim={active === 0} size={SEATS.free.icon} />
      {active > 0 && (
        <span
          className={`rounded-[5px] bg-[#052029] font-bold leading-none text-active ${SEATS.free.badge}`}
        >
          {active}
        </span>
      )}
    </button>
  );
}

/**
 * Everything in the league filters key's seat that decides how tall it stands,
 * with its word-side padding left out — see the note above. Read from the seat
 * rather than copied, so the two keys cannot come to different heights, and
 * asserted against it in `search-key.render.test.ts` because a class string is
 * the category of thing that is invisible in review and only wrong on screen.
 */
const SEAT_HEIGHT = SEATS.free.key
  .split(" ")
  .filter((cls) => !cls.startsWith("pl-") && !cls.startsWith("pr-"))
  .join(" ");

/**
 * A magnifier, drawn on the filter icon's own terms: one stroke weight, round
 * caps, and the dark stroke once the face beneath it is lit — a cyan-on-cyan
 * glyph is the one way a lit key can say less than an unlit one.
 */
function SearchGlyph({ dim, size }: { dim: boolean; size: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden="true"
      className={`${size} ${dim ? "stroke-foreground/55" : "stroke-[#052029]"}`}
      fill="none"
      strokeWidth={1.6}
      strokeLinecap="round"
    >
      <circle cx="7" cy="7" r="4.25" />
      <path d="M10.2 10.2 14 14" />
    </svg>
  );
}
