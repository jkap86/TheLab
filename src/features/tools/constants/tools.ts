import type { Tool } from "../types/tools.types";

export const tools: Tool[] = [
  // One entry, and `hrefFor` is why: `/manager` with no account is the username
  // search, and the same card becomes a direct link to that manager's page once
  // an account resolves, rather than dropping you on a search you already did.
  {
    href: "/manager",
    text: "Manager",
    short: "Mgr",
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
  // `hrefFor` for Manager's reason: the tool is about one manager's leagues,
  // and the route names which — so the card and the rack key resolve to the
  // stored account rather than dropping a reader on a page with no subject.
  {
    href: "/lineupchecker",
    text: "Lineup Checker",
    short: "Lineups",
    description: "Validate that your optimal lineup is set.",
    hrefFor: (username) => `/lineupchecker/${username}`,
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
