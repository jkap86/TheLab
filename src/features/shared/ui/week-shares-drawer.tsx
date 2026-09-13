"use client";

import { useCallback, useMemo, useState } from "react";

import {
  canonicalReadings,
  clearSubjectReadings,
  subjectSlot,
  toggleSubjectReading,
  type LeagueSubjects,
  type Subject,
  type WeekReading,
} from "../league-subjects";
import { WEEK_READING_COLUMN } from "../shares-columns";
import { decisionsFor } from "../start-sit-decisions";
import { weekTwoSidedShares, type WeekLineupEntry } from "../week-shares";
import { SharesDrawer, type SharesDrawerRow } from "./shares-drawer";
import { DecisionsDeck, DecisionsList } from "./start-sit-decisions";
import { leaguesLeft, NarrowingChip, ReadingKeys } from "./week-readings";

/**
 * A week's shares: every player either side of the week's games fielded, once,
 * with four readings beside him.
 *
 * **It used to be two panels and the merge is the whole of this file.** The
 * rack carried a Starters key that docked left and an Opponents key that docked
 * right, and both were this component over one *side* of the week. Every player
 * a reader wanted to compare across the two — which is most of the question, on
 * a page whose card draws the two lineups facing each other — was two rows, in
 * two panels, under two denominators, and the reader did the comparison. One
 * row with four counts is those four numbers with the comparison already made.
 *
 * **What the two tools differ on is one word.** The rows are folded over
 * normalised entries (see `weekTwoSidedShares`), so the fold does not know
 * which page asked; what a reader has to be told is which of two scales the
 * figures are on, and that is `figureLabel` — `Proj` on the checker, `Live` on
 * gametime.
 *
 * **The rows are folded over the league-filtered, subject-unnarrowed list**, the
 * rule `weekTwoSidedShares` states in full. Folded over the selection instead,
 * every row would collapse to the row just picked and could not be widened
 * again without clearing first.
 *
 * **Pressing a row does two things and they are not the same thing.** It sets
 * the subject, which narrows the league grid *behind* the panel through the
 * page's existing `matchesSubjects` pass, and it opens the decisions view for
 * that player. Pressing the row that is already selected clears the narrowing
 * instead, which is what the pressed-and-lit state has always promised.
 *
 * **The four readings are a second, finer narrowing inside that one.** A press
 * on the row narrows to the leagues that fielded him at all, either side; the
 * tray behind each row's disclosure key refines that to any union of started,
 * benched, opposing-started and opposing-benched. See {@link Subject.readings}
 * for why union is the only operator with anything to say here.
 *
 * ## No caller, and kept
 *
 * Both tools that mounted this have taken the same content down to the foot of
 * their own console as a bar: gametime merged it into its stat board, and the
 * lineup checker draws `StartSitConsole`. What replaced it is not its *content*
 * — the fold, the four readings, `pressReading`, the decisions wiring and the
 * two denominators all travelled into the console as they stood — but what a
 * modal *is*: picking a row here exists to narrow the league grid, and a
 * backdrop over that grid meant the reader pressed a subject and then dismissed
 * the panel to see what it had done.
 *
 * It is kept on `peekActiveSeason`'s terms, and what it carries that the
 * consoles do not is the *drawer* arrangement of this panel — `SharesDrawer`'s
 * `detail` slot, its `deckControls` chips and `NarrowingChip`/`leaguesLeft`,
 * which have no other reader. A page that wants these four readings over a list
 * it does **not** narrow — where a modal costs nothing, because there is
 * nothing behind it to watch — takes this rather than a third console.
 */
export function WeekSharesDrawer({
  open,
  onClose,
  entries,
  week,
  leagueTotal,
  filterSummary,
  figureLabel,
  pending,
  subjects,
  onToggle,
  onSubjects,
}: {
  open: boolean;
  onClose: () => void;
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
  subjects: LeagueSubjects;
  /** Pick or clear a whole row. */
  onToggle: (subject: Subject) => void;
  /**
   * Edit the selection whole — what the tray's keys and the deck's chips need,
   * where the row's own press does not.
   *
   * A reducer rather than four callbacks, because every one of those edits is
   * `league-subjects.ts`'s to spell and this component's job is to say *which*
   * of them a press means. The page still owns the state, which is what makes
   * the drawer's unmount-while-shut safe.
   */
  onSubjects: (next: (prev: LeagueSubjects) => LeagueSubjects) => void;
}) {
  // Both are a way of reading this list rather than a device preference, so
  // both are `useState` — the call `LeagueTeams` makes about its metric select.
  // `detail` is the player whose decisions are open; `combo` is the counterpart
  // that view is narrowed to.
  const [detail, setDetail] = useState<string | null>(null);
  const [combo, setCombo] = useState<string | null>(null);
  // Which rows have their tray of narrowing keys open. Per row, and deliberately
  // not persisted: it is a way of reading the list, the call `sort` already
  // makes. It survives the drawer closing because the drawer stays mounted.
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(EMPTY);

  const shares = useMemo(() => weekTwoSidedShares(entries), [entries]);

  const rows = useMemo<SharesDrawerRow[]>(
    () =>
      shares.players.map((player) => ({
        key: player.player_id,
        id: player.player_id,
        name: player.name,
        note: player.team,
        // Every league he was fielded in, either side, which is what a press on
        // the row narrows to and therefore what its `Share` would mean. The
        // panel offers no share column; this is what the drawer scales by.
        held:
          player.started +
          player.benched +
          player.oppStarted +
          player.oppBenched,
        started: player.started,
        benched: player.benched,
        oppStarted: player.oppStarted,
        oppBenched: player.oppBenched,
        badge: { label: player.position ?? "—" },
      })),
    [shares],
  );

  // Keyed by slot, on `SharesDrawer.chosen`'s rule: a row is one narrowing
  // however it is refined, so the drawer looks it up by the row rather than by
  // the readings inside it.
  const chosen = useMemo(
    () => new Set(subjects.subjects.map(subjectSlot)),
    [subjects],
  );

  /**
   * The readings picked on each row, by player id.
   *
   * Built once per selection rather than searched per row per render: the row
   * list runs to a thousand on a full account and three of the four things
   * below ask this question for every one of them.
   */
  const readings = useMemo(() => {
    const map = new Map<string, readonly WeekReading[]>();
    for (const subject of subjects.subjects) {
      if (subject.kind !== "week") continue;
      const picked = canonicalReadings(subject.readings);
      if (picked.length > 0) map.set(subject.id, picked);
    }
    return map;
  }, [subjects]);

  const groups = useMemo(
    () => (detail ? decisionsFor(detail, entries) : []),
    [detail, entries],
  );
  const picked = groups.find((group) => group.player_id === combo) ?? null;

  // **The subject's figure follows what is on screen**, which is what makes it
  // answerable at all: either tool's figure is scored by the league's own
  // settings, so a player spanning a PPR league and a half-PPR one has no single
  // number — and picking a counterpart narrows to that pairing's own leagues,
  // which is usually one scoring and usually a number. See
  // `WeekTwoSidedShare.figure`.
  //
  // Nothing picked means nothing narrowed, and the fold above already answered.
  const narrowed = useMemo(() => {
    if (!picked) return shares;
    const ids = new Set(picked.rows.map((row) => row.league_id));
    return weekTwoSidedShares(
      entries.filter((e) => ids.has(e.league.league_id)),
    );
  }, [picked, shares, entries]);

  const subject = detail
    ? (narrowed.players.find((p) => p.player_id === detail) ??
      shares.players.find((p) => p.player_id === detail) ??
      null)
    : null;
  const counted = shares.starter_league_count;

  // Every route out clears the detail view, per the panel's own promise: a
  // drawer reopened onto a player pressed a minute ago, narrowed to a
  // counterpart nobody remembers picking, is a panel that has kept state nobody
  // asked it to. The row selections stay — they are the grid's narrowing.
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

  /**
   * A tray key: pick the row if it is not picked, then add or drop the reading.
   *
   * Two edits in one press because the tray is reachable on an unpicked row —
   * the disclosure key and the row's own press are siblings, deliberately, so a
   * row can be open and unpicked. A key that did nothing there would be a
   * control a reader has to learn the order of.
   */
  const pressReading = useCallback(
    (id: string, reading: WeekReading) => {
      onSubjects((prev) => {
        const slot = subjectSlot({ kind: "week", id });
        const held = prev.subjects.some((s) => subjectSlot(s) === slot)
          ? prev
          : {
              ...prev,
              subjects: [
                ...prev.subjects,
                { kind: "week" as const, id, readings: [] },
              ],
            };
        return toggleSubjectReading(held, "week", id, reading);
      });
    },
    [onSubjects],
  );

  const clearReadings = useCallback(
    (id: string) => onSubjects((prev) => clearSubjectReadings(prev, "week", id)),
    [onSubjects],
  );

  const discloseRow = useCallback((id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }, []);

  // **Delimited, and a string rather than a set** — see `SharesDrawer.litCells`
  // for why the memo needs a value it can compare.
  const litCells = useCallback(
    (row: SharesDrawerRow) => {
      const picked = readings.get(row.id);
      if (!picked || picked.length === 0) return null;
      return `|${picked.map((r) => WEEK_READING_COLUMN[r]).join("|")}|`;
    },
    [readings],
  );

  /** The chips the deck carries: one per row that has readings picked. */
  const narrowings = useMemo(
    () =>
      shares.players.flatMap((player) => {
        const picked = readings.get(player.player_id);
        if (!picked || picked.length === 0) return [];
        return [{ player, picked, left: leaguesLeft(player.leagues, picked) }];
      }),
    [shares, readings],
  );

  return (
    <SharesDrawer
      open={open}
      onClose={close}
      // Docks left, where the pair it replaces docked left and right. There is
      // no second panel to sit opposite any more.
      side="left"
      kind="week"
      title="Week shares"
      noun="players"
      rows={rows}
      leagueCount={counted}
      opponentLeagueCount={shares.opponent_league_count}
      leagueTotal={leagueTotal}
      filterSummary={filterSummary}
      // **Two denominators and a week.** These shares are one week's, and the
      // readout is the only thing on screen that says so; the second figure is
      // there because two of the four columns are scaled by it, and it is
      // legitimately lower — see `WeekTwoSidedShares.opponent_league_count`.
      populationNote={populationNote(shares.opponent_league_count, week)}
      defaultSort="start"
      loading={pending}
      error={null}
      emptyMessage="No lineups read for this week yet."
      wide
      milled
      noteInline
      litCells={litCells}
      deckControls={
        narrowings.length > 0 ? (
          <>
            {narrowings.map(({ player, picked, left }) => (
              <NarrowingChip
                key={player.player_id}
                name={player.name}
                readings={picked}
                left={left}
                onClear={() => clearReadings(player.player_id)}
              />
            ))}
          </>
        ) : null
      }
      disclosure={{
        expanded: (id) => expanded.has(id),
        onToggle: discloseRow,
        label: (row, open) =>
          `${open ? "Hide" : "Show"} narrowing keys for ${row.name}`,
        render: (row) => {
          const player = shares.players.find(
            (p) => p.player_id === row.id,
          );
          if (!player) return null;
          return (
            // Left-aligned to the name column, so the keys sit under the row
            // they narrow rather than under its badge.
            <div className="relative flex items-center pb-[0.5625rem] pl-[3.0625rem] pr-[0.6875rem]">
              <ReadingKeys
                counts={player}
                picked={readings.get(row.id) ?? NO_READINGS}
                onPress={(reading) => pressReading(row.id, reading)}
              />
            </div>
          );
        },
      }}
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

/** Module-level identities, so a shut row and an unnarrowed one hand the same. */
const EMPTY: ReadonlySet<string> = new Set<string>();
const NO_READINGS: readonly WeekReading[] = [];

/**
 * The population readout's trailing clause: the opposing denominator, then the
 * week.
 *
 * **The second figure is on it because two of the four columns are scaled by
 * it.** `Across all 79 leagues · 74 with an opponent · week 3` is the whole of
 * what a row reading `18/74` beside one reading `46/79` needs explaining, and
 * without it the two look like the same denominator mistyped.
 */
function populationNote(opponents: number, week: number | null): string | null {
  const parts: string[] = [`${opponents} with an opponent`];
  if (week !== null) parts.push(`week ${week}`);
  return parts.join(" · ");
}
