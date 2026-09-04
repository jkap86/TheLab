"use client";

import Link from "next/link";

import {
  Avatar,
  CardPlateRow,
  CardRule,
  CONSOLE_CARD,
  CONSOLE_KEY,
  CONSOLE_WELL,
  CONSOLE_WINDOW,
  LeaguePlate,
  PlateField,
  ReadingPlate,
  Scanlines,
} from "@/features/shared";
import type { PicktrackerPickPayload } from "@/shared/contract";

import { usePicktracker } from "../hooks/use-picktracker";

/**
 * One league's placeholder board.
 *
 * The card is the app's console card at page width: a housing with the league
 * on a plate straddling its top edge and the figure it is read for — the next
 * placeholder up — on a plate opposite. That is the same object the manager,
 * trades and lineup-checker cards are, seen from a fourth tool.
 *
 * The rows are **flat**, on the shares drawer's budget argument: no
 * perspective, no `translateZ`, no filter buffers, so there is nothing here to
 * gate behind `pointer-fine:` and no reason for a virtualizer. A draft is a few
 * dozen rows.
 */
export function PicktrackerBoard({ leagueId }: { leagueId: string }) {
  const { data, connected, stale, error, refresh, refreshing } =
    usePicktracker(leagueId);

  if (!data) {
    return (
      <div className="space-y-6">
        <BackLink />
        {error ? (
          <p
            role="alert"
            className="rounded-xl border border-foreground/10 bg-[image:var(--alert-bg)] px-5 py-4 text-sm text-foreground/80"
          >
            {error}
          </p>
        ) : (
          <p role="status" className="font-mono text-sm text-foreground/55">
            Reading the draft…
          </p>
        )}
      </div>
    );
  }

  const complete = data.next_pick === null;

  return (
    <div className="space-y-6">
      <BackLink />

      {/* **`mt-6` is clearance, not spacing.** `CardPlateRow` hangs 13px above
          the card's own box, so a card laid out on its top edge alone puts the
          league plate over whatever precedes it — measured at 9px of overlap
          on the back link before this. Every other card in the app is in a
          grid whose gap already pays for it; this one stands on its own. */}
      <div className={`${CONSOLE_CARD} group/card mt-6`}>
        <CardPlateRow>
          <LeaguePlate name={data.league.name} avatarUrl={data.league.avatar_url} />
          <ReadingPlate>
            <PlateField label={complete ? "Draft" : "On the clock"}>
              {complete ? "Complete" : data.next_pick}
            </PlateField>
          </ReadingPlate>
        </CardPlateRow>

        <CardRule />

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <LiveState complete={complete} connected={connected} stale={stale} />
          <button
            type="button"
            onClick={refresh}
            aria-disabled={refreshing}
            className={`${CONSOLE_KEY} ml-auto ${refreshing ? "opacity-60" : ""}`}
          >
            {refreshing ? "Reading…" : "Refresh"}
          </button>
        </div>

        {/* A note beside a usable board, never in place of one. */}
        {stale && !complete && (
          <p role="status" className="mt-3 font-mono text-[0.6875rem] uppercase tracking-[0.14em] text-foreground/50">
            {stale}
          </p>
        )}

        <div className={`${CONSOLE_WELL} mt-4 overflow-hidden`}>
          <div className={`${ROW} border-b border-foreground/8 font-mono text-[0.5625rem] uppercase tracking-[0.18em] text-foreground/[0.42]`}>
            <span>Pick</span>
            <span>Manager</span>
            <span>Kicker</span>
          </div>

          {data.picks.length === 0 ? (
            <p className="px-4 py-10 text-center font-mono text-sm text-foreground/50">
              No kickers drafted yet.
            </p>
          ) : (
            <ul>
              {data.picks.map((pick) => (
                <PickRow key={pick.pick} pick={pick} />
              ))}
            </ul>
          )}
        </div>

        {/* The whole explanation of the tool, and the reason the numbers on
            this board do not match the ones Sleeper shows. */}
        <p className="mt-3 font-mono text-[0.625rem] leading-relaxed text-foreground/45">
          Numbered by order among kickers ({data.teams} per round), not by draft
          slot — the Nth kicker off the board is rookie pick N.
        </p>
      </div>
    </div>
  );
}

/** One template string, so the header and every row cannot drift apart. */
const ROW =
  "grid grid-cols-[4rem_minmax(0,1fr)_minmax(0,1fr)] items-center gap-x-3 px-4 py-2.5";

function PickRow({ pick }: { pick: PicktrackerPickPayload }) {
  return (
    <li className={`${ROW} border-b border-foreground/[0.06] last:border-b-0`}>
      <span
        className={`${CONSOLE_WINDOW} inline-flex justify-center rounded-md px-1.5 py-1 font-mono text-[0.75rem] tabular-nums text-readout [text-shadow:var(--readout-text-glow)]`}
      >
        <Scanlines />
        <span className="relative">{pick.pick}</span>
      </span>

      {pick.picked_by ? (
        <span className="flex min-w-0 items-center gap-2">
          <Avatar url={pick.picked_by.avatar_url} name={pick.picked_by.display_name} size="sm" />
          <span className="min-w-0 truncate font-mono text-[0.8125rem] text-foreground/85">
            {pick.picked_by.display_name}
          </span>
        </span>
      ) : (
        /* An autopick carries no user id, and a guessed manager would be a
           claim. The em dash is the app's third answer: not zero, not a name. */
        <span className="font-mono text-[0.8125rem] text-foreground/35">—</span>
      )}

      <span className="min-w-0 truncate font-mono text-[0.8125rem] text-foreground/70">
        {pick.player_name}
      </span>
    </li>
  );
}

/**
 * What the stream is doing, as a readout rather than a spinner.
 *
 * A complete draft reads `Paused` rather than `Live`, because the room really
 * has stopped polling — saying "live" over a poller that has deliberately shut
 * down would be the one claim this readout exists to avoid.
 */
function LiveState({
  complete,
  connected,
  stale,
}: {
  complete: boolean;
  connected: boolean;
  stale: string | null;
}) {
  const label = complete
    ? "Paused · draft complete"
    : connected && !stale
      ? "Live"
      : "Reconnecting";
  const lit = !complete && connected && !stale;

  return (
    <span className="inline-flex items-center gap-2 font-mono text-[0.625rem] uppercase tracking-[0.16em] text-foreground/55">
      <span
        aria-hidden
        className={`h-1.5 w-1.5 rounded-full ${
          lit
            ? "bg-active shadow-[0_0_8px_var(--accent-glow)] lab-anim animate-pulse"
            : "bg-foreground/25"
        }`}
      />
      {label}
    </span>
  );
}

function BackLink() {
  return (
    <Link
      href="/picktracker"
      className="font-mono text-[0.6875rem] uppercase tracking-[0.16em] text-foreground/55 hover:text-readout"
    >
      ← Track another league
    </Link>
  );
}
