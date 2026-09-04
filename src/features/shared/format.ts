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

/** `1st`, `2nd`, `3rd`, `4th` — with the 11th–13th rule English insists on. */
export function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
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
