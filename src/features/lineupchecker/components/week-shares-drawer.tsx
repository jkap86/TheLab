"use client";

import { useMemo, useState } from "react";

import {
  SharesDrawer,
  subjectKey,
  type LeagueSubjects,
  type SharesDrawerRow,
  type Subject,
} from "@/features/shared";

import { decisionsFor } from "../helpers/start-sit-decisions";
import { weekPlayerShares, type WeekLineupEntry, type WeekSide } from "../helpers/starter-shares";
import { DecisionsDeck, DecisionsList } from "./start-sit-decisions";

/**
 * A week's shares, for one side of the week's games.
 *
 * Both panels the lineup checker puts in the rack are this component: the
 * Starters panel counts the manager's own lineups and the Opponents panel
 * counts the lineups facing them, and everything else about them — the columns,
 * the sort, the decisions view, the population rule — is the same. Two files
 * naming two sides of one fold would be two chances for one of them to count
 * differently from the other, which is precisely the failure nobody could see:
 * both would render.
 *
 * **The rows are folded over the league-filtered, subject-unnarrowed list**, the
 * rule `playerShares` states in full. Folded over the selection instead, every
 * row would collapse to the row just picked and could not be widened again
 * without clearing first.
 *
 * **Pressing a row does two things and they are not the same thing.** It sets
 * the subject, which narrows the league grid *behind* the panel through the
 * page's existing `matchesSubjects` pass, and it opens the decisions view for
 * that player. Pressing the row that is already selected clears the narrowing
 * instead, which is what the pressed-and-lit state has always promised.
 */
export function WeekSharesDrawer({
  open,
  onClose,
  side,
  kind,
  title,
  noun,
  entries,
  week,
  leagueTotal,
  filterSummary,
  pending,
  emptyMessage,
  subjects,
  onToggle,
}: {
  open: boolean;
  onClose: () => void;
  side: "left" | "right";
  kind: WeekSide;
  title: string;
  /** Plural, lower case — "my players", "opposing players". */
  noun: string;
  /** League-filtered, subject-unnarrowed — see the note above. */
  entries: readonly WeekLineupEntry[];
  /** The week these shares are of, for the population readout. */
  week: number | null;
  /** Every league on the page, for that readout's denominator. */
  leagueTotal: number;
  /** What the league filters left, or null for nothing active. */
  filterSummary: string | null;
  /** The check has not landed yet — a different state from having no rows. */
  pending: boolean;
  emptyMessage: string;
  subjects: LeagueSubjects;
  onToggle: (subject: Subject) => void;
}) {
  // Both are a way of reading this list rather than a device preference, so
  // both are `useState` — the call `LeagueTeams` makes about its metric select.
  // `detail` is the player whose decisions are open; `combo` is the counterpart
  // that view is narrowed to.
  const [detail, setDetail] = useState<string | null>(null);
  const [combo, setCombo] = useState<string | null>(null);

  const shares = useMemo(() => weekPlayerShares(entries, kind), [entries, kind]);

  const rows = useMemo<SharesDrawerRow[]>(
    () =>
      shares.players.map((player) => ({
        key: player.player_id,
        id: player.player_id,
        name: player.name,
        note: player.team,
        held: player.leagues.length,
        started: player.started,
        benched: player.benched,
        badge: { label: player.position ?? "—" },
      })),
    [shares],
  );

  const chosen = useMemo(
    () => new Set(subjects.subjects.map(subjectKey)),
    [subjects],
  );

  const groups = useMemo(
    () => (detail ? decisionsFor(detail, entries, kind) : []),
    [detail, entries, kind],
  );
  const picked = groups.find((group) => group.player_id === combo) ?? null;

  // **The subject's projection follows what is on screen**, which is what makes
  // it answerable at all: a projection is scored by the league's own settings,
  // so a player spanning a PPR league and a half-PPR one has no single figure —
  // and picking a counterpart narrows to that pairing's own leagues, which is
  // usually one scoring and usually a number. See `WeekPlayerShare.points`.
  //
  // Nothing picked means nothing narrowed, and the fold above already answered.
  const narrowed = useMemo(() => {
    if (!picked) return shares;
    const ids = new Set(picked.rows.map((row) => row.league_id));
    return weekPlayerShares(
      entries.filter((e) => ids.has(e.league.league_id)),
      kind,
    );
  }, [picked, shares, entries, kind]);

  const subject = detail
    ? (narrowed.players.find((p) => p.player_id === detail) ??
      shares.players.find((p) => p.player_id === detail) ??
      null)
    : null;
  const counted = shares.league_count;

  // Every route out clears both, per the panel's own promise: a drawer reopened
  // onto a player pressed a minute ago, narrowed to a counterpart nobody
  // remembers picking, is a panel that has kept state nobody asked it to.
  const close = () => {
    setDetail(null);
    setCombo(null);
    onClose();
  };

  return (
    <SharesDrawer
      open={open}
      onClose={close}
      side={side}
      kind={kind}
      title={title}
      noun={noun}
      rows={rows}
      leagueCount={counted}
      leagueTotal={leagueTotal}
      filterSummary={filterSummary}
      // These shares are a week's, not a season's, and the readout is the only
      // thing on screen that says so.
      populationNote={week === null ? null : `week ${week}`}
      defaultSort="start"
      loading={pending}
      error={null}
      emptyMessage={emptyMessage}
      detail={
        subject
          ? {
              deck: (
                <DecisionsDeck
                  name={subject.name}
                  position={subject.position}
                  team={subject.team}
                  points={subject.points}
                  line={
                    picked
                      ? `With ${picked.name} · ${picked.rows.length} of ${counted} leagues`
                      : `Started in ${subject.started} of ${counted} leagues · benched in ${subject.benched}`
                  }
                  onBack={() => {
                    // The row stays lit: `Back` closes this view, it does not
                    // undo the narrowing the press also made.
                    setDetail(null);
                    setCombo(null);
                  }}
                />
              ),
              body: (
                <DecisionsList
                  groups={picked ? [picked] : groups}
                  picked={combo}
                  onPick={(id) => setCombo((prev) => (prev === id ? null : id))}
                />
              ),
            }
          : null
      }
      selected={(s) => chosen.has(subjectKey(s))}
      onToggle={(s) => {
        // Pressing the selected row clears the narrowing; pressing any other
        // row selects it *and* opens its decisions.
        const already = chosen.has(subjectKey(s));
        onToggle(s);
        setCombo(null);
        setDetail(already ? null : s.id);
      }}
    />
  );
}
