"use client";

import Link from "next/link";
import { useMemo } from "react";

import {
  FlaskLoader,
  ListLedge,
  PageHeading,
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

  const rows = useMemo(() => leagues.leagues ?? [], [leagues.leagues]);
  // Summed here rather than in the plate, the leagues tabs' rule: the header
  // renders numbers rather than deriving them.
  const record = useMemo(
    () => projectedRecord(rows, matchups.data?.matchups ?? {}),
    [rows, matchups.data],
  );

  if (!user) return <NoAccount />;

  const week = matchups.data?.week ?? null;
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
          // rather than in a line of its own above the list. It says
          // "projected" out loud because the plate is the manager tool's, and a
          // W-L on that card reads as a season until something says otherwise.
          // Null while the matchups are still in flight: the plate names no week
          // rather than a week it does not have.
          scope={week === null ? null : `projected, week ${week}`}
          leagueCount={rows.length}
          stat={{ label: "Leagues", value: rows.length }}
          // The heading rail rides in the plate for the reason it does on the
          // leagues page: the card is pinned, so a rail left at the top of the
          // list would scroll away and leave the numbers under it unlabelled.
          // Omitted with the list, since a heading over no rows heads nothing —
          // and omitting it is also what gives the plate back the fuller gap
          // under it, which is what the empty note wants to sit in.
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

      {leagues.loading && rows.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-16 text-sm text-foreground/45">
          <FlaskLoader size={56} label="Loading your leagues" />
          <p aria-hidden="true">Loading your leagues</p>
        </div>
      ) : rows.length === 0 ? (
        !leagues.error && (
          <Notice>No leagues found for this account this season.</Notice>
        )
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
