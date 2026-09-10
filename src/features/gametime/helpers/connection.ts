/**
 * What the gametime page is *doing*, as one word, and what its readout says.
 *
 * Pure and under Node's own runner, on `./live-record`'s terms: the page's one
 * status pill is read at a glance by somebody deciding whether the numbers in
 * front of them are current, and every wrong reading of it is a sentence that
 * renders perfectly and misleads.
 *
 * **It exists because two booleans could not carry seven answers.** The pill
 * was drawn from `connected` and `stale` alone, so every state that was not an
 * open stream fell through to `Connecting…` — including the three where the
 * page is deliberately *not* connecting: an account with no leagues (the hook
 * never opens a stream at all), a season with no week left to follow (the
 * server says so and closes), and a stream that has given up for good. A page
 * saying it is connecting while nothing is connecting is the one reading a
 * status pill must never give.
 */

/** Where the stream is. */
export type GametimeConnection =
  /** Not connecting, on purpose — there is nothing yet to connect for. */
  | "idle"
  /** A stream is opening and has not answered yet. */
  | "connecting"
  /** Open and answering. */
  | "live"
  /** Dropped, and being retried — an answer may still be on screen. */
  | "reconnecting"
  /**
   * The stream could not be kept, and a plain snapshot is standing in for it.
   * The numbers are real and they are not moving. See `useGametime`.
   */
  | "snapshot"
  /** The season has no week left to follow. Terminal, and not a failure. */
  | "complete"
  /** Nothing to show and nothing left to try. */
  | "failed";

/** Where the account's league list is — the page cannot connect without one. */
export type LeagueListState = "loading" | "none" | "ready";

export type GametimeReadout = {
  text: string;
  /** The stream is answering: the readout is lit rather than dimmed. */
  lit: boolean;
  /** A game is running behind an open stream: the lamp pulses. */
  pulse: boolean;
};

type Games = { pre: number; live: number; final: number };

/** `3 in progress`, `12 to come`, `final`, `no games` — the board in three words. */
function gamesPhrase(games: Games): string {
  if (games.live > 0) return `${games.live} in progress`;
  if (games.pre > 0) return `${games.pre} to come`;
  if (games.final > 0) return "final";
  return "no games";
}

/**
 * What the pill beside the week stepper reads.
 *
 * The order is the point: **a terminal or deliberate state answers before any
 * connection state does**, because those are the ones a connection word would
 * misdescribe. Only once the page is genuinely following a week does the
 * reading become the scoreboard's — which is the one thing a reader looking at
 * a quiet page actually needs told, since a page with nothing moving on it is
 * the same picture whether the NFL week has not started or the stream is dead.
 *
 * A degraded feed is named here as well as in the notes above the grid: the
 * notes say which feed and what it costs, and this says that the reading is
 * affected at all, which is what survives a reader who has scrolled past them.
 */
export function gametimeReadout(input: {
  connection: GametimeConnection;
  leagues: LeagueListState;
  /** The scoreboard's own phase counts, or null before an answer lands. */
  games: Games | null;
  /** The room's note that the feeds stopped moving behind a usable page. */
  stale: string | null;
  /** A feed behind the numbers could not be read. */
  degraded: boolean;
}): GametimeReadout {
  const { connection, leagues, games, stale, degraded } = input;

  if (connection === "complete") return { text: "Season complete", lit: false, pulse: false };
  if (leagues === "none") return { text: "No leagues", lit: false, pulse: false };
  if (leagues === "loading") return { text: "Loading leagues…", lit: false, pulse: false };
  if (connection === "failed") {
    return { text: stale ?? "Live updates unavailable", lit: false, pulse: false };
  }
  if (connection === "snapshot") {
    return { text: "Snapshot · not live", lit: false, pulse: false };
  }
  if (connection === "reconnecting") return { text: "Reconnecting…", lit: false, pulse: false };
  if (connection === "connecting") return { text: "Connecting…", lit: false, pulse: false };
  if (connection === "idle") return { text: "Not following", lit: false, pulse: false };

  // Open and answering.
  if (stale) return { text: stale, lit: true, pulse: false };
  if (games === null) return { text: "Live", lit: true, pulse: false };
  if (degraded) return { text: `Degraded · ${gamesPhrase(games)}`, lit: true, pulse: false };
  if (games.live > 0) {
    return {
      text: `Live · ${games.live} game${games.live === 1 ? "" : "s"} in progress`,
      lit: true,
      pulse: true,
    };
  }
  if (games.pre > 0) {
    return {
      text: `Waiting · ${games.pre} game${games.pre === 1 ? "" : "s"} to come`,
      lit: true,
      pulse: false,
    };
  }
  if (games.final > 0) return { text: "Final", lit: true, pulse: false };
  return { text: "No games on the board", lit: true, pulse: false };
}
