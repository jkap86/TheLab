export type Tool = {
  /** Where the tool points with no account resolved — and how the grid spots
   *  the tool it is rendering. */
  href: string;
  text: string;
  /**
   * The name at a phone's width, where the rack's menu key carries it beside
   * the wordmark and the flask. Omitted where {@link Tool.text} already fits.
   *
   * It lives here rather than being truncated in `ToolsMenu` because a short
   * name is a fact about the tool — "Lineup Checker" abbreviates to "Lineups"
   * and not to "Lineup Ch…" — and a component cutting a string at a character
   * count would have to be right about every entry the registry grows into.
   */
  short?: string;
  description: string;
  /**
   * Where it points once an account resolves, given that account's username.
   * A tool whose account-less `href` is already its destination omits this.
   * Callers go through {@link toolHref}, which owns the URL-encoding.
   */
  hrefFor?: (username: string) => string;
  /**
   * Whether the tool answers anything with no account resolved. False for all
   * but two, which is why the grid gates on the account at all: there is nothing
   * behind "your leagues" without knowing whose. Trades is the exception — it
   * reads every crawled league, so a username is a filter it offers rather than
   * the question it asks — and a card the grid links to but greys out is the
   * drift this flag prevents.
   */
  accountless?: true;
};
