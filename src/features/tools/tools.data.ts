export type Tool = {
  /** Where the card points with no account resolved — and how the grid spots
   *  the tools it renders specially. */
  href: string;
  text: string;
  description: string;
  /**
   * Where it points once an account resolves, given that account's username
   * **already URL-encoded** (the grid encodes once, so this doesn't repeat it).
   * The three manager views share one account-less href — the username search
   * they'd otherwise send you to — and differ only here, so the grid asks a tool
   * where it goes rather than naming each destination itself.
   */
  hrefFor?: (username: string) => string;
};

export const tools: Tool[] = [
  // The manager tool is three cards, not one: its tabs answer different
  // questions (which leagues, which players, which people) and land on separate
  // routes, so the grid links each directly rather than dropping you on Leagues
  // to navigate again.
  {
    href: "/manager",
    text: "Leagues",
    description:
      "Rank your leagues by record, points, roster value, and projections.",
    hrefFor: (username) => `/manager/${username}/leagues`,
  },
  {
    href: "/manager",
    text: "Players",
    description:
      "See who you hold, in how many leagues, and at what share of them.",
    hrefFor: (username) => `/manager/${username}/players`,
  },
  {
    href: "/manager",
    text: "Leaguemates",
    description: "See who you play against most, and which leagues you share.",
    hrefFor: (username) => `/manager/${username}/leaguemates`,
  },
  {
    href: "/picktracker",
    text: "Pick Tracker",
    description:
      "Track rookie picks selected in a draft using kickers as placeholders.",
  },
  {
    href: "/trades",
    text: "Trades",
    description:
      "Read every trade in your leagues, by date, players, picks or manager.",
  },
  {
    href: "/lineupchecker",
    text: "Lineup Checker",
    description: "Validate that your optimal lineup is set.",
  },
];
