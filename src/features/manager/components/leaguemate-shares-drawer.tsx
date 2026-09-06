"use client";

import { useCallback, useMemo, useState } from "react";

import type {
  ManagerLeague,
  ManagerLeaguematesPayload,
  ManagerLeaguemateRostersPayload,
} from "@/shared/contract";

import {
  CONSOLE_TRACK,
  leaguematePlayerId,
  parseLeaguematePlayerId,
  SharesDrawer,
  subjectSlot,
  type LeagueSubjects,
  type SharesDrawerDisclosure,
  type SharesDrawerRow,
  type Subject,
} from "@/features/shared";

import {
  leaguematePlayers,
  rosterIndex,
  type RosterScope,
} from "../helpers/leaguemate-rosters";
import { leaguemateShares } from "../helpers/leaguemates";
import { rowRecord } from "../helpers/season-summary";
import { LeaguemateRosterRail } from "./leaguemate-roster-rail";

/**
 * Leaguemate shares: everyone the manager plays against, in how many leagues —
 * and, behind a key on each row, what that person actually rosters.
 *
 * Same population rule as the players drawer beside it — see that file.
 *
 * **The record is a column rather than a figure hung on the row**, and it is
 * still the manager's *own* combined record across the leagues they share with
 * that person, not the leaguemate's. It is the one number this page can
 * honestly put there: a leaguemate's record lives on their roster row in each
 * league, and reading twelve of those to answer a list is a different query.
 * What it says — "you are 14–8 in the leagues you share with Slim" — is also
 * the more interesting fact. It is folded through `rowRecord`, the same
 * aggregate the identity plate reads: one spelling, two readers.
 *
 * **The expanded row is what the panel gained, and it answers a question the
 * grid cannot.** Pressing a leaguemate's name narrows the league grid to the
 * leagues shared with them, which is a good answer and is unchanged. What it
 * cannot show is *their roster*: those are not the reader's players, so no card
 * behind the drawer draws them. So the row opens onto a board of chips, and
 * pressing one narrows the grid to the leagues where **that person holds that
 * player** — a `leaguemate-player` subject, which is independent of the
 * leaguemate's own pick, so `Slim` and `Slim · Chase` can be lit at once.
 *
 * **The expansion is panel-local `useState` and unpersisted**, the call this
 * drawer already makes about `sort`: it is a way of reading the list rather
 * than a device preference. It survives the drawer closing, because the drawer
 * stays mounted.
 */
export function LeaguemateSharesDrawer({
  open,
  onClose,
  leagues,
  leagueTotal,
  filterSummary,
  read,
  rosters,
  selfId,
  subjects,
  onToggle,
}: {
  open: boolean;
  onClose: () => void;
  /** League-filtered, subject-unnarrowed. */
  leagues: readonly ManagerLeague[];
  /** Every league on the page, for the panel's population readout. */
  leagueTotal: number;
  /** What the league filters left, or null for nothing active. */
  filterSummary: string | null;
  read: {
    data: ManagerLeaguematesPayload | null;
    loading: boolean;
    error: string | null;
  };
  /**
   * Every roster in those leagues — the rail's input, and the one read this
   * panel can render without.
   *
   * A row still lists, sorts and narrows on the membership read alone; what a
   * missing rosters payload costs is the board inside an expanded row, which
   * says so in words. So its failure is not this panel's failure.
   */
  rosters: {
    data: ManagerLeaguemateRostersPayload | null;
    loading: boolean;
    error: string | null;
  };
  /** The page's manager, dropped from their own list. Null before the stream answers. */
  selfId: string | null;
  subjects: LeagueSubjects;
  onToggle: (subject: Subject) => void;
}) {
  // Both are ways of reading this list rather than device preferences, so both
  // are `useState` — `LeagueTeams`' own call about its metric select.
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [scope, setScope] = useState<RosterScope>("all");
  const [showAll, setShowAll] = useState<ReadonlySet<string>>(new Set());

  const shares = useMemo(
    () =>
      read.data
        ? leaguemateShares(leagues, read.data.members, read.data.users, selfId)
        : null,
    [leagues, read.data, selfId],
  );

  const rosterMap = rosters.data?.rosters ?? null;
  const playerNames = useMemo(() => rosters.data?.players ?? {}, [rosters.data]);

  // One pass over every stored roster, and its two readers both want every
  // person: the search matches a typed name against anybody's board, and a
  // *collapsed* row has to name the combos held on it without expanding. See
  // `rosterIndex`.
  const index = useMemo(
    () => (rosterMap ? rosterIndex(leagues, rosterMap) : null),
    [leagues, rosterMap],
  );

  // Keyed by slot rather than by key — the rule `subjectSlot` states, and the
  // one this panel would not itself notice: neither of its kinds carries a
  // mode, so the two spellings agree here today and would part company the day
  // one did.
  const chosen = useMemo(
    () => new Set(subjects.subjects.map(subjectSlot)),
    [subjects],
  );

  // The combos held, per person, so a collapsed row can say so. Names come from
  // the same map the chips are drawn from, and an id with no name falls back to
  // itself — a searchable token beats a blank.
  const combosByMate = useMemo(() => {
    const out = new Map<string, string[]>();
    for (const subject of subjects.subjects) {
      if (subject.kind !== "leaguemate-player") continue;
      // Through the parser rather than a second `indexOf` — the id has one
      // spelling and this is the file that would drift from it.
      const pair = parseLeaguematePlayerId(subject.id);
      if (!pair) continue;
      const held = out.get(pair.userId);
      const name = playerNames[pair.playerId]?.name ?? pair.playerId;
      if (held) held.push(name);
      else out.set(pair.userId, [name]);
    }
    return out;
  }, [subjects, playerNames]);

  const rows = useMemo<SharesDrawerRow[]>(
    () =>
      (shares?.mates ?? []).map((mate) => {
        const combos = combosByMate.get(mate.user_id);
        return {
          key: mate.user_id,
          id: mate.user_id,
          name: mate.name,
          held: mate.leagues.length,
          // Folded here rather than in the drawer — see `SharesDrawerRow.record`.
          record: rowRecord(mate.leagues),
          // A lamp on the row rather than a pressed key: something inside it is
          // narrowing, which is a different thing from the row's own press and
          // is undone in a different place.
          lit: Boolean(combos),
          subline: combos ? `${combos.join(" · ")} held` : null,
          // The stored avatar rides through as a url rather than as a mounted
          // `<Avatar>`: the bezel is a fixed 1.875rem and `Avatar`'s `md` grows
          // to 2.25rem inside a container this wide. Same image, same fallback
          // initial — see the drawer's `Badge`.
          badge: {
            round: true,
            imageUrl: mate.avatar_url,
            label: mate.name.charAt(0).toUpperCase(),
          },
        };
      }),
    [shares, combosByMate],
  );

  /**
   * A typed name matches a person **or** a player they roster, which is what
   * makes the placeholder honest.
   *
   * Asked only with a needle in hand, and off the index above rather than off a
   * per-row string built eagerly: a search text folded onto every row would be
   * thirty-six thousand names concatenated for every reader, and spent only by
   * one who types.
   */
  const matchRow = useCallback(
    (row: SharesDrawerRow, needle: string) => {
      if (row.name.toLowerCase().includes(needle)) return true;
      const held = index?.get(row.id);
      if (!held) return false;
      for (const id of held) {
        if ((playerNames[id]?.name ?? "").toLowerCase().includes(needle)) {
          return true;
        }
      }
      return false;
    },
    [index, playerNames],
  );

  const disclosure = useMemo<SharesDrawerDisclosure>(
    () => ({
      expanded: (id) => expanded.has(id),
      onToggle: (id) =>
        setExpanded((prev) => {
          const next = new Set(prev);
          if (!next.delete(id)) next.add(id);
          return next;
        }),
      label: (row, open) =>
        open ? `Hide ${row.name}'s players` : `Show ${row.name}'s players`,
      render: (row) => (
        <MateRail
          mateId={row.id}
          mateName={row.name}
          leagues={leagues}
          rosters={rosterMap}
          loading={rosters.loading}
          error={rosters.error}
          players={playerNames}
          selfId={selfId}
          scope={scope}
          showingAll={showAll.has(row.id)}
          onShowAll={() =>
            setShowAll((prev) => {
              const next = new Set(prev);
              if (!next.delete(row.id)) next.add(row.id);
              return next;
            })
          }
          isPicked={(playerId) =>
            chosen.has(
              subjectSlot({
                kind: "leaguemate-player",
                id: leaguematePlayerId(row.id, playerId),
              }),
            )
          }
          onPick={(playerId) =>
            onToggle({
              kind: "leaguemate-player",
              id: leaguematePlayerId(row.id, playerId),
            })
          }
        />
      ),
    }),
    [
      expanded,
      leagues,
      rosterMap,
      rosters.loading,
      rosters.error,
      playerNames,
      selfId,
      scope,
      showAll,
      chosen,
      onToggle,
    ],
  );

  const combos = combosByMate.size;

  return (
    <SharesDrawer
      open={open}
      onClose={onClose}
      side="right"
      kind="leaguemate"
      title="Leaguemate shares"
      // The search reaches both, so the field has to say so — see `matchRow`.
      noun="leaguemates and players"
      rows={rows}
      leagueCount={shares?.league_count ?? 0}
      leagueTotal={leagueTotal}
      filterSummary={filterSummary}
      // A closed drawer says nothing, and a combo is picked two levels inside
      // this one — the readout is where the panel admits how many are held.
      populationNote={
        combos > 0 ? `${combos} combo${combos === 1 ? "" : "s"} held` : null
      }
      loading={read.loading}
      error={read.error}
      emptyMessage="No leaguemates in these leagues yet."
      matchRow={matchRow}
      disclosure={disclosure}
      deckControls={<ScopeTrack scope={scope} onPick={setScope} />}
      selected={(subject) => chosen.has(subjectSlot(subject))}
      onToggle={onToggle}
    />
  );
}

/**
 * Which of a leaguemate's players the rail lists.
 *
 * A third track beside Sort and Columns, on their grammar exactly: a channel
 * with one travelling key. It narrows the *board inside a row* rather than the
 * list of rows, which is why it is a `Roster` label rather than a second
 * `Filters` key — the panel's own rows are untouched by it.
 *
 * The labels shorten below `@md` rather than the keys wrapping: `2+ shared` and
 * `Also mine` are 8 and 9 characters in a track that already shares a 354px
 * deck with Sort and Columns. Two spans switched by the cascade, not by state —
 * a client component must not have to hydrate to learn a breakpoint.
 */
const SCOPES: { id: RosterScope; label: string; short: string }[] = [
  { id: "all", label: "All", short: "All" },
  { id: "shared2", label: "2+ shared", short: "2+" },
  { id: "mine", label: "Also mine", short: "Mine" },
];

function ScopeTrack({
  scope,
  onPick,
}: {
  scope: RosterScope;
  onPick: (scope: RosterScope) => void;
}) {
  return (
    <span className="inline-flex items-center gap-[0.4375rem]">
      <span className="shrink-0 font-mono text-[length:var(--fs-8)] uppercase tracking-[0.18em] text-foreground/42">
        Roster
      </span>
      <span className={`${CONSOLE_TRACK} inline-flex items-center gap-1 p-1`}>
        {SCOPES.map(({ id, label, short }) => {
          const on = scope === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => onPick(id)}
              aria-pressed={on}
              aria-label={label}
              className={
                "inline-flex shrink-0 items-center rounded-full border px-2.5 py-[0.3125rem] font-mono text-[length:var(--fs-10)] uppercase tracking-[0.14em] transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-active/60 " +
                (on
                  ? "border-active/55 bg-[image:var(--key-bg)] text-readout [text-shadow:var(--readout-text-glow)] shadow-[var(--key-shadow),inset_0_0_14px_color-mix(in_srgb,var(--accent)_16%,transparent)]"
                  : "border-transparent text-foreground/58 hover:text-readout")
              }
            >
              <span aria-hidden className="@md:hidden">
                {short}
              </span>
              <span aria-hidden className="hidden @md:inline">
                {label}
              </span>
            </button>
          );
        })}
      </span>
    </span>
  );
}

/**
 * One expanded row's board, and the three states it can be in.
 *
 * The fold runs here rather than in the panel above because it runs for the
 * rows that are **open** — one or two of several hundred — where a memo up
 * there would fold every leaguemate's roster on every render of the list.
 *
 * The preview cap is the rail's own, not the fold's: `Show all` is a way of
 * looking at the same board, so the foot's count and the pip's denominator both
 * stay the whole of it.
 */
const RAIL_PREVIEW = 12;

function MateRail({
  mateId,
  mateName,
  leagues,
  rosters,
  loading,
  error,
  players,
  selfId,
  scope,
  showingAll,
  onShowAll,
  isPicked,
  onPick,
}: {
  mateId: string;
  mateName: string;
  leagues: readonly ManagerLeague[];
  rosters: ManagerLeaguemateRostersPayload["rosters"] | null;
  loading: boolean;
  error: string | null;
  players: ManagerLeaguemateRostersPayload["players"];
  selfId: string | null;
  scope: RosterScope;
  showingAll: boolean;
  onShowAll: () => void;
  isPicked: (playerId: string) => boolean;
  onPick: (playerId: string) => void;
}) {
  const board = useMemo(
    () =>
      rosters
        ? leaguematePlayers(leagues, mateId, rosters, players, selfId, scope)
        : null,
    [rosters, leagues, mateId, players, selfId, scope],
  );

  // The read is this row's only content, so its failure is said in words —
  // `useManagerLineups`' silence is right for an enhancement beside a list and
  // wrong for a tray that would otherwise open onto nothing.
  if (!board) {
    return (
      <p className="mx-2 mb-2 rounded-xl bg-black/[0.28] px-2.5 py-3 font-mono text-[length:var(--fs-9)] uppercase tracking-[0.16em] text-foreground/46 shadow-[var(--track-shadow)]">
        {error ?? (loading ? "Reading rosters…" : "No rosters read yet.")}
      </p>
    );
  }

  const shown = showingAll
    ? board.players
    : board.players.slice(0, RAIL_PREVIEW);

  return (
    <LeaguemateRosterRail
      players={shown}
      leagueCount={board.league_count}
      total={board.players.length}
      showingAll={showingAll}
      onShowAll={onShowAll}
      isPicked={isPicked}
      onPick={onPick}
      mateName={mateName}
    />
  );
}
