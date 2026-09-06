import type { CompCorpusInfo, CompCriterionId } from "@/shared/contract";
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

/**
 * The one line beside the result count that says what answered.
 *
 * **The scoring basis is on it because nothing else on the page says which
 * points these are.** Every PPG on a card is on one basis for the whole
 * corpus, and a reader comparing them against a league they play in has no way
 * to know which without it. It is four words in a caption rather than a panel,
 * on the page's own rule about not putting technical metadata in front of
 * somebody who came for a comp.
 *
 * The corpus's last complete season rides it for the same reason: "through
 * 2024" is what tells a reader in 2026 that they are looking at history rather
 * than at last season.
 */
export function corpusNote(info: CompCorpusInfo | null): string {
  if (info === null) return "";
  if (info.source === "unavailable") return "No corpus";
  if (info.source === "sample") return "Sample corpus";

  const parts = ["Stored corpus"];
  if (info.through_season !== null) parts.push(`through ${info.through_season}`);
  if (info.meta) parts.push(scoringLabel(info.meta.scoring));
  return parts.join(" · ");
}

/** A scoring key as a reader spells it. An unknown key prints itself. */
export function scoringLabel(scoring: string): string {
  switch (scoring) {
    case "half_ppr":
      return "half PPR";
    case "ppr":
      return "PPR";
    case "std":
      return "standard";
    default:
      return scoring;
  }
}

/**
 * The coverage badge's text, or null where there is nothing to say.
 *
 * **Silent at full coverage**, which is the ordinary case and the one a badge
 * would only clutter. Below it the figure is what a reader needs to weigh the
 * comp: a season compared on three quarters of the criteria is a weaker
 * statement than one compared on all of them, and the distance alone cannot
 * say so — it is divided by the weight it *had*, which is exactly what makes
 * a sparse row look confident.
 *
 * Rounded down, so a badge never claims more coverage than the row has.
 */
export function coverageLabel(coverage: number): string | null {
  if (!Number.isFinite(coverage)) return null;
  const percent = Math.floor(coverage * 100);
  if (percent >= 100) return null;
  return `${percent}% stat coverage`;
}
