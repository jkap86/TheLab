"use client";

import { useRouter } from "next/navigation";

import type { UserInfo } from "@/shared/contract";

import { useUserLeagues } from "../hooks/use-user-leagues";
import type { Tool } from "../tools.data";
import { LeaguePicker } from "./league-picker";
import { ToolLinkCard } from "./tool-link-card";

/**
 * The pick tracker's tools-grid card. Where every other tool is a link into its
 * own search, this one lists the looked-up account's leagues inline and jumps
 * straight to the tracker for whichever is picked — the id is what the tracker
 * needs, and the account already knows every one of them. That inline picker is
 * itself the "disabled until a league is selected" gate: there is no way to the
 * tracker page from here without choosing one.
 *
 * With no account resolved yet it renders the disabled card, like every other
 * tool on the grid — the account is what fills the picker. (The tracker still
 * opens by id at `/picktracker` for a league chat mid-draft, where there's no
 * Sleeper account in hand; that path just isn't reached through this card.)
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

  if (!user) return <ToolLinkCard tool={tool} disabled />;

  const handleSelect = (leagueId: string) => {
    router.push(`/picktracker/${encodeURIComponent(leagueId)}`);
  };

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
          <LeaguePicker
            leagues={leagues ?? []}
            loading={loading}
            onSelect={handleSelect}
          />
        )}
      </div>
    </div>
  );
}
