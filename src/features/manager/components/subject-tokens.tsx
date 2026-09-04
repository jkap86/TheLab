"use client";

import { CONSOLE_KEY_PILL, CONSOLE_WELL } from "@/features/shared";

import type { LeagueSubjects, Subject } from "../helpers/league-subjects";
import { subjectKey } from "../helpers/league-subjects";

/**
 * What the drawers left behind: one removable chip per picked subject, the mode
 * that combines them, and a way to clear the lot.
 *
 * **It exists because a drawer that is closed says nothing.** That is the same
 * problem `ViewHousing`'s readout solves for the two dialogs — both hide their
 * own state, so something on the page has to name the narrowing. A subject
 * narrowing needs more room than that readout has (it names people, not a
 * count), so it takes a tray of its own between the rule and the grid.
 *
 * The mode toggle appears only above one subject, because with one picked `all`
 * and `any` are the same question and a control with no effect is worse than no
 * control.
 */
export function SubjectTokens({
  subjects,
  names,
  onRemove,
  onMatch,
  onClear,
}: {
  subjects: LeagueSubjects;
  /** Resolves a subject to what the reader picked; falls back to the raw id. */
  names: (subject: Subject) => string;
  onRemove: (subject: Subject) => void;
  onMatch: (match: LeagueSubjects["match"]) => void;
  onClear: () => void;
}) {
  if (subjects.subjects.length === 0) return null;

  return (
    <div
      className={`${CONSOLE_WELL} relative mb-6 flex flex-wrap items-center gap-2 p-2.5`}
    >
      <span className="px-1 font-mono text-[0.625rem] uppercase tracking-[0.16em] text-foreground/50">
        Holding
      </span>

      {subjects.subjects.map((subject) => (
        <button
          key={subjectKey(subject)}
          type="button"
          onClick={() => onRemove(subject)}
          // The chip *is* the remove control, so its name has to say so — the
          // visible text is the subject, which alone reads as a label.
          aria-label={`Stop narrowing by ${names(subject)}`}
          className={`${CONSOLE_KEY_PILL} inline-flex items-center gap-2 border-active/45 bg-[image:var(--key-bg)] normal-case tracking-normal text-readout shadow-[var(--key-shadow)]`}
        >
          <span className="max-w-[12rem] truncate">{names(subject)}</span>
          <span aria-hidden className="text-[0.75rem] leading-none text-active">
            ×
          </span>
        </button>
      ))}

      {subjects.subjects.length > 1 && (
        <span
          className="inline-flex items-center gap-1 rounded-full p-1 shadow-[var(--track-shadow)]"
          role="group"
          aria-label="Combine subjects"
        >
          {(["all", "any"] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => onMatch(mode)}
              aria-pressed={subjects.match === mode}
              className={`${CONSOLE_KEY_PILL} px-3 py-1 ${
                subjects.match === mode
                  ? "border-active/45 bg-[image:var(--key-bg)] text-readout shadow-[var(--key-shadow)]"
                  : "border-transparent text-foreground/60 hover:text-readout"
              }`}
            >
              {mode}
            </button>
          ))}
        </span>
      )}

      <button
        type="button"
        onClick={onClear}
        className={`${CONSOLE_KEY_PILL} ml-auto border-foreground/10 bg-[image:var(--key-bg)] text-foreground/80 shadow-[var(--key-shadow)] hover:text-readout`}
      >
        Clear
      </button>
    </div>
  );
}
