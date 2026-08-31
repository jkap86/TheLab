const SIZES = {
  sm: "h-5 w-5 text-[0.6rem] @lg:h-6 @lg:w-6 @lg:text-xs",
  md: "h-7 w-7 text-xs @lg:h-9 @lg:w-9 @lg:text-sm",
  // The manager header's identity plate: big enough to be the card's anchor,
  // small enough to share a phone-width row with the win dial beside it.
  lg: "h-11 w-11 text-lg",
  // A page that is *about* one account — the tools lookup, a pick tracker's
  // league — where the avatar is the subject rather than a label on a row.
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