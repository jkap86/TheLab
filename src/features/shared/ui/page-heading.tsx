/**
 * A page's opening: the letterspaced eyebrow, the gradient wordmark in the
 * display face, and a line saying what the page is for.
 *
 * The tools page had this treatment and no other page did, which is most of why
 * a tool looked like a different app from the grid that opened it. It lives here
 * so the four pages that lead with a title (tools, the manager search, the pick
 * tracker, trades) can't drift into four spellings of the same header.
 *
 * `size` is the one thing that varies: `hero` is the tools page, whose wordmark
 * *is* the page, and `page` is everything else, where the title names a tool
 * under an app bar that already named it. The eyebrow is optional for the same
 * reason — it says what kind of thing the title is, and a page whose title
 * already says so is better off without one.
 *
 * The gradient's pale-teal stop and the cyan glow are literals: a gradient stop
 * has no token to read (the exception the flask's liquid makes), and the glow is
 * the `active` token's own value.
 */
export function PageHeading({
  eyebrow,
  title,
  lede,
  size = "page",
  className = "",
}: {
  eyebrow?: string;
  title: string;
  lede?: React.ReactNode;
  size?: "hero" | "page";
  /** Layout for the block — the margin below it belongs to the caller. */
  className?: string;
}) {
  return (
    <header className={className}>
      {eyebrow && (
        <p className="font-display text-[0.6875rem] font-medium uppercase tracking-[0.34em] text-active/85">
          {eyebrow}
        </p>
      )}
      <h1
        className={`bg-gradient-to-b from-foreground to-[#8feee6] bg-clip-text font-display font-bold tracking-tight text-transparent [text-shadow:0_0_46px_rgba(0,255,229,0.2)] ${
          eyebrow ? "mt-4" : ""
        } ${
          size === "hero"
            ? "text-5xl sm:text-6xl"
            : "text-3xl sm:text-4xl"
        }`}
      >
        {title}
      </h1>
      {lede && (
        <p
          className={`mt-3 text-foreground/60 ${
            size === "hero" ? "text-lg" : "text-base"
          }`}
        >
          {lede}
        </p>
      )}
    </header>
  );
}
