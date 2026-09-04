"use client";

import { useMemo, useState } from "react";

import type { ManagerLeague, ManagerPlayersPayload } from "@/shared/contract";
import { CONSOLE_KEY_PILL } from "@/features/shared";

import type { LeagueSubjects, Subject } from "../helpers/league-subjects";
import { subjectKey } from "../helpers/league-subjects";
import { playerShares } from "../helpers/shares";
import { SharesDrawer, type SharesDrawerRow } from "./shares-drawer";

/**
 * Player shares: every player the manager rosters, and in how many of their
 * leagues.
 *
 * **The list is folded over the league-filtered but subject-unnarrowed
 * population**, which is the one population rule that matters here. Folded over
 * the selection instead, every row would collapse to the row you just picked and
 * could not be widened without clearing first — the rule `facetsQuery` already
 * enforces for the trades board's own menus.
 *
 * The three player-only columns — Value, Age, Class — ride the payload rather
 * than being derived here, and all three are **null where absent, never zero**.
 * Which market the value is on is the payload's own answer (`ktc`), because a
 * row spans leagues and so cannot resolve one per league the way a card does.
 */

/** Sleeper's own vocabulary, in the order a roster is usually read. */
const POSITION_ORDER = ["QB", "RB", "WR", "TE", "K", "DEF"];
const UNKNOWN_POSITION = "—";

function positionRank(position: string): number {
  const i = POSITION_ORDER.indexOf(position);
  return i === -1 ? POSITION_ORDER.length : i;
}

export function PlayerSharesDrawer({
  open,
  onClose,
  leagues,
  leagueTotal,
  filterSummary,
  read,
  subjects,
  onToggle,
}: {
  open: boolean;
  onClose: () => void;
  /** League-filtered, subject-unnarrowed — see the note above. */
  leagues: readonly ManagerLeague[];
  /** Every league on the page, for the panel's population readout. */
  leagueTotal: number;
  /** What the league filters left, or null for nothing active. */
  filterSummary: string | null;
  read: {
    data: ManagerPlayersPayload | null;
    loading: boolean;
    error: string | null;
  };
  subjects: LeagueSubjects;
  onToggle: (subject: Subject) => void;
}) {
  const [position, setPosition] = useState<string | null>(null);

  const shares = useMemo(
    () =>
      read.data
        ? playerShares(leagues, read.data.rosters, read.data.players)
        : null,
    [leagues, read.data],
  );

  // Counted over the *unfiltered* rows, so a chip always says how many it would
  // leave rather than how many are left — a chip that read zero once pressed
  // could not be reasoned about.
  const positions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const player of shares?.players ?? []) {
      const key = player.position ?? UNKNOWN_POSITION;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return [...counts.entries()].sort(
      (a, b) => positionRank(a[0]) - positionRank(b[0]) || a[0].localeCompare(b[0]),
    );
  }, [shares]);

  const rows = useMemo<SharesDrawerRow[]>(() => {
    const players = shares?.players ?? [];
    const kept =
      position === null
        ? players
        : players.filter((p) => (p.position ?? UNKNOWN_POSITION) === position);

    return kept.map((player) => ({
      key: player.player_id,
      id: player.player_id,
      name: player.name,
      note: player.team,
      held: player.leagues.length,
      leagues: player.leagues,
      value: player.ktc_value,
      age: player.age,
      draftClass: player.draft_class,
      badge: { label: player.position ?? UNKNOWN_POSITION },
    }));
  }, [shares, position]);

  const chosen = useMemo(
    () => new Set(subjects.subjects.map(subjectKey)),
    [subjects],
  );

  return (
    <SharesDrawer
      open={open}
      onClose={onClose}
      side="left"
      kind="player"
      title="Player shares"
      noun="players"
      rows={rows}
      leagueCount={shares?.league_count ?? 0}
      leagueTotal={leagueTotal}
      filterSummary={filterSummary}
      loading={read.loading}
      error={read.error}
      emptyMessage="No players rostered in these leagues yet."
      chipsActive={position !== null}
      onClearChips={() => setPosition(null)}
      chips={
        positions.length > 1 && (
          <>
            <PositionChip
              label="All"
              count={shares?.players.length ?? 0}
              on={position === null}
              onPick={() => setPosition(null)}
            />
            {positions.map(([value, count]) => (
              <PositionChip
                key={value}
                label={value}
                count={count}
                on={position === value}
                onPick={() => setPosition(position === value ? null : value)}
              />
            ))}
          </>
        )
      }
      selected={(subject) => chosen.has(subjectKey(subject))}
      onToggle={onToggle}
    />
  );
}

/**
 * A chosen chip is drawn **lit**, not dimmed — the theme rule against an alpha
 * on the accent as text, and it has the advantage of being true: pressing it
 * again clears it.
 */
function PositionChip({
  label,
  count,
  on,
  onPick,
}: {
  label: string;
  count: number;
  on: boolean;
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onPick}
      aria-pressed={on}
      className={`${CONSOLE_KEY_PILL} bg-[image:var(--key-bg)] px-[0.5625rem] py-1 text-[0.625rem] tracking-[0.14em] shadow-[var(--key-shadow)] ${
        on
          ? "border-active/45 text-readout"
          : "border-foreground/10 text-foreground/75 hover:text-readout"
      }`}
    >
      {label}
      <span className="ml-1.5 tabular-nums text-foreground/45">{count}</span>
    </button>
  );
}
