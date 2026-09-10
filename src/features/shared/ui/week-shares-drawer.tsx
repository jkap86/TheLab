"use client";

import { useCallback, useMemo, useState } from "react";

import { subjectSlot, type LeagueSubjects, type Subject } from "../league-subjects";
import { decisionsFor } from "../start-sit-decisions";
import {
  weekPlayerShares,
  type WeekLineupEntry,
  type WeekSide,
} from "../week-shares";
import { SharesDrawer, type SharesDrawerRow } from "./shares-drawer";
import { DecisionsDeck, DecisionsList } from "./start-sit-decisions";

/**
 * A week's shares, for one side of the week's games.
 *
 * All **four** panels the two week tools put in the rack are this component:
 * the Starters panel counts the manager's own lineups and the Opponents panel
 * counts the lineups facing them, and everything else about them — the columns,
 * the sort, the decisions view, the population rule — is the same. Two files
 * naming two sides of one fold would be two chances for one of them to count
 * differently from the other, which is precisely the failure nobody could see:
 * both would render. The same argument one grain out is why it is in
 * `features/shared` rather than in either tool: `features/gametime` may not
 * import from `features/lineupchecker`, and the answer to that is not a copy.
 *
 * **What the two tools differ on is one word.** The rows are folded over a
 * normalised side (see `weekPlayerShares`), so the fold does not know which
 * page asked; what a reader has to be told is which of two scales the figures
 * are on, and that is `figureLabel` — `Proj` on the checker, `Live` on
 * gametime.
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
  figureLabel,
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
  /**
   * What every figure in this panel is, in a window's worth of characters —
   * `Proj` on the lineup checker, `Live` on gametime. See the module note.
   */
  figureLabel: string;
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

  // Keyed by slot, on `SharesDrawer.chosen`'s rule. Neither week kind carries
  // a mode, so the slot and the key agree here — and the slot is the spelling
  // the drawer looks a row up by.
  const chosen = useMemo(
    () => new Set(subjects.subjects.map(subjectSlot)),
    [subjects],
  );

  const groups = useMemo(
    () => (detail ? decisionsFor(detail, entries, kind) : []),
    [detail, entries, kind],
  );
  const picked = groups.find((group) => group.player_id === combo) ?? null;

  // **The subject's figure follows what is on screen**, which is what makes it
  // answerable at all: either tool's figure is scored by the league's own
  // settings, so a player spanning a PPR league and a half-PPR one has no single
  // number — and picking a counterpart narrows to that pairing's own leagues,
  // which is usually one scoring and usually a number. See
  // `WeekPlayerShare.figure`.
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

  // Pressing the selected row clears the narrowing; pressing any other row
  // selects it *and* opens its decisions. Stable on its two inputs so the
  // drawer is not handed a fresh one per render of the page above.
  const toggle = useCallback(
    (s: Subject) => {
      const already = chosen.has(subjectSlot(s));
      onToggle(s);
      setCombo(null);
      setDetail(already ? null : s.id);
    },
    [chosen, onToggle],
  );

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
                  figure={subject.figure}
                  figureLabel={figureLabel}
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
                  figureLabel={figureLabel}
                  onPick={(id) => setCombo((prev) => (prev === id ? null : id))}
                />
              ),
            }
          : null
      }
      chosen={chosen}
      onToggle={toggle}
    />
  );
}
