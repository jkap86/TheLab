import { Tool } from "../types/tools.types";

export const tools: Tool[] = [
  
  {
    href: "/manager",
    text: "Leagues",
    description:
      "Rank your leagues by record, points, roster value, and projections.",
    group: "Manager",
    icon: "manager",
    pattern: "/manager/*/leagues",
    hrefFor: (username) => `/manager/${username}/leagues`,
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
    
    accountless: true,
  },
];