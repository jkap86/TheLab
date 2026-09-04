"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";

import {
  CONSOLE_KEY,
  useManagerLeagues,
  useStoredAccount,
} from "@/features/shared";

import { LeaguePicker } from "./league-picker";
import { PicktrackerSearch } from "./picktracker-search";

/**
 * Where the pick tracker starts: choose a league, or paste an id.
 *
 * **Choosing a league is a step of this tool, not of picking a tool.** The
 * registry entry has no `hrefFor`, because a league id is the one thing a
 * username does not give you — so the grid links here and this page does the
 * choosing, filling itself from the account resolved on `/tools` rather than
 * asking for a username a second time.
 *
 * With no account the raw-id form is the whole page, and that state is **idle
 * rather than empty**: nothing is fetched, so there is nothing to report as
 * missing.
 */
export function PicktrackerHome({ heading }: { heading: ReactNode }) {
  const account = useStoredAccount();
  const username = account?.username ?? null;

  return (
    <div className="space-y-8">
      {heading}
      <p className="max-w-prose text-sm leading-relaxed text-foreground/60">
        Leagues that trade next year&rsquo;s rookie picks during a startup draft
        take kickers as stand-ins, because those rookies are not in
        Sleeper&rsquo;s player pool yet. This reads a draft back the way the
        room means it: the Nth kicker off the board is rookie pick N.
      </p>

      {username ? (
        <Leagues username={username} />
      ) : (
        <Section title="No account connected">
          <p className="text-sm text-foreground/60">
            Connect a Sleeper account on the tools page to pick from your own
            leagues, or track any league by its ID below.
          </p>
          <Link href="/tools" className={`${CONSOLE_KEY} mt-3 inline-block`}>
            Go to tools
          </Link>
        </Section>
      )}

      <Section title={username ? "Or track by league ID" : "Track by league ID"}>
        <PicktrackerSearch />
      </Section>
    </div>
  );
}

/**
 * The picker, fed by the same leagues stream the manager tool reads.
 *
 * `refreshing` with nothing yet in hand is what "loading" means here — a cached
 * list is enough to fill a menu from, so this does not wait out a background
 * refresh the way the manager page's progress bar does.
 */
function Leagues({ username }: { username: string }) {
  const router = useRouter();
  const { leagues, refreshing, error } = useManagerLeagues(username);

  return (
    <Section title={`Your leagues @${username}`}>
      {error ? (
        <p role="alert" className="text-sm text-foreground/70">
          {error}
        </p>
      ) : (
        <LeaguePicker
          leagues={leagues}
          loading={refreshing && leagues.length === 0}
          onSelect={(leagueId) =>
            router.push(`/picktracker/${encodeURIComponent(leagueId)}`)
          }
        />
      )}
    </Section>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="font-mono text-[0.6875rem] uppercase tracking-[0.16em] text-foreground/50">
        {title}
      </h2>
      {children}
    </section>
  );
}
