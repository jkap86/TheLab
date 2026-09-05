/**
 * Small display formatters shared across features.
 *
 * `ordinal` began beside the rank tiles in `features/manager`; the trades
 * board's pick labels ("2026 1st") are the second reader, which is the line
 * that moves a client piece here. The two instant formatters came the same way:
 * the trade card's plate wrote them inline until the timeline rail had to print
 * the same moment, and a second spelling of "when" is how two parts of one
 * console come to punctuate a date differently.
 */

/**
 * An ordinal's two halves: the digits, and the suffix English insists on.
 *
 * Split because the league card's rank windows **demote the suffix** — the
 * numeral is what a reader is scanning a page of cards for, so `nd` is drawn a
 * size down, a weight lighter and at 55% opacity, and two type treatments in
 * one string need two elements. {@link ordinal} composes them back, so the
 * 11th–13th rule has exactly one spelling: a second copy of it beside the tile
 * is a card reading "11st" on the one league where anybody would notice.
 */
export function ordinalParts(n: number): { figure: string; suffix: string } {
  const tens = n % 100;
  const suffix =
    tens >= 11 && tens <= 13
      ? "th"
      : n % 10 === 1
        ? "st"
        : n % 10 === 2
          ? "nd"
          : n % 10 === 3
            ? "rd"
            : "th";
  return { figure: `${n}`, suffix };
}

/** `1st`, `2nd`, `3rd`, `4th` — with the 11th–13th rule English insists on. */
export function ordinal(n: number): string {
  const { figure, suffix } = ordinalParts(n);
  return `${figure}${suffix}`;
}

/**
 * A moment's date, in the console's own grammar.
 *
 * `year` is the caller's, because the trade card drops it below `sm` — the
 * board answers one season by construction, so the year is the most redundant
 * token on a 322px plate — while the timeline rail keeps it, since a league's
 * log can cross a new year.
 */
export function formatInstantDate(
  at: number | null,
  { year = true }: { year?: boolean } = {},
): string {
  if (at === null) return "date unknown";
  return new Date(at).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    ...(year ? { year: "numeric" as const } : {}),
  });
}

/**
 * The clock half, formatted apart from the date above.
 *
 * The two are never taken from one `toLocaleString`, which glues them with a
 * second comma — `Aug 28, 2026, 9:42 PM` reads as a three-part list where the
 * plate is saying two things. The caller joins them on the console's own
 * separator.
 */
export function formatInstantTime(at: number | null): string {
  if (at === null) return "";
  return new Date(at).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}
