"use client";

import Link from "next/link";

import {
  FlaskLoader,
  ListLedge,
  PageHeading,
  useStoredAccount,
  useUserLeagues,
} from "@/features/shared";

import { useManagerMatchups } from "../hooks/use-manager-matchups";
import { LineupStatHeadings } from "./lineup-columns";
import { LineupRow } from "./lineup-row";

/**
 * The lineup checker: every league this account plays in, who each one is playing
 * this week, and four stat columns the tool will grade those lineups with.
 *
 * **It reads the stored account rather than a username in its URL**, the pick
 * tracker's shape and for the pick tracker's reason: the account resolved on
 * `/tools` is persisted, so a tool that is about *your* leagues has no business
 * asking for the name again. That is also why there is no manager plate here —
 * the page is about one account by construction, so the identity worth stating is
 * a line under the title rather than a pinned card.
 *
 * **The two reads are separate on purpose.** The leagues arrive on the same
 * stream the manager tabs read, and the matchups are a batch read beside it — so
 * the rows draw as soon as the league list lands and the opponents fill in
 * behind them, rather than the page waiting on the slower of the two. It is also
 * what makes a failed matchups read cost the opponents and not the list.
 */
export function LineupCheckerHome() {
  const user = useStoredAccount();
  // Null until an account is stored, which is both hooks' idle state — no fetch.
  const leagues = useUserLeagues(user?.user_id ?? null);
  const matchups = useManagerMatchups(user?.user_id ?? null);

  if (!user) return <NoAccount />;

  const week = matchups.data?.week ?? null;
  const rows = leagues.leagues ?? [];

  return (
    <div>
      <PageHeading
        title="Lineup Checker"
        lede="Check every lineup you have to set this week, in one list."
        className="mb-6"
      />

      <p className="mb-6 text-sm text-foreground/45">
        <span className="text-foreground/70">@{user.username}</span>
        {week !== null && <> · week {week}</>}
      </p>

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
        <>
          <ListLedge headings={<LineupStatHeadings />} />
          <ul className="mt-4 flex flex-col gap-4 w-full">
            {rows.map((league) => (
              <LineupRow
                key={league.league_id}
                league={league}
                week={week}
                matchup={matchups.data?.matchups[league.league_id]}
              />
            ))}
          </ul>
        </>
      )}
    </div>
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
