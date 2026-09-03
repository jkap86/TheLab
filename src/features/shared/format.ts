/**
 * Small display formatters shared across features.
 *
 * `ordinal` began beside the rank tiles in `features/manager`; the trades
 * board's pick labels ("2026 1st") are the second reader, which is the line
 * that moves a client piece here.
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
