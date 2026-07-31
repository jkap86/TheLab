"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";

import { useStoredAccount } from "@/features/shared";

import { useUserLeagues } from "../hooks/use-user-leagues";
import { LeaguePicker } from "./league-picker";
import { PicktrackerSearch } from "./picktracker-search";

/**
 * The pick tracker's landing page: pick one of your leagues, or paste an id.
 *
 * The picker used to live on the tools grid's card, which put a hundred-league
 * combobox inside a tool *tile* — choosing which league to follow is a step of
 * the tracker, not of picking a tool, so it happens here now and the grid card
 * is a plain link like every other one.
 *
 * It costs no extra typing to move it: the account resolved on `/tools` is
 * persisted (`features/shared/account`), so this page reads the same one and
 * lists its leagues without asking for a username again — the re-prompting
 * `UserLookup` exists to prevent.
 *
 * The id form stays regardless of whether an account is stored, because that is
 * the path this page was built for: opened from a league chat mid-draft, where
 * there's a league id in the URL bar and no Sleeper account in hand.
 */
export function PicktrackerHome() {
  const router = useRouter();
  const user = useStoredAccount();
  // Null until an account is stored, which is the hook's idle state — no fetch.
  const { leagues, loading, error } = useUserLeagues(user?.user_id ?? null);

  const openLeague = (leagueId: string) => {
    router.push(`/picktracker/${encodeURIComponent(leagueId)}`);
  };

  return (
    <div>
      <header className="mb-8">
        <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
          Pick Tracker
        </h1>
        <p className="mt-3 text-lg text-foreground/60">
          Follow a draft that uses kickers as rookie-pick placeholders.
        </p>
      </header>

      {user && (
        <section className="mb-8">
          <h2 className="mb-3 font-display text-[11px] font-medium uppercase tracking-[0.28em] text-active/80">
            Your leagues
            <span className="ml-2 normal-case tracking-normal text-foreground/45">
              @{user.username}
            </span>
          </h2>
          {error ? (
            <p role="alert" className="text-sm text-red-300">
              {error}
            </p>
          ) : (
            <LeaguePicker
              leagues={leagues ?? []}
              loading={loading}
              onSelect={openLeague}
            />
          )}
        </section>
      )}

      <section>
        <h2 className="mb-3 font-display text-[11px] font-medium uppercase tracking-[0.28em] text-foreground/45">
          {user ? "Or track by league ID" : "Track by league ID"}
        </h2>
        <PicktrackerSearch />
        {!user && (
          <p className="mt-3 text-sm text-foreground/50">
            Or{" "}
            <Link href="/tools" className="text-active hover:underline">
              look up your Sleeper account
            </Link>{" "}
            to pick from your own leagues.
          </p>
        )}
      </section>
    </div>
  );
}
