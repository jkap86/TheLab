/*
 * `sm` and `md` grow with the *container* rather than the viewport, because
 * they label rows in a list whose width is set by the panel around it, not by
 * the window. That means their `@lg:` half only fires inside an ancestor marked
 * `@container` — without one the variants are inert and the avatar silently
 * stays at its base size. `lg` and `xl` are fixed and need no container.
 */
const SIZES = {
  sm: "h-5 w-5 text-[0.6rem] @lg:h-6 @lg:w-6 @lg:text-xs",
  md: "h-7 w-7 text-xs @lg:h-9 @lg:w-9 @lg:text-sm",
  // An identity plate: big enough to anchor a card, small enough to share a
  // phone-width row with whatever sits beside it.
  lg: "h-11 w-11 text-lg",
  // A page that is *about* one account — the tools lookup — where the avatar is
  // the subject rather than a label on a row.
  xl: "h-16 w-16 text-2xl",
} as const;

export default function Avatar({
  url,
  name,
  size = "sm",
}: {
  url: string | null | undefined;
  /** Used for the letter fallback; not rendered when `url` is present. */
  name: string;
  size?: keyof typeof SIZES;
}) {
  const dimensions = SIZES[size];

  if (url) {
    return (
      /* eslint-disable-next-line @next/next/no-img-element */
      <img
        src={url}
        alt=""
        className={`${dimensions} shrink-0 rounded-full border border-foreground/10 object-cover`}
      />
    );
  }

  return (
    <span
      className={`${dimensions} flex shrink-0 items-center justify-center rounded-full border border-foreground/10 bg-foreground/5 font-semibold text-foreground/40`}
    >
      {name.charAt(0).toUpperCase()}
    </span>
  );
}