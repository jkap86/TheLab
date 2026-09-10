"use client";

import { Fragment, useCallback, useMemo, useState } from "react";

import { CONSOLE_CHANNEL_METAL, CONSOLE_CHIP } from "../console-chrome";
import {
  canonicalReadings,
  clearSubjectReadings,
  subjectSlot,
  toggleSubjectReading,
  WEEK_READINGS,
  type LeagueSubjects,
  type Subject,
  type WeekReading,
} from "../league-subjects";
import { WEEK_READING_COLUMN } from "../shares-columns";
import { decisionsFor } from "../start-sit-decisions";
import {
  weekTwoSidedShares,
  type WeekLineupEntry,
  type WeekTwoSidedShare,
} from "../week-shares";
import { SharesDrawer, type SharesDrawerRow } from "./shares-drawer";
import { DecisionsDeck, DecisionsList } from "./start-sit-decisions";

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
        return [{ player, picked, left: leaguesLeft(player, picked) }];
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
            <ReadingKeys
              player={player}
              picked={readings.get(row.id) ?? NO_READINGS}
              onPress={(reading) => pressReading(row.id, reading)}
            />
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

/** How many leagues a row's picked readings leave — the union, deduped. */
function leaguesLeft(
  player: WeekTwoSidedShare,
  picked: readonly WeekReading[],
): number {
  // Deduped by league id, because two readings *can* name one league: a player
  // on the manager's bench in a league whose opponent also… cannot happen, but
  // a union counted by summing would be a number nothing else on screen agrees
  // with the day the data says otherwise.
  const ids = new Set<string>();
  for (const reading of picked) {
    for (const league of player.leagues[reading]) ids.add(league.league_id);
  }
  return ids.size;
}

/** What each of the four keys says on its face — the side is the dot's job. */
const READING_LABEL: Record<WeekReading, string> = {
  start: "Start",
  bench: "Bench",
  "opp-start": "Start",
  "opp-bench": "Bench",
};

/**
 * And what each says on the deck's chip, where there is no dot to carry the
 * side and the four have to tell themselves apart in words.
 *
 * Short rather than the column's own label, because the chip states a row's
 * whole narrowing on one line beside two other controls: `start+opp start` is
 * the pair, where `Started + Opp start` is most of the deck.
 */
const READING_CHIP: Record<WeekReading, string> = {
  start: "start",
  bench: "bench",
  "opp-start": "opp start",
  "opp-bench": "opp bench",
};

/** And what it says to a reader who cannot see the dot. */
const READING_NAME: Record<WeekReading, string> = {
  start: "Narrow on my starters",
  bench: "Narrow on my bench",
  "opp-start": "Narrow on opposing starters",
  "opp-bench": "Narrow on opposing bench",
};

const READING_COUNT: Record<
  WeekReading,
  (player: WeekTwoSidedShare) => number
> = {
  start: (p) => p.started,
  bench: (p) => p.benched,
  "opp-start": (p) => p.oppStarted,
  "opp-bench": (p) => p.oppBenched,
};

/**
 * The row's tray: four keys in one channel, on one line.
 *
 * **The legends are `Start` and `Bench` twice, and that is what makes them
 * fit.** A filled dot is the manager's own side and a hollow one is the
 * opposing side — the fill semantics `OpponentsMark` already uses on the rack
 * key — and the groove between the pairs is the side boundary. Spelled out as
 * `My starters` / `Opp starters` the four are wider than the tray at the
 * panel's own width; with the dot and the groove saying the side, they are one
 * line. What a reader who cannot see either gets is the whole sentence, on the
 * key's own accessible name.
 *
 * **Multi-select, so pressing a lit key clears it** — which is why there is no
 * Clear key in here. The deck's chip carries one, for the row.
 *
 * The count on each key is that reading's own league count for this player,
 * which is the same figure its cell above prints.
 */
function ReadingKeys({
  player,
  picked,
  onPress,
}: {
  player: WeekTwoSidedShare;
  picked: readonly WeekReading[];
  onPress: (reading: WeekReading) => void;
}) {
  return (
    // Left-aligned to the name column, so the keys sit under the row they
    // narrow rather than under its badge.
    <div className="relative flex items-center pb-[0.5625rem] pl-[3.0625rem] pr-[0.6875rem]">
      <span
        className={`${CONSOLE_CHANNEL_METAL} inline-flex flex-wrap items-center gap-1 p-1`}
      >
        {WEEK_READINGS.map((reading, i) => {
          const on = picked.includes(reading);
          const mine = reading === "start" || reading === "bench";
          return (
            <Fragment key={reading}>
              {/* The side boundary, cut once, between the pairs. */}
              {i === 2 && (
                <span
                  aria-hidden
                  className="mx-[0.1875rem] w-px shrink-0 self-stretch bg-[image:var(--groove)] shadow-[var(--groove-highlight)]"
                />
              )}
              <button
                type="button"
                aria-pressed={on}
                aria-label={READING_NAME[reading]}
                onClick={() => onPress(reading)}
                className={
                  "inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-[0.3125rem] font-mono text-[length:var(--fs-10)] uppercase tracking-[0.14em] transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-active/60 " +
                  (on
                    ? "border-active/55 bg-[image:var(--key-bg)] text-readout [text-shadow:var(--readout-text-glow)] shadow-[var(--key-shadow),inset_0_0_14px_color-mix(in_srgb,var(--accent)_16%,transparent)]"
                    : "border-transparent text-foreground/62 hover:text-readout")
                }
              >
                <SideDot mine={mine} on={on} />
                {READING_LABEL[reading]} · {READING_COUNT[reading](player)}
              </button>
            </Fragment>
          );
        })}
      </span>
    </div>
  );
}

/** Filled for the manager's own side, hollow for the side facing them. */
function SideDot({ mine, on }: { mine: boolean; on: boolean }) {
  const ink = on ? "var(--accent)" : "currentColor";
  return (
    <svg viewBox="0 0 12 12" className="size-2 shrink-0" aria-hidden>
      {mine ? (
        <circle cx="6" cy="6" r="5" fill={ink} />
      ) : (
        <circle cx="6" cy="6" r="4.4" fill="none" stroke={ink} strokeWidth="1.6" />
      )}
    </svg>
  );
}

/**
 * One row's narrowing, named in the deck.
 *
 * **A closed tray says nothing**, and the readings are picked inside one: a row
 * scrolled out of sight is still narrowing the grid behind the panel, and
 * without this the only thing saying so is a pip on a row nobody can see. It is
 * the argument `SubjectTokens` is written by, one grain in — that tray names
 * the *rows*, and this names what was picked inside them.
 *
 * It rides the deck's own second band rather than the population readout, which
 * is a measurement rather than a preference: appended there it pushes `week 3`
 * off the end of a line that is already two denominators long. And not in the
 * row's name column, which is 179px and holds a name.
 */
function NarrowingChip({
  name,
  readings,
  left,
  onClear,
}: {
  name: string;
  readings: readonly WeekReading[];
  left: number;
  onClear: () => void;
}) {
  const tail = `${readings.map((r) => READING_CHIP[r]).join("+")} · ${left}`;
  return (
    <span
      className={`${CONSOLE_CHIP} inline-flex min-w-0 max-w-full items-center gap-[0.4375rem] rounded-full border border-active/45 py-1 pl-2.5 pr-[0.3125rem] shadow-[var(--chip-shadow),0_0_18px_-8px_var(--accent-glow)]`}
    >
      <span
        aria-hidden
        className="size-[0.4375rem] shrink-0 rounded-full bg-active shadow-[0_0_9px_var(--accent-glow)]"
      />
      {/* **The name truncates and the tail does not**, which is the right way
          round: the readings and the league count are the whole of what this
          chip adds, and the name is already on the row it came from. Left to
          truncate as one string it is the count that goes — the chip is wider
          than a 354px panel at a phone's width, and the panel clips. */}
      <span className="flex min-w-0 items-baseline gap-1 font-mono text-[length:var(--fs-10)] uppercase tracking-[0.14em] text-readout [text-shadow:var(--readout-text-glow)]">
        <span className="truncate">{name}</span>
        <span className="shrink-0 whitespace-nowrap">· {tail}</span>
      </span>
      <button
        type="button"
        onClick={onClear}
        aria-label={`Clear the readings narrowing ${name}`}
        className="inline-flex size-[1.125rem] shrink-0 items-center justify-center rounded-full border border-foreground/12 bg-[image:var(--key-bg)] font-mono text-[length:var(--fs-9)] leading-none text-foreground/80 shadow-[var(--key-shadow)] transition-colors duration-150 hover:text-readout focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-active/60"
      >
        <span aria-hidden>✕</span>
      </button>
    </span>
  );
}
