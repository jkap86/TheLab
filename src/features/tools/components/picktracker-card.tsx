"use client";

import { useRouter } from "next/navigation";

import type { UserInfo } from "@/shared/contract";

import { useUserLeagues } from "../hooks/use-user-leagues";
import type { Tool } from "../tools.data";
import { ToolLinkCard } from "./tool-link-card";

/**
 * The pick tracker's tools-grid card. Where every other tool is a link into its
 * own search, this one lists the looked-up account's leagues inline and jumps
 * straight to the tracker for whichever is picked — the id is what the tracker
 * needs, and the account already knows every one of them.
 *
 * With no account resolved yet it falls back to the plain link card, whose
 * destination is the manual league-id entry — also how the tracker is opened
 * from a league chat mid-draft, where there's no Sleeper account in hand.
 */
export function PicktrackerCard({
  tool,
  user,
}: {
  tool: Tool;
  user: UserInfo | null;
}) {
  const router = useRouter();
  const { leagues, loading, error } = useUserLeagues(user?.user_id ?? null);

  if (!user) return <ToolLinkCard tool={tool} />;

  const handleSelect = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const leagueId = event.target.value;
    if (leagueId) router.push(`/picktracker/${encodeURIComponent(leagueId)}`);
  };

  const hasLeagues = !!leagues?.length;

  return (
    <div className="flex h-full flex-col rounded-xl border border-foreground/10 bg-foreground/[0.02] p-6">
      <span className="text-xl font-medium">{tool.text}</span>
      <span className="mt-2 text-sm text-foreground/55">{tool.description}</span>

      <div className="mt-4">
        {error ? (
          <p role="alert" className="text-sm text-red-300">
            {error}
          </p>
        ) : (
          <>
            <label htmlFor="picktracker-league" className="sr-only">
              Pick a league to track
            </label>
            <select
              id="picktracker-league"
              defaultValue=""
              disabled={loading || !hasLeagues}
              onChange={handleSelect}
              className="w-full rounded-lg border border-foreground/15 bg-foreground/[0.03] px-4 py-2.5 text-base text-foreground focus:border-active/50 focus:outline-none focus:ring-1 focus:ring-active/40 disabled:cursor-not-allowed disabled:text-foreground/35"
            >
              <option value="" disabled>
                {loading
                  ? "Loading your leagues…"
                  : hasLeagues
                    ? "Select a league…"
                    : "No leagues found"}
              </option>
              {leagues?.map((league) => (
                <option key={league.league_id} value={league.league_id}>
                  {league.name}
                </option>
              ))}
            </select>
          </>
        )}
      </div>
    </div>
  );
}
