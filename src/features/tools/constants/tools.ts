import type { Tool } from "../types/tools.types";

export const tools: Tool[] = [
  // One entry, and `hrefFor` is why: `/manager` with no account is the username
  // search, and the same card becomes a direct link to that manager's page once
  // an account resolves, rather than dropping you on a search you already did.
  {
    href: "/manager",
    text: "Manager",
    description:
      "Rank your leagues by record, points, roster value, and projections.",
    hrefFor: (username) => `/manager/${username}`,
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
      "Read every trade in every crawled league, by date, players, picks or manager.",
    accountless: true,
  },
  {
    href: "/lineupchecker",
    text: "Lineup Checker",
    description: "Validate that your optimal lineup is set.",
  },
  {
    href: "/comps",
    text: "Comps",
    description:
      "Find the player-seasons most similar to any player, on the stats and weights you choose.",
    // A question about the player pool, not about anyone's account — like
    // Trades, live without a resolved username.
    accountless: true,
  },
];
