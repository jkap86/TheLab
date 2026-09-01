import { Tool } from "../types/tools.types";

export const tools: Tool[] = [
  // The manager tool is three entries, not one: its tabs answer different
  // questions (which leagues, which players, which people) and land on separate
  // routes, so both the grid and the menu link each directly rather than
  // dropping you on Leagues to navigate again. They share the account-less
  // `href` — the username search — and differ only in `hrefFor`.
  {
    href: "/manager",
    text: "Manager",
    description:
      "Rank your leagues by record, points, roster value, and projections.",
    group: "Manager",
    icon: "leagues",
    pattern: "/manager/*",
    hrefFor: (username) => `/manager/${username}`,
  },
  {
    href: "/picktracker",
    text: "Pick Tracker",
    description:
      "Track rookie picks selected in a draft using kickers as placeholders.",
    group: "League tools",
    icon: "picktracker",
    pattern: "/picktracker",
  },
  {
    href: "/trades",
    text: "Trades",
    description:
      "Read every trade in every crawled league, by date, players, picks or manager.",
    group: "League tools",
    icon: "trades",
    pattern: "/trades",
    accountless: true,
  },
  {
    href: "/lineupchecker",
    text: "Lineup Checker",
    description: "Validate that your optimal lineup is set.",
    group: "League tools",
    icon: "lineup",
    pattern: "/lineupchecker",
  },
  {
    href: "/comps",
    text: "Comps",
    description:
      "Find the player-seasons most similar to any player, on the stats and weights you choose.",
    group: "Player tools",
    icon: "comps",
    pattern: "/comps",
    // A question about the player pool, not about anyone's account — like
    // Trades, live without a resolved username.
    accountless: true,
  },
];
