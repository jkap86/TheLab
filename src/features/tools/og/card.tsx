/**
 * The Open Graph cards: the unfurl a link to The Lab renders as in a text
 * thread, Sleeper chat, Slack, Discord or X.
 *
 * **Every value here is a literal, and that is a constraint rather than a
 * style.** These render through Satori, which resolves no CSS custom
 * properties — `var(--housing-bg)` is not a dark gradient to it, it is
 * nothing. So the console's vocabulary is transcribed from `globals.css` by
 * hand, and the two have to be kept in step by whoever edits either. The
 * literals are the same ones the design reference carries.
 *
 * **Three things about Satori shaped the markup**, each verified by rendering
 * rather than assumed:
 *
 * 1. **An engraved figure cannot be one `text-shadow` list.** Satori chains
 *    the shadows as filters, each blurring the accumulated result rather than
 *    the glyphs, so the design's stack — five dark relief steps and a wide
 *    teal glow — comes out as a blown-out neon halo with no relief at all. The
 *    hero is therefore two stacked copies: the glow behind, the relief in
 *    front, which is what a browser paints from that one list and is also the
 *    technique the wordmark itself uses. See {@link HERO_GLOW}.
 * 2. **An axis-aligned repeating gradient needs its stops spelled out.**
 *    `repeating-linear-gradient(to bottom, C 0 1px, transparent 1px 3px)`
 *    renders flat — no scanlines, no error, nothing on screen saying so —
 *    while the four-stop form gives an exact 1px line every 3px. The grain,
 *    which is 45deg, renders from the shorthand.
 * 3. **`background-clip: text` and `filter` are unsupported**, which is why
 *    the wordmark's type arrives as an image. See `shared/og/assets.ts`.
 *
 * Nothing on either card is a live reading. That is the design's own decision
 * and the reason both can be cached hard — see `PicktrackerCardPayload`.
 */
import type { PicktrackerCardPayload } from "@/shared/contract";
import { WORDMARK_34, WORDMARK_96 } from "@/shared/og";

import { tools } from "../constants/tools";

/** 1200 × 630 — the size every client crops its own shape out of. */
export const OG_SIZE = { width: 1200, height: 630 };

/**
 * How wide the league's name may be, resolved rather than left to flex.
 *
 * The card's geometry is fixed, so this is arithmetic: 1200 less the housing's
 * two 76px insets, its two 1px borders and its 34px padding leaves a 978px
 * window; less the glass's 40px padding either side leaves 898; less the
 * avatar and the 34px gap leaves this.
 *
 * **It is stated because Satori will not shrink the flex item to it.** Left to
 * `flex-shrink`, the name keeps its max-content width, the row overflows its
 * own glass, and the avatar is clipped in half by the window's `overflow:
 * hidden` — which is what a render showed, and which looks like a design
 * decision rather than a fault. Capped, the row is never wider than the glass
 * and a short name still centres, because the item's own width is what it
 * measures until it reaches this.
 */
const HERO_MAX_WIDTH = 1200 - 76 * 2 - 2 - 34 * 2 - 40 * 2 - 112 - 34;

const ACCENT = "#00ffe5";
const ACCENT_GLOW = "rgba(0,255,229,0.45)";
const READOUT_TEXT = "#9ffff2";
const INK = "rgba(237,237,237,0.76)";
const MONO = "Geist Mono";
const DISPLAY = "Geist";

const PANEL_BG =
  "radial-gradient(120% 80% at 50% -20%, #16303c 0%, #0b1418 38%, #08090a 72%)";
const PANEL_GRAIN =
  "repeating-linear-gradient(45deg, rgba(255,255,255,0.016) 0 1px, transparent 1px 3px)";
const PANEL_SPECULAR =
  "linear-gradient(to right, transparent, rgba(180,255,247,0.5), transparent)";
const HOUSING_BG = "linear-gradient(180deg,#2b3a3f,#0d1618)";
const HOUSING_SHADOW =
  "inset 0 1px 0 rgba(255,255,255,0.3), inset 0 -2px 4px rgba(0,0,0,0.85), 0 8px 18px -8px #000, 0 40px 70px -44px #000, 0 0 26px -10px rgba(0,255,229,0.35)";
const LEDGE_BG = "linear-gradient(180deg,#43555b 0%,#2a3b40 58%,#202c31 100%)";
const LEDGE_SHADOW =
  "inset 0 1px 0 rgba(255,255,255,0.32), 0 1px 0 rgba(0,0,0,0.65)";
const READOUT_BG = "linear-gradient(180deg,#04100f,#061816)";
const GLASS_SHADOW =
  "inset 0 6px 18px rgba(0,0,0,0.85), inset 0 0 0 1px rgba(0,0,0,0.6)";
const PLATE_BG = "linear-gradient(180deg,#0a1114 0%,#101d21 55%,#0b1316 100%)";
const PLATE_SHADOW =
  "inset 0 3px 8px rgba(0,0,0,0.95), inset 0 -1px 0 rgba(255,255,255,0.1), inset 0 0 30px rgba(0,255,229,0.06), 0 1px 0 rgba(255,255,255,0.07)";
const BEZEL_BG = "linear-gradient(180deg,#2b3a3f,#0d1618)";
const KEY_BG = "linear-gradient(180deg,#2a383e,#111b1e)";
const KEY_SHADOW =
  "inset 0 1px 0 rgba(255,255,255,0.28), 0 3px 0 rgba(0,0,0,0.7), 0 7px 14px -7px #000";

/**
 * The scanlines, spelled the long way.
 *
 * The design's own value is `rgba(0,255,229,0.07) 0 1px, transparent 1px 3px`,
 * which is the same gradient and which Satori renders as a flat wash. Nothing
 * about the shorthand is wrong; it simply is not implemented for an
 * axis-aligned repeat, and the failure is invisible — the overlay is in the
 * tree and the glass is plain.
 */
const SCANLINES =
  "repeating-linear-gradient(to bottom, rgba(0,255,229,0.07) 0px, rgba(0,255,229,0.07) 1px, rgba(0,0,0,0) 1px, rgba(0,0,0,0) 3px)";

/** The relief half of the hero's engraving: the white lip and the dark steps. */
const HERO_RELIEF =
  "0 -2px 0 rgba(255,255,255,0.3), 0 3px 0 rgba(0,0,0,0.92), 0 6px 0 rgba(0,0,0,0.8), 0 9px 3px rgba(0,0,0,0.62), 0 12px 18px rgba(0,0,0,0.5)";

/**
 * The ambient half, drawn on a copy *behind* the relief.
 *
 * In the design these are the last entry of one `text-shadow` list, which a
 * browser paints beneath everything before it. Satori does not, so the two
 * halves are two elements — which is the same shape the wordmark's own
 * extrusion-and-face pair has, one plane up.
 */
const HERO_GLOW = `0 0 60px ${ACCENT_GLOW}`;

/** The glass the hero has to fit inside, and the line box it stacks in. */
const GLASS_HEIGHT = 202;
const HERO_LINE_HEIGHT = 1.06;

/**
 * Geist SemiBold's average advance for a league name, in ems.
 *
 * Measured from the shipped subset rather than guessed: A–Z average 0.680em,
 * weighted by English letter frequency 0.661em, and with a space every sixth
 * character 0.590em — plus the design's own 0.02em of letter spacing.
 */
const HERO_ADVANCE = 0.61;

/**
 * The sizes the hero will take, largest first. 82px is the design's.
 */
const HERO_SIZES = [82, 68, 56, 46, 38, 32];

/**
 * The hero's type size: the largest at which the name is estimated to fit the
 * glass.
 *
 * **The design draws one size against a name that happens to fit.** A league
 * name is user data and Sleeper bounds it loosely, so at 82px anything past
 * about thirty characters needs a third line and the glass has room for two.
 * Overflowing is not an option worth taking: the glass is `overflow: hidden`,
 * so a long name would be silently guillotined top and bottom — which a render
 * showed, and which reads as a design decision rather than a fault.
 *
 * **It is an estimate, because Satori offers no way to measure text.** The
 * count is characters against {@link HERO_ADVANCE}, discounted a tenth for the
 * width a line loses to wrapping at word boundaries. Getting it slightly wrong
 * costs a step of type size; the alternative — a fixed size — costs the name.
 *
 * Truncation is deliberately not the answer, and not available either:
 * `lineClamp` and `textOverflow` are both unimplemented in Satori, so a card
 * that overran would simply lose the text with no ellipsis to admit it.
 */
function heroFontSize(name: string): number {
  const usable = HERO_MAX_WIDTH * 0.9;
  for (const size of HERO_SIZES) {
    const perLine = Math.max(1, Math.floor(usable / (size * HERO_ADVANCE)));
    const lines = Math.ceil(name.length / perLine);
    if (lines * size * HERO_LINE_HEIGHT <= GLASS_HEIGHT) return size;
  }
  return HERO_SIZES[HERO_SIZES.length - 1];
}

/** The ground every card stands on: the panel, its grain, and the top specular. */
function Ground({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        position: "relative",
        display: "flex",
        width: OG_SIZE.width,
        height: OG_SIZE.height,
        background: PANEL_BG,
      }}
    >
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: PANEL_GRAIN,
        }}
      />
      {/* `left: 8%` of 1200, resolved here: Satori takes the number. */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 96,
          right: 96,
          height: 1,
          background: PANEL_SPECULAR,
        }}
      />
      {children}
    </div>
  );
}

/**
 * The flask, verbatim from `features/tools/components/flask-mark.tsx` — the
 * same three paths, with that component's Tailwind classes resolved to the
 * literals they compile to.
 */
function Flask({ size }: { size: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path
        d="M10.2 3v5.4L4.9 19.1a1.1 1.1 0 0 0 1 1.6h12.2a1.1 1.1 0 0 0 1-1.6L13.8 8.4V3"
        fill="rgba(0,255,229,0.10)"
        stroke={ACCENT}
        strokeWidth={1.4}
      />
      <path
        d="M7.3 14.8h9.4l2.8 5.4a1 1 0 0 1-1 .5H5.5a1 1 0 0 1-1-.5z"
        fill="rgba(0,255,229,0.45)"
      />
      <path d="M9.2 3h5.6" stroke={ACCENT} strokeWidth={1.4} />
    </svg>
  );
}

/**
 * The engraved wordmark plate: flask on a raised bezel, a milled groove, then
 * the type.
 *
 * Everything but the type is drawn here. The type is an image, and the two
 * numbers that matter are its bleed and the box it reserves — see
 * `WORDMARK_34`. Drawing the image at its own size without reserving the
 * smaller box would push the plate's right edge 12px out and its type 12px
 * down.
 */
function WordmarkPlate({
  art,
  bezel,
  flask,
  gap,
  pad,
  padRight,
  radius,
  halo,
}: {
  art: typeof WORDMARK_34;
  bezel: number;
  flask: number;
  gap: number;
  pad: number;
  padRight: number;
  radius: number;
  halo: number;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap,
        borderRadius: radius,
        border: "1px solid rgba(237,237,237,0.08)",
        background: PLATE_BG,
        boxShadow: PLATE_SHADOW,
        padding: `${pad}px ${padRight}px ${pad}px ${pad}px`,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: bezel,
          height: bezel,
          borderRadius: 999,
          border: "1px solid rgba(237,237,237,0.10)",
          background: BEZEL_BG,
          boxShadow: `inset 0 1px 0 rgba(255,255,255,0.3), inset 0 -2px 4px rgba(0,0,0,0.85), 0 0 ${Math.round(
            (20 * bezel) / 42,
          )}px -${Math.round((4 * bezel) / 42)}px rgba(0,255,229,0.4)`,
        }}
      >
        <Flask size={flask} />
      </div>
      {/* The groove: a dark hairline with a light one on its far edge, which is
          what makes it read as milled rather than drawn. */}
      <div
        style={{
          display: "flex",
          width: 1,
          alignSelf: "stretch",
          margin: `${Math.round(bezel / 21)}px 0`,
          background:
            "linear-gradient(to bottom, transparent, rgba(0,0,0,0.9), transparent)",
          boxShadow: "1px 0 0 rgba(255,255,255,0.07)",
        }}
      />
      <div
        style={{
          position: "relative",
          display: "flex",
          width: art.box.width,
          height: art.box.height,
        }}
      >
        {/* The teal halo the baked type leaves out. It is a wide, smooth,
            low-alpha field — the one thing in the wordmark that bands under
            PNG quantisation and the one thing Satori draws well, so it is
            drawn rather than baked. */}
        <div
          style={{
            position: "absolute",
            left: -halo,
            top: -halo,
            right: -halo,
            bottom: -halo,
            background: `radial-gradient(50% 50% at 50% 50%, rgba(0,255,229,0.22) 0%, rgba(0,255,229,0.07) 55%, rgba(0,255,229,0) 100%)`,
          }}
        />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={art.src}
          alt=""
          width={art.width}
          height={art.height}
          style={{
            position: "absolute",
            left: -art.bleed,
            top: -art.bleed,
          }}
        />
      </div>
    </div>
  );
}

/**
 * The league's mark on the glass: its avatar in a lit ring, or its initial.
 *
 * **The inward glow is the design's own `inset 0 0 32px`, on a child that the
 * circle clips.** Satori does render an inset shadow — but it does not clip it
 * to the border radius, so written on the circle itself it paints a lit
 * *square* standing out around it. Moved to a child of a circle that is
 * `overflow: hidden`, the clip makes it round and the literal survives intact.
 *
 * The handoff's own substitution — a radial gradient — is not available:
 * Satori renders a radial whose alpha *increases* outward as a flat fill of
 * the last stop, so a transparent-centre-to-teal-edge ring comes out a solid
 * teal disc. (A radial that fades outward is fine, which is how the wordmark's
 * halo is drawn.)
 *
 * A league with no avatar on file — or one whose avatar could not be fetched
 * in time — falls back to its initial drawn **lit**, in readout mint with the
 * readout's glow, which is `LeagueMark`'s documented rule: an unlit letter
 * inside a lit ring reads as a failed image rather than as an absent one.
 */
function LeagueMark({ name, avatar }: { name: string; avatar: string | null }) {
  return (
    <div
      style={{
        position: "relative",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: 112,
        height: 112,
        flexShrink: 0,
        borderRadius: 999,
        overflow: "hidden",
        border: "1px solid rgba(0,255,229,0.35)",
        boxShadow: `0 0 26px -6px ${ACCENT_GLOW}`,
      }}
    >
      {avatar ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={avatar}
          alt=""
          width={112}
          height={112}
          style={{ position: "absolute", left: 0, top: 0 }}
        />
      ) : null}
      {/* The ring's own light, over whatever is behind it — which is what the
          app's `LeagueMark` does at 24px, and why a real avatar is lit at its
          edges rather than sitting in a flat hole. */}
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          right: 0,
          bottom: 0,
          boxShadow: "inset 0 0 32px rgba(0,255,229,0.35)",
        }}
      />
      {avatar ? null : (
        <div
          style={{
            display: "flex",
            fontFamily: MONO,
            fontSize: 52,
            color: READOUT_TEXT,
            textShadow: `0 0 14px rgba(0,255,229,0.75)`,
          }}
        >
          {name.charAt(0).toUpperCase()}
        </div>
      )}
    </div>
  );
}

/**
 * The card for a tracked draft: the league, named, and the shape of the draft
 * it is running.
 */
export function PicktrackerOgCard({
  card,
  avatar,
}: {
  card: PicktrackerCardPayload;
  avatar: string | null;
}) {
  const name = card.league.name;
  const fontSize = heroFontSize(name);
  const hero = {
    fontFamily: DISPLAY,
    fontSize,
    fontWeight: 600,
    lineHeight: HERO_LINE_HEIGHT,
    textTransform: "uppercase" as const,
    letterSpacing: "0.02em",
    color: "#d6fffa",
    /**
     * A name with no space in it long enough to outrun the glass would
     * otherwise run off the side and be clipped — the size ladder cannot help,
     * because there is nowhere to wrap. `break-word` breaks only the word that
     * does not fit, where `break-all` would also split "LEAGUE" across two
     * lines for no reason; `overflow-wrap: anywhere` is the modern spelling
     * and Satori does not implement it.
     */
    wordBreak: "break-word" as const,
  };

  return (
    <Ground>
      <div
        style={{
          position: "absolute",
          top: 96,
          left: 76,
          right: 76,
          height: 462,
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: 34,
          borderRadius: 24,
          border: "1px solid rgba(237,237,237,0.10)",
          background: HOUSING_BG,
          boxShadow: HOUSING_SHADOW,
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            borderRadius: 15,
            overflow: "hidden",
            boxShadow: "0 1px 0 rgba(255,255,255,0.09)",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "12px 22px",
              background: LEDGE_BG,
              boxShadow: LEDGE_SHADOW,
            }}
          >
            <div
              style={{
                display: "flex",
                fontFamily: MONO,
                fontSize: 16,
                textTransform: "uppercase",
                letterSpacing: "0.2em",
                color: INK,
              }}
            >
              Rookie pick tracker
            </div>
            <div
              style={{
                display: "flex",
                fontFamily: MONO,
                fontSize: 16,
                textTransform: "uppercase",
                letterSpacing: "0.2em",
                color: READOUT_TEXT,
              }}
            >
              {`${card.season} draft · ${card.teams} teams · ${card.rounds} ${
                card.rounds === 1 ? "round" : "rounds"
              }`}
            </div>
          </div>

          <div
            style={{
              position: "relative",
              display: "flex",
              height: 202,
              alignItems: "center",
              justifyContent: "center",
              gap: 34,
              padding: "0 40px",
              overflow: "hidden",
              background: READOUT_BG,
              boxShadow: GLASS_SHADOW,
            }}
          >
            <div
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                background: SCANLINES,
              }}
            />
            <LeagueMark name={name} avatar={avatar} />
            {/* Two copies of one string: the glow behind, the relief in front.
                The back copy is stretched to the front copy's box with
                `right: 0`, so the two wrap identically — a ghost line breaking
                somewhere else is the failure this guards against. */}
            <div
              style={{
                position: "relative",
                display: "flex",
                maxWidth: HERO_MAX_WIDTH,
              }}
            >
              <div
                style={{
                  ...hero,
                  position: "absolute",
                  left: 0,
                  top: 0,
                  right: 0,
                  textShadow: HERO_GLOW,
                }}
              >
                {name}
              </div>
              <div style={{ ...hero, display: "flex", textShadow: HERO_RELIEF }}>
                {name}
              </div>
            </div>
          </div>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginTop: 26,
          }}
        >
          <WordmarkPlate
            art={WORDMARK_34}
            bezel={42}
            flask={26}
            gap={16}
            pad={9}
            padRight={20}
            radius={12}
            halo={22}
          />
          {/* The one thing about this tool a recipient cannot guess, which is
              why it earns the space opposite the wordmark. */}
          <div
            style={{
              display: "flex",
              fontFamily: MONO,
              fontSize: 18,
              textTransform: "uppercase",
              letterSpacing: "0.16em",
              color: "rgba(237,237,237,0.5)",
            }}
          >
            Nth kicker off the board = rookie pick N
          </div>
        </div>
      </div>
    </Ground>
  );
}

/**
 * The identity card: the app, with no league to name.
 *
 * It is the home route's own unfurl **and** every failure arm of the
 * picktracker card — an unknown league, a Sleeper that cannot be reached, a
 * league with no placeholder draft. The league name is omitted rather than
 * guessed, which is the whole reason there is a second card at all.
 */
export function IdentityOgCard() {
  return (
    <Ground>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          width: "100%",
          height: "100%",
          gap: 34,
        }}
      >
        <WordmarkPlate
          art={WORDMARK_96}
          bezel={104}
          flask={64}
          gap={40}
          pad={22}
          padRight={50}
          radius={30}
          halo={56}
        />
        <div
          style={{
            display: "flex",
            fontFamily: MONO,
            fontSize: 24,
            textTransform: "uppercase",
            letterSpacing: "0.24em",
            color: "rgba(237,237,237,0.62)",
          }}
        >
          Fantasy football tools for Sleeper leagues
        </div>
        <div
          style={{
            display: "flex",
            width: 420,
            height: 1,
            background: `linear-gradient(to right, rgba(0,255,229,0), ${ACCENT_GLOW}, rgba(0,255,229,0))`,
          }}
        />
        {/* Taken from the registry rather than written out, so a sixth tool
            joins the card by joining `constants/tools.ts`. */}
        <div style={{ display: "flex", gap: 14 }}>
          {tools.map((tool) => (
            <div
              key={tool.href}
              style={{
                display: "flex",
                borderRadius: 999,
                border: "1px solid rgba(237,237,237,0.10)",
                background: KEY_BG,
                boxShadow: KEY_SHADOW,
                padding: "13px 26px",
                fontFamily: MONO,
                fontSize: 22,
                textTransform: "uppercase",
                letterSpacing: "0.16em",
                color: INK,
              }}
            >
              {tool.text}
            </div>
          ))}
        </div>
      </div>
    </Ground>
  );
}
