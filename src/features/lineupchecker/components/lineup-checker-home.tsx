"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import {
  FlaskLoader,
  ListLedge,
  PageHeading,
  activeFilterCount,
  filterSummary,
  useStoredAccount,
} from "@/features/shared";
import { subjectSummary } from "@/features/shared/subjects";
// The module paths rather than that barrel, deliberately: the plate is kept off
// it so the pages that draw none don't carry its countdown, its dial and a query
// hook, and the rail drags both shares sheets in behind a press — see each
// folder's own index.
import { ManagerHeader } from "@/features/shared/ui/manager-header";
import { SubjectRail } from "@/features/shared/ui/subject-rail";

import { useLineupView } from "../hooks/use-lineup-view";
import { useManagerMatchups } from "../hooks/use-manager-matchups";
import { projectedRecord } from "../projected-record";
import { LineupCard } from "./lineup-card";
import { LineupStatHeadings } from "./lineup-columns";

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
 * and as a dial, the filter row and the columns rail pinned in its foot — because
 * what a reader wants to know before a list of a hundred lineups is exactly what
 * it wants to know before a list of a hundred leagues, and two cards drawn to say
 * that would be two chances for one of them to drift. What differs is the
 * aggregation behind `record`: {@link projectedRecord} rather than
 * {@link aggregateRecord}, the week ahead rather than the season so far. The week
 * itself is the plate's `scope` — the line that names what the record was counted
 * over — since that is exactly what it is here.
 *
 * That plate is why there is no {@link PageHeading} above it any more: the app
 * bar names the tool, and a title over a pinned card would push the card off the
 * top it is pinned to. The no-account state keeps one, because down there the
 * card is what is missing.
 *
 * **It narrows with the manager tabs' own filter row**, which is a change of seat
 * as well as of scope. The league filters' key used to be machined into this
 * plate's bottom-right corner — the only control among three readouts, diagonally
 * furthest from the list it narrows — and it leads {@link SubjectRail} now, beside
 * the *who is in it* half of the same question. Both are the manager tool's
 * controls exactly: "which of my lineups do I care about first" is the question a
 * hundred rows of this produces, and a second control drawn to ask it would be a
 * second chance to disagree. What holds the selections is the difference — local
 * `useState` in {@link useLineupView} rather than that tool's providers, since a
 * provider is what three *routes* sharing one selection need and this tool is one
 * page.
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
  const view = useLineupView(user);
  // Null until an account is stored, which is this hook's idle state — no fetch.
  const matchups = useManagerMatchups(user?.user_id ?? null);

  /**
   * Which league is open, if any.
   *
   * Held here rather than in the card, the leagues list's own rule: opening one
   * is a claim about the whole page — the card pins under the header and caps at
   * what is left of the screen — and two cards making that claim at once is two
   * things each asking to be the thing being read.
   */
  const [openId, setOpenId] = useState<string | null>(null);

  const all = view.leagues ?? [];
  const rows = view.filtered;

  // Summed here rather than in the plate, the leagues tabs' rule: the header
  // renders numbers rather than deriving them. Over `rows`, so the projected
  // record answers "how does this week look in *these* leagues" and moves with
  // both selections.
  const record = useMemo(
    () => projectedRecord(rows, matchups.data?.matchups ?? {}),
    [rows, matchups.data],
  );

  const week = matchups.data?.week ?? null;
  // What the record was counted over, in the order the three narrowings are
  // applied: the week, then what these leagues are, then who is in them. The
  // week leads because it is the qualifier the plate cannot do without — this is
  // the manager tool's card, so a bare W-L on it reads as a season until
  // something says otherwise — and it is null while the matchups are in flight,
  // since the plate names no week rather than one it does not have. A selection
  // that narrows nothing says nothing: the default summary is the absence of a
  // selection describing itself.
  const scope = useMemo(() => {
    const parts = [
      week === null ? null : `projected, week ${week}`,
      activeFilterCount(view.filters) > 0 ? filterSummary(view.filters) : null,
      subjectSummary(view.subjects, (subject) => view.subjectDisplay(subject)?.name ?? null),
    ].filter((part): part is string => part !== null);
    return parts.length > 0 ? parts.join(" · ") : null;
  }, [week, view]);

  // Read against the list on screen rather than trusted: narrowing either filter
  // can take the open league out from under the selection, and an id pointing at
  // a card nobody can see would leave the header unpinned for a panel that isn't
  // there. Derived during render, so there is no effect chasing the filters.
  const open = rows.some((league) => league.league_id === openId) ? openId : null;

  if (!user) return <NoAccount />;

  // The season the leagues route resolved, which is also the one the matchups
  // route answers for — both go through `resolveManagerRequest`. Null until the
  // first `result` lands, which is the cold load below.
  const season = view.season;

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
          // No key in the plate's corner: the league filters lead the rail below,
          // beside the other question asked of the same list — see
          // {@link SubjectRail}. The plate keeps its three readout corners and
          // gives back the corner key's clearance, which on a card pinned over a
          // list is league rows.
          //
          // The clock never takes the readout here. The record beside it is this
          // week as it currently stands, and Sleeper projects that months ahead,
          // so the trade the countdown rests on — an em-dash dial against the
          // only moving number on the card — is exactly inverted on this page:
          // all offseason the timer was covering the number the tool is for.
          countdown={false}
          // The header keeps the top through an open league — the filter row and
          // the heading rail below both ride in it, and losing them at the moment
          // a reader goes a level deeper is what the plate letting go used to
          // cost. What it gives up instead is the fade below itself: an open card
          // pins flush against the plate, so those 64px of near-solid background
          // land on the card's own head rather than on the page.
          fade={open === null}
          // The filter row and the heading rail ride in the plate for the reason
          // they do on the leagues page: the card is pinned, so a rail left at
          // the top of the list would scroll away and leave the numbers under it
          // unlabelled — and the control that empties the list has to stay
          // reachable when it does. Their 12px gap is the slab's own wall plus
          // clearance, exactly as `ColumnsBar` spaces the same two parts.
          columns={
            all.length > 0 ? (
              <div className="flex flex-col gap-3">
                <SubjectRail view={view} />
                {/* No rows is no billet: a heading rail with nothing to head is
                    a lit face saying nothing, and the rail above it is where a
                    reader who narrowed to zero goes to get back. */}
                {rows.length > 0 && (
                  <ListLedge headings={<LineupStatHeadings />} />
                )}
              </div>
            ) : undefined
          }
        />
      )}

      {/* Both failures are reported beside the list rather than instead of it:
          a matchups read that failed leaves every row saying its opponent is
          unresolved, which is a page still worth having. */}
      {view.error && <Notice tone="error">{view.error}</Notice>}
      {matchups.error && <Notice tone="error">{matchups.error}</Notice>}

      {/* All three states are judged on the *unfiltered* list before the
          filtered one: a cold load is a cold load whatever is selected, and an
          account with no leagues is a different answer from a selection that
          matches none of them — the second is the reader's own doing and says
          so, where the first would send them looking for a fault. */}
      {view.loading && all.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-16 text-sm text-foreground/45">
          <FlaskLoader size={56} label="Loading your leagues" />
          <p aria-hidden="true">Loading your leagues</p>
        </div>
      ) : all.length === 0 ? (
        !view.error && (
          <Notice>No leagues found for this account this season.</Notice>
        )
      ) : rows.length === 0 ? (
        <Notice>No leagues match these filters.</Notice>
      ) : (
        // 18px rather than 16, the nameplate's number rather than a separation
        // one: each card's name rides out of its top edge on a plate that hangs
        // into the card's own padding, so at a smaller gap the plate sits almost
        // exactly between two cards and can be read as belonging to either.
        <ul className="flex w-full flex-col gap-[18px]">
          {rows.map((league) => (
            <LineupCard
              key={league.league_id}
              league={league}
              week={week}
              matchup={matchups.data?.matchups[league.league_id]}
              expanded={open === league.league_id}
              onToggle={() =>
                setOpenId((current) =>
                  current === league.league_id ? null : league.league_id,
                )
              }
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
