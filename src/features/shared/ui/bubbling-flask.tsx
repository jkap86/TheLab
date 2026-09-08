/**
 * The app's own flask mark, bubbling — what the console shows while it is
 * reading.
 *
 * Every loading state in this app printed a word or an em dash: `/trades` said
 * `Reading the board…`, a rank window and a check tile said `—`. None of it
 * looked like the machine was doing anything, and the em dash in particular is
 * the app's spelling of *no answer at all* — so a window waiting on a request
 * and a window whose metric has nothing to rank said the identical thing. This
 * is the first of those two, drawn: {@link FlaskMark}'s three paths with fluid
 * in them, a lit meniscus, rising bubbles and a specular streak on the near
 * wall.
 *
 * **It lives here rather than in `features/tools` beside the mark it is made
 * of**, on the line `CONSOLE_KEY` and `ManagerPlate` moved on: three features
 * read it (`trades`, `manager`, `lineupchecker`), and `features/tools` may read
 * `features/shared` where the reverse would invert the layering. That is also
 * why the three path constants are declared *here* and imported by
 * `flask-mark.tsx` rather than the other way round, which is the direction the
 * handoff asks for and the one the layering allows. Two spellings of one shape
 * drift, and this one has a clip path cut from it.
 *
 * **The defs are rendered once per document, not once per flask** — see
 * {@link FlaskDefs}, which is `LineupMarkDefs`' arrangement and its argument.
 *
 * **Nothing in here is a spinner.** The bubbles rise, the fluid rocks and the
 * halo breathes, and every one of those elements carries `lab-anim`, so the
 * whole thing stops under `prefers-reduced-motion: reduce` and leaves a static
 * glass mark with fluid in it — which is a legitimate resting state rather than
 * a broken one. That is the whole reason the indicator is a *vessel* rather
 * than a rotating arc: an arc that cannot rotate says nothing.
 */

/** The vessel: neck, shoulders, taper, base. */
export const FLASK_VESSEL =
  "M10.2 3v5.4L4.9 19.1a1.1 1.1 0 0 0 1 1.6h12.2a1.1 1.1 0 0 0 1-1.6L13.8 8.4V3";

/** The fluid in the bottom third. Flat top, following the taper to the base. */
export const FLASK_FLUID =
  "M7.3 14.8h9.4l2.8 5.4a1 1 0 0 1-1 .5H5.5a1 1 0 0 1-1-.5z";

/** The ground-glass lip. */
export const FLASK_LIP = "M9.2 3h5.6";

/** The fluid's own surface, drawn as a line so it can catch the light. */
const FLASK_MENISCUS = "M7.3 14.8h9.4";

/**
 * The vessel again, closed, as a clip.
 *
 * The open path is what gets *stroked* — closing it would draw a rule across
 * the neck — and a clip needs the closed shape or it fills to the straight line
 * between the two neck ends and takes the shoulders with it.
 */
const FLASK_CLIP = `${FLASK_VESSEL}z`;

/** Fragment ids, spelled once: the defs below and every flask share them. */
const GLASS = "fl-glass";
const FLUID = "fl-fluid-g";
const BUBBLE = "fl-bubble-g";
const SPEC = "fl-spec";
const CLIP = "fl-vessel";

/**
 * The glass, as the *shape* of a ramp and the tokens it is made of.
 *
 * `LineupMarkDefs`' pattern and its reason: the offsets are the design and the
 * colours are what a theme decides, so light mode turns them over — a tint that
 * *lightens* an empty vessel on the dark ground has to *darken* one on the pale
 * one — without this file knowing there are two schemes.
 */
const GLASS_STOPS = [
  { offset: 0, token: "--flask-glass-lit", opacity: 0.26 },
  { offset: 0.42, token: "--flask-glass-core", opacity: 0.05 },
  { offset: 1, token: "--flask-glass-lit", opacity: 0.16 },
] as const;

/**
 * The fluid, and it is dark on purpose.
 *
 * An earlier pass opened this ramp at `#c4fff8` and the white bubbles vanished
 * into it — a white object needs a dark ground. `#4ce3d4 → #00302c` is what
 * makes a bubble read, and it is also what makes the vessel look like it holds
 * a *depth* of liquid rather than a flat teal block.
 *
 * **Literals rather than tokens, and the same four in both themes.** These are
 * the mark's own material rather than a surface the page decides: a flask of
 * dark teal liquid is a flask of dark teal liquid on white paper too. It is
 * also what keeps the bubbles legible in light mode, where a fluid turned over
 * with the theme would be a white bubble on a pale liquid — the exact failure
 * this ramp exists to avoid.
 */
const FLUID_STOPS = [
  { offset: 0, color: "#4ce3d4" },
  { offset: 0.28, color: "#00b8a7" },
  { offset: 0.68, color: "#00776d" },
  { offset: 1, color: "#00302c" },
] as const;

/** A bubble: lit from upper-left, with a pale rim where the fluid meets it. */
const BUBBLE_STOPS = [
  { offset: 0, color: "#ffffff", opacity: 0.98 },
  { offset: 0.38, color: "#d6fffa", opacity: 0.78 },
  { offset: 0.8, color: "#9ffff2", opacity: 0.26 },
  { offset: 1, color: "#e8fffc", opacity: 0.6 },
] as const;

/**
 * One bubble of a set: where it starts, how big, and its own clock.
 *
 * `r` is in **viewBox units and therefore does not scale with `size`** — see
 * {@link bubblesFor}, which is the whole reason there are three sets rather
 * than one.
 */
type Bubble = {
  cx: number;
  cy: number;
  r: number;
  /** Seconds. */
  dur: number;
  /** Seconds. */
  delay: number;
};

/**
 * Four bubbles for a page-sized flask, three for a well, two for an inline one.
 *
 * **The radii are viewBox units, so they are a function of the rendered size
 * rather than a constant**: a value that reads at 88px is an invisible speck at
 * 24. Rendered diameter is `2 · r · size / 24`, and the floor the sets are
 * derived from is **6px on screen for the largest bubble** — below that it
 * reads as a static dot and the whole indicator looks broken. The three sets
 * land at 11.7px (88), 8.2/7.3px (34/30) and 6.0px (24).
 *
 * **The bands are what a new size is answered by**, which is the rule rather
 * than the table: the 32px flask at the trades board's foot is not one of the
 * three sizes the design names, and the prototype gave it a set of its own
 * whose largest bubble renders at **5.07px** — under the floor the same
 * document states. It takes the well set here, at 7.7px.
 *
 * Each bubble carries its own duration and delay so the three or four inside
 * one flask do not rise together; `phase` is what stops two *flasks* rising
 * together — see {@link BubblingFlask}.
 */
function bubblesFor(size: number): readonly Bubble[] {
  if (size >= 60) {
    return [
      { cx: 9.9, cy: 19.4, r: 1.6, dur: 2, delay: 0 },
      { cx: 12.6, cy: 19.9, r: 1.15, dur: 2.55, delay: 0.55 },
      { cx: 14.4, cy: 19.2, r: 1.4, dur: 2.25, delay: 1.15 },
      { cx: 11.4, cy: 20.2, r: 0.95, dur: 1.8, delay: 1.6 },
    ];
  }
  if (size >= 28) {
    return [
      { cx: 11, cy: 19.4, r: 2.9, dur: 2, delay: 0 },
      { cx: 13.6, cy: 19.9, r: 2.1, dur: 2.5, delay: 0.7 },
      { cx: 12.2, cy: 20.1, r: 1.5, dur: 2.2, delay: 1.4 },
    ];
  }
  return [
    { cx: 11.4, cy: 19.5, r: 3, dur: 1.95, delay: 0 },
    { cx: 13.6, cy: 19.9, r: 2.2, dur: 2.4, delay: 0.85 },
  ];
}

/**
 * How far apart, in seconds, two adjacent flasks' bubbles are started.
 *
 * A card's four rank windows mount in one frame, so without this they run the
 * identical animation from the identical instant and the row pulses in
 * lockstep — which reads as one four-part widget rather than four instruments
 * each doing their own work. It is **wrapped modulo each bubble's own
 * duration**, so a late phase is a shifted cycle rather than a long wait before
 * the flask does anything at all; in steady state the two are the same, and at
 * `t = 0` only the first is.
 */
const PHASE_STEP_S = 0.37;

/**
 * The flask.
 *
 * `size` is the rendered px. `tone` is the only thing that varies beyond it and
 * it governs three things and nothing else: the vessel's stroke, the cast under
 * it, and whether the caller stands a halo behind it — `loud` is the page-level
 * indicator on `/trades`, `quiet` is every well.
 *
 * **`label` is the accessible name, and `null` is a real value.** A flask
 * standing on its own in a rank window is the only thing saying the read has
 * not landed, so it needs a name; a flask beside `Loading trades…` inside a
 * `role="status"` region is decoration, and naming it there is the same news
 * read twice. So the copy decides, not this component.
 */
export function BubblingFlask({
  size,
  tone = "quiet",
  label = "Loading",
  phase = 0,
  className,
}: {
  /** Rendered px. 88 (page), 34/30 (well), 32/24 (inline). */
  size: number;
  /** `loud` is the page-level indicator; `quiet` is every well. */
  tone?: "loud" | "quiet";
  /** Accessible name, or `null` where copy beside it already says this. */
  label?: string | null;
  /**
   * Which of a row of flasks this is. Shifts every bubble's start so four
   * windows on one card do not rise in lockstep — see {@link PHASE_STEP_S}.
   * An integer the caller already has (a map index); it never needs to be
   * unique across the page, only across a group a reader sees at once.
   */
  phase?: number;
  className?: string;
}) {
  const loud = tone === "loud";
  const bubbles = bubblesFor(size);

  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      // Decorative or named, never both — see the `label` prop.
      role={label === null ? undefined : "img"}
      aria-label={label === null ? undefined : label}
      aria-hidden={label === null ? true : undefined}
      focusable="false"
      // A token rather than a literal list: the cast inverts for light mode
      // rather than dimming, on the rule every shadow in `globals.css` is
      // written by. It goes through `style` because a `filter` is a comma list
      // with no utility to generate.
      style={{ filter: `var(${loud ? "--flask-cast-loud" : "--flask-cast-quiet"})` }}
    >
      {/* The rim. **A CSS property rather than the `stroke` presentation
          attribute**, which is what lets it name a token — the finding
          `LineupMarkDefs` records for `stop-color`, and the same rule. */}
      <path
        d={FLASK_VESSEL}
        fill={`url(#${GLASS})`}
        strokeWidth={loud ? 1.4 : 1.5}
        style={{ stroke: `var(${loud ? "--accent" : "--flask-rim-quiet"})` }}
      />

      {/* Everything inside the glass, clipped by it. **Paint order is the
          reading**: fluid, then the surface it presents, then what rises
          through that surface, then the light on the near wall. The specular
          sits over the fluid because the wall is in front of it; the meniscus
          sits under the bubbles because they rise through it. */}
      <g clipPath={`url(#${CLIP})`}>
        <path
          d={FLASK_FLUID}
          fill={`url(#${FLUID})`}
          className="lab-anim"
          // `fill-box` and `center` for the reason every bubble below carries
          // them — see there. On the fluid the failure is milder and just as
          // silent: the rock would be about the viewBox origin instead of the
          // body's own centre.
          style={{
            transformBox: "fill-box",
            transformOrigin: "center",
            animation: "fl-fluid 2.4s ease-in-out infinite",
          }}
        />
        <path
          d={FLASK_MENISCUS}
          stroke="#e6fffb"
          strokeOpacity={0.95}
          strokeWidth={0.5}
        />
        {bubbles.map((b, i) => (
          <circle
            key={i}
            cx={b.cx}
            cy={b.cy}
            r={b.r}
            fill={`url(#${BUBBLE})`}
            // The rim is what seats a bubble *in* the fluid rather than on it.
            stroke="rgba(0,52,47,0.32)"
            strokeWidth={0.14}
            className="lab-anim"
            style={{
              // **Both of these are load-bearing.** Without them `scale()` on
              // an SVG `<circle>` is applied about the viewBox origin `(0,0)`,
              // so the bubble translates diagonally out of the vessel and the
              // clip removes it — it renders, at full opacity, off the flask.
              transformBox: "fill-box",
              transformOrigin: "center",
              // **`backwards` is load-bearing too.** A delayed bubble without
              // it sits at its natural state (`transform: none`, `opacity: 1`)
              // for the length of the delay: two bright static dots in the
              // fluid before anything starts moving.
              animation: `fl-bub ${b.dur}s ease-in ${
                (b.delay + phase * PHASE_STEP_S) % b.dur
              }s infinite backwards`,
            }}
          />
        ))}
        {/* The near wall catching the light, and a fainter one opposite. */}
        <path
          d="M10.55 4v4.55L6.05 17.7"
          stroke={`url(#${SPEC})`}
          strokeWidth={0.72}
          strokeLinecap="round"
        />
        <path
          d="M13.4 4.5v3.4"
          strokeWidth={0.48}
          strokeLinecap="round"
          style={{ stroke: `var(--flask-spec-faint)` }}
        />
      </g>

      <path
        d={FLASK_LIP}
        strokeWidth={loud ? 1.4 : 1.5}
        style={{ stroke: `var(${loud ? "--accent" : "--flask-rim-quiet"})` }}
      />
    </svg>
  );
}

/**
 * The four gradients and the clip, once for the whole document.
 *
 * **SVG defs are document-global, so eight flasks reference one set** — a card
 * with four rank windows loading and a header with two more is eight copies of
 * four gradients parsed for one identical result. This is `LineupMarkDefs`'
 * arrangement exactly, and it is mounted the same way: by the page, which is
 * the one place that knows there is a list of cards at all, and *beside* a list
 * rather than inside one, since a `<ul>` takes `<li>` children and nothing
 * else.
 *
 * The clip rides here too. Its coordinates are in the referencing element's own
 * user space, and every flask is a `0 0 24 24` viewBox whatever its rendered
 * size, so one clip serves every size on the page.
 *
 * A page that mounts a flask without this draws a vessel whose fill, fluid and
 * bubbles resolve to nothing — which reads as an *empty* flask rather than as a
 * broken one, so it is worth knowing rather than discovering.
 */
export function FlaskDefs() {
  return (
    <svg aria-hidden focusable="false" width={0} height={0} className="absolute">
      <defs>
        <linearGradient id={GLASS} x1="0" y1="0" x2="1" y2="1">
          {GLASS_STOPS.map((stop, i) => (
            <stop
              key={i}
              offset={stop.offset}
              stopOpacity={stop.opacity}
              // A CSS property rather than the `stop-color` attribute, which is
              // what lets it name a token: a presentation attribute does not
              // resolve `var()`.
              style={{ stopColor: `var(${stop.token})` }}
            />
          ))}
        </linearGradient>
        <linearGradient id={FLUID} x1="0" y1="0" x2="0" y2="1">
          {FLUID_STOPS.map((stop) => (
            <stop key={stop.offset} offset={stop.offset} stopColor={stop.color} />
          ))}
        </linearGradient>
        <radialGradient id={BUBBLE} cx="0.34" cy="0.28" r="0.78">
          {BUBBLE_STOPS.map((stop) => (
            <stop
              key={stop.offset}
              offset={stop.offset}
              stopColor={stop.color}
              stopOpacity={stop.opacity}
            />
          ))}
        </radialGradient>
        {/* The streak down the near wall: opaque at the neck, gone by the base.
            Its colour is a token because light mode turns it over — a white
            highlight on a pale ground is invisible, so there it is the shadow
            the near wall casts instead. */}
        <linearGradient id={SPEC} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopOpacity={0.92} style={{ stopColor: "var(--flask-spec)" }} />
          <stop offset="1" stopOpacity={0} style={{ stopColor: "var(--flask-spec)" }} />
        </linearGradient>
        <clipPath id={CLIP}>
          <path d={FLASK_CLIP} />
        </clipPath>
      </defs>
    </svg>
  );
}
