"use client";

import { ModeTrack, type SubjectMode } from "@/features/shared";

import type { ModeCounts } from "../helpers/leaguemate-rosters";

/**
 * The three readings a picked player has: **Owned · Taken · Available**.
 *
 * It says which leagues the pick narrows to — the ones the reader rosters him
 * in, the ones a leaguemate does, the ones nobody does — and it exists because
 * a share is only one of those three questions. The row above it answered
 * "where do I have him"; the other two are what a reader opens a shares panel
 * to ask next.
 *
 * **The look is `features/shared`'s `ModeTrack`**, since the gametime stat
 * board's pane draws the same part over its own readings; what is here is the
 * vocabulary.
 *
 * **The counts sum to the leagues that answered, not to the panel's own count**
 * — see `playerModeCounts`. A league whose rosters were never stored is in none
 * of the three, because an absence is not evidence that anybody is free in it,
 * and a player held only by an orphan team is in none of them either. So they
 * are three figures rather than a breakdown of one, and the panel prints its
 * population separately.
 *
 * **The Share column keeps its meaning in every mode** — leagues *you* roster
 * him in — and the mode's own figure rides the key that sets it. A column is
 * one question; changing what `Share` counts when a key is pressed would leave
 * the header naming something else.
 *
 * **Pressing the lit key does not clear the pick.** The three are mutually
 * exclusive and one is always on, so there is no off position here; clearing is
 * the row's own press, one line up, which is where a reader already reaches for
 * it.
 */
const MODES: { id: SubjectMode; label: string; note: string }[] = [
  {
    id: "owned",
    label: "Owned",
    note: "Narrowing to the leagues you roster him in",
  },
  {
    id: "taken",
    label: "Taken",
    note: "Narrowing to the leagues a leaguemate rosters him in",
  },
  {
    id: "available",
    label: "Available",
    note: "Narrowing to the leagues nobody rosters him in",
  },
];

export function PlayerModeTrack({
  mode,
  counts,
  onPick,
  playerName,
}: {
  mode: SubjectMode;
  /** Null while the rosters read is in flight — the keys say so with a dash. */
  counts: ModeCounts | null;
  onPick: (mode: SubjectMode) => void;
  playerName: string;
}) {
  return (
    <ModeTrack
      legend="Leagues"
      label={`Which leagues ${playerName} narrows to`}
      options={MODES.map(({ id, label }) => ({ id, label, count: counts?.[id] ?? null }))}
      value={mode}
      onPick={onPick}
      note={MODES.find((m) => m.id === mode)?.note ?? ""}
      // The left inset clears the badge above `@md`, so the track starts under
      // the name rather than under the row's own bezel — it is about the
      // player, not a second thing beside him.
      //
      // **Below `@md` it is the row's own gutter instead, and a render at 390
      // is what asked for that.** The three keys are 286px of a 354px panel,
      // and 49 of indentation left them 284 — so the track ran past the panel's
      // own box with nothing on screen saying so. Shortening the words was the
      // alternative and is worse — "Available" is the whole of what that key
      // says.
      className="pb-[0.5625rem] pl-[0.6875rem] pr-[0.6875rem] @md:pl-[3.0625rem]"
    />
  );
}
