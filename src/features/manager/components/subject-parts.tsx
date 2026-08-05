"use client";

import { Avatar, PositionBadge } from "@/features/shared";

import type { Subject, SubjectMatch, SubjectOption } from "../subjects";

/**
 * The two small parts the *who is in it* selection is drawn with, wherever it is
 * being edited: the token a chosen subject leaves, and the all/any mode.
 *
 * They live here because the selection now has two places it is worked in — the
 * rail's storey and the shares sheet's — and both have to say the same thing
 * about the same state. A token retyped in the second place is how one of them
 * ends up with a different dismiss target or a different pill, which a reader
 * reads as two different selections rather than one seen twice.
 */

/** One chosen subject, named and dismissable. */
export function SubjectToken({
  subject,
  option,
  onRemove,
}: {
  subject: Subject;
  /** Null until the lists load — the id is what there is to show until then. */
  option: SubjectOption | null;
  onRemove: () => void;
}) {
  const name = option?.name ?? subject.id;
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-active/30 bg-active/10 py-0.5 pl-1.5 pr-1 text-[11px] text-foreground/90">
      {subject.kind === "player" ? (
        <PositionBadge position={option?.position ?? null} />
      ) : (
        <Avatar url={option?.avatarUrl ?? null} name={name} size="sm" />
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
      <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground/40">
        Match
      </span>
      {(["all", "any"] as const).map((value) => (
        <button
          key={value}
          type="button"
          aria-pressed={match === value}
          onClick={() => onMatch(value)}
          className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${
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
