"use client";

import { CONSOLE_KEY, CONSOLE_WINDOW, Scanlines } from "@/features/shared";

import type { LeaguematePlayer } from "../helpers/leaguemate-rosters";

/**
 * The board of keys an expanded leaguemate row opens onto: every player they
 * roster across the leagues shared with them, one chip each.
 *
 * **A chip rail rather than a sub-tray of rows**, which was the alternative
 * drawn beside it. Two per line is what keeps a thirty-player roster on one
 * screen — a row apiece is thirty rows inside a list of rows, and the reader
 * loses which list they are in.
 *
 * **The tray is a channel, not a well.** `--track-shadow` over `bg-black/28`:
 * a well is the shallow tray a panel of controls sits in, and a track is the
 * deeper recess a *key* travels in. This holds a board of keys, so it is cut to
 * the depth they stand proud of. A black alpha rather than a `--foreground` one
 * for the reason the list tray above it takes one — a recess has to be darker
 * than its surround in **both** themes, and a foreground alpha inverts.
 *
 * **The pip is the share and the meter is the same figure**, which is why the
 * meter carries no number of its own: two readings of one count would be the
 * pip's own claim made twice, and the one a reader checks against the foot is
 * the number.
 */
export function LeaguemateRosterRail({
  players,
  leagueCount,
  total,
  showingAll,
  onShowAll,
  isPicked,
  onPick,
  mateName,
}: {
  /** Already scoped and sorted — see `leaguematePlayers`. */
  players: readonly LeaguematePlayer[];
  /** Leagues shared with them that contributed a roster set — the pip's scale. */
  leagueCount: number;
  /** How many the scope left, before the preview cap. */
  total: number;
  showingAll: boolean;
  onShowAll: () => void;
  isPicked: (playerId: string) => boolean;
  onPick: (playerId: string) => void;
  mateName: string;
}) {
  return (
    <div className="mx-2 mb-2 rounded-xl bg-black/[0.28] shadow-[var(--track-shadow)]">
      {players.length === 0 ? (
        <p className="m-0 px-2.5 py-3 font-mono text-[length:var(--fs-9)] uppercase tracking-[0.16em] text-foreground/46">
          {total === 0
            ? "No stored roster for them in these leagues."
            : "Nobody left under this roster filter."}
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-[0.3125rem] p-2 @md:grid-cols-2">
          {players.map((player) => (
            <Chip
              key={player.player_id}
              player={player}
              leagueCount={leagueCount}
              picked={isPicked(player.player_id)}
              onPick={() => onPick(player.player_id)}
              mateName={mateName}
            />
          ))}
        </div>
      )}

      {/* The foot says what the pip counts, because a bare figure on a key in a
          tray inside a row has nothing else near it that could. */}
      {(players.length > 0 || total > 0) && (
        <div className="flex items-center justify-between gap-2.5 px-2.5 pb-[0.5625rem]">
          {/* **It wraps rather than truncating**, which a render at 390 asked
              for: the legend is 36 characters against a 236px line once the
              key beside it is paid for, and `truncate` cut it at
              "…SHARED LEAGUES OF" — promising the denominator and then not
              giving it, which is the one half of the sentence that is
              load-bearing. Two lines on a phone is the cheaper loss. */}
          <span className="min-w-0 font-mono text-[length:var(--fs-8)] uppercase tracking-[0.18em] text-foreground/44">
            {total} player{total === 1 ? "" : "s"} · pip is shared leagues of{" "}
            {leagueCount}
          </span>
          {total > players.length || showingAll ? (
            <button
              type="button"
              onClick={onShowAll}
              className={`${CONSOLE_KEY} shrink-0 px-3 py-1 text-[length:var(--fs-10)]`}
            >
              {showingAll ? "Show fewer" : "Show all"}
            </button>
          ) : null}
        </div>
      )}
    </div>
  );
}

/**
 * One player, as a key that can be held down.
 *
 * Selected is `ShareRow`'s own treatment one size down — a lit border, the
 * pressed shadow, an inset wash and a halo — because it is the same act: a
 * press that narrows the grid, and a second press that undoes it.
 *
 * The position badge is the players panel's bezel at 1.5rem rather than
 * 1.875rem. It is the drawer's surface either way, which is what makes a chip
 * read as a row of that list seen small rather than as a different object.
 */
function Chip({
  player,
  leagueCount,
  picked,
  onPick,
  mateName,
}: {
  player: LeaguematePlayer;
  leagueCount: number;
  picked: boolean;
  onPick: () => void;
  mateName: string;
}) {
  // A held row is never drawn empty: at 1 of 12 a true-width bar reads as
  // "none" rather than as "one" — the list's own `ShareMeter` rule.
  const pct =
    leagueCount > 0 ? Math.round((player.held / leagueCount) * 100) : 0;

  return (
    <button
      type="button"
      onClick={onPick}
      aria-pressed={picked}
      // The visible text is a player's name, which alone reads as a label
      // rather than as what pressing it does.
      aria-label={`${player.name}, in ${player.held} of ${leagueCount} leagues with ${mateName}`}
      className={
        "flex min-w-0 items-center gap-[0.4375rem] rounded-[0.5625rem] border bg-[image:var(--key-bg)] px-[0.4375rem] py-[0.3125rem] text-left transition-[box-shadow,border-color] duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-active/60 " +
        (picked
          ? "border-active/50 shadow-[var(--key-shadow-pressed),inset_0_0_22px_color-mix(in_srgb,var(--accent)_14%,transparent),0_0_24px_-10px_var(--accent-glow)]"
          : "border-foreground/8 shadow-[var(--key-shadow)] hover:border-active/40")
      }
    >
      <span
        aria-hidden
        className={`inline-flex size-6 shrink-0 items-center justify-center rounded-[0.3125rem] border border-foreground/12 bg-[image:var(--bezel-bg)] font-mono text-[length:var(--fs-8)] uppercase shadow-[var(--bezel-shadow)] ${
          picked ? "text-readout" : "text-foreground/68"
        }`}
      >
        {player.position ?? "—"}
      </span>

      <span className="min-w-0 flex-1">
        <span
          className={`block truncate text-[length:var(--fs-12)] ${
            picked ? "text-readout" : "text-foreground/85"
          }`}
        >
          {player.name}
        </span>
        {/* The team and the meter share the line: the meter takes what the
            three-letter code leaves, which is what keeps a chip two lines tall
            at every width. */}
        <span
          aria-hidden
          className="flex items-center gap-[0.3125rem] font-mono text-[length:var(--fs-8)] uppercase tracking-[0.16em] text-foreground/46"
        >
          <span>{player.team ?? "—"}</span>
          <span className="block h-[3px] flex-1 rounded-full bg-[var(--meter-track)] shadow-[inset_0_1px_3px_rgba(0,0,0,0.95)]">
            <span
              className="block h-[3px] rounded-full bg-active shadow-[0_0_8px_var(--accent-glow)]"
              style={{ width: `${Math.max(pct, player.held > 0 ? 6 : 0)}%` }}
            />
          </span>
        </span>
      </span>

      <span
        aria-hidden
        className={`${CONSOLE_WINDOW} inline-flex min-w-7 shrink-0 items-center justify-center rounded-[0.375rem] px-[0.3125rem] py-[0.1875rem]`}
      >
        <Scanlines />
        <span className="relative font-mono text-[length:var(--fs-11)] tabular-nums text-readout [text-shadow:var(--readout-text-glow)]">
          {player.held}
        </span>
      </span>
    </button>
  );
}
