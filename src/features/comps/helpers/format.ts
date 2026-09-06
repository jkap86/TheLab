import type { CompCriterionId } from "@/shared/contract";
import { UDFA_PICK } from "../../../shared/comps/criteria.ts";

/**
 * The comps page's figures, spelled once.
 *
 * Every figure on the page is tabular mono, and the three rules here are the
 * ones a second spelling would drift on: a delta's sign is U+2212 rather than
 * a hyphen and a zero carries no sign at all; a draft pick at or past the
 * UDFA mark prints as the word rather than a number nobody was drafted at;
 * and a criterion's chip prints its figure in the unit the criterion's own
 * readout uses, so `Tgt sh 27%` on a chip is the same reading as `Tgt sh 27%`
 * in the pane.
 */

/** A number to a fixed count of decimals, grouped. */
export function num(value: number, digits = 0): string {
  return value.toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

/**
 * A signed change: `+4.2`, `−1.8`, and `0` for none. The minus is U+2212 so
 * it sets at the same width as the plus in a tabular column.
 */
export function signedDelta(value: number, digits = 0): string {
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  return `${sign}${num(Math.abs(value), digits)}`;
}

/** `UDFA` at or past the undrafted mark, else `#<pick>`. */
export function draftLabel(pick: number | null): string {
  if (pick === null || pick >= UDFA_PICK) return "UDFA";
  return `#${pick}`;
}

/** A criterion's figure as its chip prints it. */
export function criterionValue(criterion: CompCriterionId, raw: number): string {
  switch (criterion) {
    case "yprr":
      return raw.toFixed(2);
    case "tgtsh":
    case "snap":
      return `${num(raw)}%`;
    case "ppg":
      return num(raw, 1);
    case "draft":
      return draftLabel(raw);
    case "age":
    case "exp":
      // A windowed read never lands here, and a fact is a whole number.
      return num(raw);
    default:
      return num(raw);
  }
}

/** A weight as the rail's readout prints it: `1.6×`. */
export function weightLabel(weight: number): string {
  return `${weight.toFixed(1)}×`;
}
