import type { CompCriterionId, CompMatch, CompSubject } from "@/shared/contract";
import {
  POSITION_PRESETS,
  criterionAppliesTo,
  isCompPosition,
} from "../../../shared/comps/criteria.ts";

import { draftLabel, num } from "./format.ts";

/**
 * Which lines a position's readouts and panes draw, spelled once.
 *
 * The subject housing, a comp card's season pane and its payoff pane each
 * used to draw a receiver's lines for every position — `Rec yd`, `Tgt sh`,
 * `YPRR` under a quarterback, reading `0`, `0%` and an em dash — while the
 * criteria panel beside them had already learned which criteria a position
 * can answer. So the rule here is the panel's own: **a line is drawn where
 * its criterion applies to the position** (`POSITION_CRITERIA`, through
 * `criterionAppliesTo`), with one narrowing for the two criteria that are
 * offered everywhere and a signal only somewhere — rushing and total points
 * are drawn where the position's *preset* weights them, because a receiver's
 * twenty rushing yards is a row spent on nothing where a back's are the
 * season. A position the vocabulary does not know draws the vocabulary's own
 * lines, which is what the panel does too.
 *
 * Pure, and under Node's runner, for `criteria-state`'s reason: a row that
 * appears under the wrong position renders perfectly and says something
 * untrue.
 */

export type SeasonLineId =
  | "age"
  | "exp"
  | "draft"
  | "ppg"
  | "pts"
  | "rush"
  | "recyd"
  | "rec"
  | "tgtsh"
  | "yprr"
  | "snap"
  | "gp";

/** Every line in the order the readouts draw them, with the criterion it reads. */
const LINES: readonly { id: SeasonLineId; label: string; criterion: CompCriterionId }[] = [
  { id: "age", label: "Age", criterion: "age" },
  { id: "exp", label: "Exp", criterion: "exp" },
  { id: "draft", label: "Draft", criterion: "draft" },
  { id: "ppg", label: "PPG", criterion: "ppg" },
  { id: "pts", label: "Pts", criterion: "pts" },
  { id: "rush", label: "Rush yd", criterion: "rush" },
  { id: "recyd", label: "Rec yd", criterion: "recyd" },
  { id: "rec", label: "Rec", criterion: "recyd" },
  { id: "tgtsh", label: "Tgt sh", criterion: "tgtsh" },
  { id: "yprr", label: "YPRR", criterion: "yprr" },
  { id: "snap", label: "Snap", criterion: "snap" },
  { id: "gp", label: "GP", criterion: "gp" },
];

/** Offered for every position, drawn only where the position's preset weights it. */
const PRESET_GATED: readonly CompCriterionId[] = ["rush", "pts"];

export const LINE_LABELS: Readonly<Record<SeasonLineId, string>> = Object.fromEntries(
  LINES.map((l) => [l.id, l.label]),
) as Record<SeasonLineId, string>;

/** The lines a position draws, in order. */
export function seasonLines(position: string | null): SeasonLineId[] {
  return LINES.filter((line) => lineDrawn(line.criterion, position)).map((l) => l.id);
}

function lineDrawn(criterion: CompCriterionId, position: string | null): boolean {
  if (position === null || !isCompPosition(position)) {
    // The vocabulary's own defaults are the receiver's, and the two gated
    // criteria are off in them.
    return !PRESET_GATED.includes(criterion);
  }
  if (!criterionAppliesTo(criterion, position)) return false;
  if (PRESET_GATED.includes(criterion)) {
    return POSITION_PRESETS[position][criterion] !== undefined;
  }
  return true;
}

export type SeasonLineRow = { id: SeasonLineId; label: string; value: string };

/** The subject housing's lit windows: his last line and his three facts. */
export function subjectReadouts(subject: CompSubject): SeasonLineRow[] {
  return seasonLines(subject.position).map((id) => ({
    id,
    label: LINE_LABELS[id],
    value: subjectValue(subject, id),
  }));
}

function subjectValue(subject: CompSubject, id: SeasonLineId): string {
  switch (id) {
    case "age":
      return String(subject.age);
    case "exp":
      return `${subject.exp} yr`;
    case "draft":
      return draftLabel(subject.draft);
    default:
      return lineValue(subject.line, id);
  }
}

/** The lines a comp card's season pane draws: age and the season's own line. */
const PANE_LINES: readonly SeasonLineId[] = [
  "age",
  "ppg",
  "pts",
  "rush",
  "recyd",
  "rec",
  "tgtsh",
  "yprr",
  "gp",
];

export function compSeasonRows(comp: CompMatch): SeasonLineRow[] {
  const drawn = new Set(seasonLines(comp.position));
  return PANE_LINES.filter((id) => drawn.has(id)).map((id) => ({
    id,
    label: LINE_LABELS[id],
    value: id === "age" ? String(comp.age) : lineValue(comp.line, id),
  }));
}

export type PayoffRow = SeasonLineRow & {
  /** The change against the comp season's own line; null where there is no figure to move. */
  delta: number | null;
};

/**
 * The payoff pane: what the following season's line carries, against the
 * comp season's, in the lines the position draws. `finish` rides at the end
 * as its own row rather than a line, since it is a rank rather than a figure.
 */
export function payoffRows(comp: CompMatch): PayoffRow[] {
  const drawn = new Set(seasonLines(comp.position));
  const rows: PayoffRow[] = [];
  if (drawn.has("ppg")) {
    rows.push({
      id: "ppg",
      label: LINE_LABELS.ppg,
      value: num(comp.next.ppg, 1),
      delta: comp.next.ppg - comp.line.ppg,
    });
  }
  if (drawn.has("recyd")) {
    rows.push({
      id: "recyd",
      label: LINE_LABELS.recyd,
      value: num(comp.next.recyd),
      delta: comp.next.recyd - comp.line.recyd,
    });
  }
  if (drawn.has("rec")) {
    rows.push({
      id: "rec",
      label: LINE_LABELS.rec,
      value: String(comp.next.rec),
      delta: comp.next.rec - comp.line.rec,
    });
  }
  rows.push({
    id: "gp",
    label: LINE_LABELS.gp,
    value: String(comp.next.gp),
    delta: comp.next.gp - comp.line.gp,
  });
  return rows;
}

function lineValue(line: CompMatch["line"], id: SeasonLineId): string {
  switch (id) {
    case "ppg":
      return num(line.ppg, 1);
    case "pts":
      return num(line.pts, 1);
    case "rush":
      return num(line.rush);
    case "recyd":
      return num(line.recyd);
    case "rec":
      return String(line.rec);
    case "tgtsh":
      return line.tgtsh === null ? "—" : `${num(line.tgtsh)}%`;
    case "yprr":
      return line.yprr === null ? "—" : line.yprr.toFixed(2);
    case "snap":
      return line.snap === null ? "—" : `${num(line.snap)}%`;
    case "gp":
      return String(line.gp);
    default:
      return "—";
  }
}
