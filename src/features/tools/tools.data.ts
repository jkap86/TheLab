export type Tool = {
  href: string;
  text: string;
  description: string;
};

export const tools: Tool[] = [
  {
    href: "/manager",
    text: "Manager",
    description: "View player shares, league rankings, and leaguemates.",
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
    description: "View real trades.",
  },
  {
    href: "/lineupchecker",
    text: "Lineup Checker",
    description: "Validate that your optimal lineup is set.",
  },
];
