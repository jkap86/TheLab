"use client";

import type { Subject, SubjectLabel, SubjectMatch } from "../subjects.ts";

import { Avatar } from "./avatar";
import { PositionBadge } from "./position-badge";

/**
 * The two small parts the *who is in it* selection is drawn with, wherever it is
 * being edited: the token a chosen subject leaves, and the all/any mode.
 *
 * They live here because the selection now has three places it is worked in — the
 * rail's storey and each shares sheet's — and all of them have to say the same
 * thing about the same state. A token retyped in the second place is how one of
 * them ends up with a different dismiss target or a different pill, which a reader
 * reads as several different selections rather than one seen three times.
 */

/** One chosen subject, named and dismissable. */
export function SubjectToken({
  subject,
  label,
  onRemove,
}: {
  subject: Subject;
  /**
   * How to draw it — {@link SubjectLabel} rather than a menu row, because a
   * token is drawn beside lists that hold only one of the two kinds and the
   * resolver that answers for both (`subjectDisplay`) has no `count` to give.
   * Null until the maps naming it load, where the id is what there is to show.
   */
  label: SubjectLabel | null;
  onRemove: () => void;
}) {
  const name = label?.name ?? subject.id;
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-active/30 bg-active/10 py-0.5 pl-1.5 pr-1 text-[0.6875rem] text-foreground/90">
      {subject.kind === "player" ? (
        <PositionBadge position={label?.position ?? null} />
      ) : (
        <Avatar url={label?.avatarUrl ?? null} name={name} size="sm" />
      )}
      <span className="max-w-[10rem] truncate">{name}</span>
      <button
        type="button"
        aria-label={`Stop filtering by ${name}`}
        onClick={onRemove}
        className="px-0.5 leading-none text-foreground/45 transition-colors hover:text-[#ff5f6d]"
      >
        ×
      </button>
    </span>
  );
}

/**
 * Whether every subject has to be present or only one of them.
 *
 * Drawn only once there is a second subject for it to mean anything about — a
 * control over a set of one is a control with one answer. That gate is the
 * caller's, since the two places this rides have different room to spare.
 */
export function MatchToggle({
  match,
  onMatch,
}: {
  match: SubjectMatch;
  onMatch: (match: SubjectMatch) => void;
}) {
  return (
    <>
      <span className="font-mono text-[0.625rem] font-semibold uppercase tracking-[0.14em] text-foreground/40">
        Match
      </span>
      {(["all", "any"] as const).map((value) => (
        <button
          key={value}
          type="button"
          aria-pressed={match === value}
          onClick={() => onMatch(value)}
          className={`rounded-full px-2.5 py-0.5 text-[0.6875rem] font-bold ${
            match === value
              ? "lab-chip lab-chip-sm lab-chip-on"
              : "lab-chip lab-chip-sm text-foreground/60 hover:text-foreground"
          }`}
        >
          {value}
        </button>
      ))}
    </>
  );
}
