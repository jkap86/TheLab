"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useMemo, useState } from "react";

import {
  DEFAULT_LEAGUE_FILTERS,
  FlaskLoader,
  type LeagueFilters,
  LeagueFiltersPlaceholder,
  ListLedge,
  PageHeading,
  activeFilterCount,
  filterSummary,
  matchesFilters,
  useStoredAccount,
  useUserLeagues,
} from "@/features/shared";
// The module path rather than that barrel, deliberately: the plate is kept off
// it so the pages that draw none don't carry its countdown, its dial and a query
// hook — see the folder's own index.
import { ManagerHeader } from "@/features/shared/ui/manager-header";

import { useManagerMatchups } from "../hooks/use-manager-matchups";
import { projectedRecord } from "../projected-record";
import { LineupStatHeadings } from "./lineup-columns";
import { LineupRow } from "./lineup-row";

/**
 * The filters, loaded the first time this page has a list to narrow.
 *
 * The same split, and the same two traps, as the manager tabs' copy in
 * {@link LeaguesViewLayout}: the component *is* a trigger and a `<dialog>`, so
 * the seam is the whole of it and the placeholder holds the key's box in the
 * plate's corner until the chunk lands — the plate carries the overhang's margin
 * only when it has a key to overhang, so a fallback of nothing would shift a
 * pinned header on hydration. And the module path is named directly rather than
 * the `@/features/shared` barrel, since re-exported from there the dialog joins
 * the static graph of every page importing anything shared and this `dynamic()`
 * defers bytes the browser has already been sent.
 */
const LeagueFiltersModal = dynamic(
  () =>
    import("@/features/shared/ui/league-filters-modal").then(
      (m) => m.LeagueFiltersModal,
    ),
  {
    ssr: false,
    loading: () => <LeagueFiltersPlaceholder label="Filters" seat="corner" />,
  },
);

/**
 * The lineup checker: every league this account plays in, who each one is playing
 * this week, and what today's lineup is costing there.
 *
 * **It reads the stored account rather than a username in its URL**, the pick
 * tracker's shape and for the pick tracker's reason: the account resolved on
 * `/tools` is persisted, so a tool that is about *your* leagues has no business
 * asking for the name again.
 *
 * **It wears the manager tabs' plate, and the record on it is this week's.** The
 * card is the same component — identity, season, the record as digits, as a bar
 * and as a dial, the columns rail pinned in its foot — because what a reader
 * wants to know before a list of a hundred lineups is exactly what it wants to
 * know before a list of a hundred leagues, and two cards drawn to say that would
 * be two chances for one of them to drift. What differs is the aggregation
 * behind `record`: {@link projectedRecord} rather than {@link aggregateRecord},
 * the week ahead rather than the season so far. The week itself is the plate's
 * `scope` — the line that names what the record was counted over — since that is
 * exactly what it is here.
 *
 * That plate is why there is no {@link PageHeading} above it any more: the app
 * bar names the tool, and a title over a pinned card would push the card off the
 * top it is pinned to. The no-account state keeps one, because down there the
 * card is what is missing.
 *
 * **It narrows with the same league filters the manager tabs carry**, seated in
 * the same corner of the same plate — "which of my lineups do I care about
 * first" is the question a hundred rows of it produces, and a second control
 * drawn to ask it would be a second chance to disagree with that dialog. The
 * selection is local `useState` rather than the manager tool's provider, and
 * that is the whole difference: the provider is there because three *routes*
 * share one selection, and this tool is one page.
 *
 * **The two reads are separate on purpose.** The leagues arrive on the same
 * stream the manager tabs read, and the matchups are a batch read beside it — so
 * the rows draw as soon as the league list lands and the opponents and their
 * numbers fill in behind them, rather than the page waiting on the slower of the
 * two. It is also what makes a failed matchups read cost the week's numbers and
 * not the list.
 */
export function LineupCheckerHome() {
  const user = useStoredAccount();
  // Null until an account is stored, which is both hooks' idle state — no fetch.
  const leagues = useUserLeagues(user?.user_id ?? null);
  const matchups = useManagerMatchups(user?.user_id ?? null);

  const [filters, setFilters] = useState<LeagueFilters>(DEFAULT_LEAGUE_FILTERS);

  // The whole list and the narrowed one, both kept: the dialog's per-option
  // counts are read over the unfiltered leagues, since a menu counted over its
  // own selection collapses to that selection the moment anything is picked.
  const all = useMemo(() => leagues.leagues ?? [], [leagues.leagues]);
  const rows = useMemo(
    () => all.filter((league) => matchesFilters(league, filters)),
    [all, filters],
  );
  // Summed here rather than in the plate, the leagues tabs' rule: the header
  // renders numbers rather than deriving them. Over `rows`, so the projected
  // record answers "how does this week look in *these* leagues" and moves with
  // the selection.
  const record = useMemo(
    () => projectedRecord(rows, matchups.data?.matchups ?? {}),
    [rows, matchups.data],
  );

  const week = matchups.data?.week ?? null;
  // What the record was counted over, in the order it is applied: the week, then
  // what these leagues are. The week leads because it is the qualifier the plate
  // cannot do without — this is the manager tool's card, so a bare W-L on it
  // reads as a season until something says otherwise — and it is null while the
  // matchups are in flight, since the plate names no week rather than one it
  // does not have. A selection that narrows nothing says nothing: the default
  // summary is the absence of a selection describing itself.
  const scope = useMemo(() => {
    const parts = [
      week === null ? null : `projected, week ${week}`,
      activeFilterCount(filters) > 0 ? filterSummary(filters) : null,
    ].filter((part): part is string => part !== null);
    return parts.length > 0 ? parts.join(" · ") : null;
  }, [week, filters]);

  if (!user) return <NoAccount />;

  // The season the leagues route resolved, which is also the one the matchups
  // route answers for — both go through `resolveManagerRequest`. Null until the
  // first `result` lands, which is the cold load below.
  const season = leagues.season;

  // A fragment rather than a wrapper, and it is load-bearing: the plate cancels
  // `PageShell`'s own top padding with a negative margin so its resting place is
  // its pinned one, and a box between the two is a box that margin has to
  // collapse through.
  return (
    <>
      {season !== null && (
        <ManagerHeader
          user={user}
          season={season}
          record={record}
          // What this record was counted over, where the manager tabs put the
          // filters theirs was counted over — beside the number it qualifies
          // rather than in a line of its own above the list.
          scope={scope}
          leagueCount={rows.length}
          stat={{
            label: "Leagues",
            value: rows.length,
            // The narrowed count reads "X of Y", the leagues tab's own spelling:
            // a denominator restating its numerator is left unsaid.
            sub: rows.length === all.length ? undefined : `of ${all.length} total`,
          }}
          filters={
            all.length > 0 ? (
              <LeagueFiltersModal
                filters={filters}
                onChange={setFilters}
                // The unfiltered list, which the per-option counts are over.
                leagues={all}
                // Machined into the plate's bottom-right corner, the seat the
                // manager tabs' copy takes — see `SEATS`.
                seat="corner"
              />
            ) : undefined
          }
          // The clock never takes the readout here. The record beside it is this
          // week as it currently stands, and Sleeper projects that months ahead,
          // so the trade the countdown rests on — an em-dash dial against the
          // only moving number on the card — is exactly inverted on this page:
          // all offseason the timer was covering the number the tool is for.
          countdown={false}
          // The heading rail rides in the plate for the reason it does on the
          // leagues page: the card is pinned, so a rail left at the top of the
          // list would scroll away and leave the numbers under it unlabelled.
          // Drawn over the *filtered* list, since a heading over no rows heads
          // nothing — and unlike the manager tabs' rail there is no storey above
          // the headings that has to stay reachable when the filters empty the
          // list. Omitting it is also what gives the plate back the fuller gap
          // under it, which is what the note below wants to sit in.
          columns={
            rows.length > 0 ? (
              <ListLedge headings={<LineupStatHeadings />} />
            ) : undefined
          }
        />
      )}

      {/* Both failures are reported beside the list rather than instead of it:
          a matchups read that failed leaves every row saying its opponent is
          unresolved, which is a page still worth having. */}
      {leagues.error && <Notice tone="error">{leagues.error}</Notice>}
      {matchups.error && <Notice tone="error">{matchups.error}</Notice>}

      {/* All three states are judged on the *unfiltered* list before the
          filtered one: a cold load is a cold load whatever is selected, and an
          account with no leagues is a different answer from a selection that
          matches none of them — the second is the reader's own doing and says
          so, where the first would send them looking for a fault. */}
      {leagues.loading && all.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-16 text-sm text-foreground/45">
          <FlaskLoader size={56} label="Loading your leagues" />
          <p aria-hidden="true">Loading your leagues</p>
        </div>
      ) : all.length === 0 ? (
        !leagues.error && (
          <Notice>No leagues found for this account this season.</Notice>
        )
      ) : rows.length === 0 ? (
        <Notice>No leagues match these filters.</Notice>
      ) : (
        <ul className="flex w-full flex-col gap-4">
          {rows.map((league) => (
            <LineupRow
              key={league.league_id}
              league={league}
              week={week}
              matchup={matchups.data?.matchups[league.league_id]}
            />
          ))}
        </ul>
      )}
    </>
  );
}

/**
 * The page with no account resolved.
 *
 * Every league here is one of *yours*, so there is nothing behind this tool
 * without knowing whose — the same gate the tools grid puts on its cards. It
 * points at where an account is resolved rather than growing a second username
 * search: two places to answer one question is the drift `UserLookup` exists to
 * prevent.
 *
 * It is the one state that still leads with a title: the plate that names the
 * tool everywhere else is exactly what a reader who has resolved no account does
 * not have.
 */
function NoAccount() {
  return (
    <div>
      <PageHeading
        title="Lineup Checker"
        lede="Check every lineup you have to set this week, in one list."
        className="mb-6"
      />
      <Notice>
        <Link href="/tools" className="text-active hover:underline">
          Look up your Sleeper account
        </Link>{" "}
        to see your leagues here.
      </Notice>
    </div>
  );
}

/** A full-width line standing in for the list — an answer, or a failure. */
function Notice({
  children,
  tone = "muted",
}: {
  children: React.ReactNode;
  tone?: "muted" | "error";
}) {
  return (
    <p
      // Only the error tone interrupts: the muted spelling is an answer, and a
      // reader arrives at it by reading the page.
      role={tone === "error" ? "alert" : undefined}
      className={`rounded-lg border px-4 py-6 text-center text-sm ${
        tone === "error"
          ? "border-red-500/20 bg-red-500/5 text-red-300"
          : "border-foreground/10 bg-foreground/[0.02] text-foreground/45"
      }`}
    >
      {children}
    </p>
  );
}
