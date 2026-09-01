import type { SubjectKind } from "@/features/shared";

/** Which glyph the menu draws for a tool. */
export type ToolIconName =
    | "leagues"
    | "players"
    | "leaguemates"
    | "picktracker"
    | "trades"
    | "lineup"
    | "comps";

export type ToolGroup = "Manager" | "League tools" | "Player tools";

export type Tool = {
    /** Where the tool points with no account resolved — and how the grid and the
     *  placeholder page spot the tool they are rendering. */
    href: string;
    text: string;
    description: string;
    group: ToolGroup;
    icon: ToolIconName;
    /**
     * The route the tool owns, for the menu's current-page highlight. A `*`
     * stands for exactly one segment and the match is a prefix, so
     * `/picktracker` covers `/picktracker/[leagueId]` too. It is spelled out
     * rather than derived from `href`, because the account-less href is a search
     * page the tool doesn't own (`/manager` sends you to three different views).
     */
    pattern: string;
    /**
     * Where it points once an account resolves, given that account's username.
     * The three manager views share one account-less href — the username search
     * they'd otherwise send you to — and differ only here, so a caller asks a tool
     * where it goes rather than naming each destination itself. Callers go through
     * {@link toolHref}, which owns the URL-encoding.
     */
    hrefFor?: (username: string) => string;
    /**
     * Whether the tool answers anything with no account resolved. False for all
     * but one, which is why the grid gates on the account at all: there is nothing
     * behind "your leagues" without knowing whose. Trades is the exception — it
     * reads every crawled league, so a username is a filter it offers rather than
     * the question it asks — and a card the bar links to but the grid greys out is
     * the drift this flag prevents.
     */
    accountless?: true;
    /**
     * The subject this view is a ranked list of, where it is one.
     *
     * Two of the three manager views are: Players is the manager's player shares
     * and Leaguemates is their leaguemate shares, and both of those lists already
     * exist as a browse that can be laid over the leagues page rather than
     * navigated to (`SharesSheet`). Leagues declares nothing, because a league is
     * the page rather than a subject on it.
     *
     * **It is here rather than in a list of two patterns beside the drawer keys**,
     * for the reason `ViewSwitch` reads this catalogue rather than naming three
     * routes: the row that draws those keys is then derived — the Leagues cell is
     * *absent* rather than filtered out by name, and a fourth manager view joins
     * the row by declaring what it browses. See `ManagerViewDrawers`.
     */
    browses?: SubjectKind;
};

