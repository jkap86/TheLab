/**
 * The type a focusable control is set in, so iOS Safari leaves the page alone.
 *
 * **The bug this exists to kill.** Focus a field whose computed `font-size` is
 * under 16px and mobile Safari zooms the page in to meet it — and does not zoom
 * back out. Tapping a filter chip, a search box or a date lens left the reader
 * in a magnified page scrolled sideways, pinching their way back before the next
 * press. The cure used to be `maximumScale: 1` in the root viewport, which asks
 * the browser not to scale at all; that is a fix aimed at the *symptom*, and it
 * costs every reader on Chrome for Android their pinch-zoom (that engine honours
 * the cap where iOS ignores it for a deliberate gesture) on a page written in
 * 10px readouts. What is here instead is the cause: **every control that can
 * take focus is set at 16px**, and the viewport declines to cap anything.
 *
 * **Why this is a module and not eight edits.** The floor is a platform rule
 * rather than a design choice, so it has one spelling; a control that reaches
 * for `text-xs` because the row is tight is exactly the control that will
 * reintroduce the zoom, and the way to make that visible is for the alternative
 * to be a named token. `control-type.test.ts` reads every `<input>`, `<select>`
 * and `<textarea>` in the tree back and fails on one set below the floor, so a
 * new field is caught at the point it is written rather than on somebody's
 * phone.
 *
 * **The size goes up and the box does not.** That is the whole trick, and it is
 * `leading-5` doing it: a field's height is its line box plus its padding, and
 * 13px text at the browser's `normal` line-height comes out within half a pixel
 * of 16px text at a pinned 20px one. Measured, in Chromium at DPR 2, against the
 * markup as it actually ships:
 *
 * | control | before | after |
 * | --- | --- | --- |
 * | search field (three of them) | 33.5px | 34px |
 * | ADP filter tray, 390px screen | 66px, 2 rows | 64px, 2 rows |
 * | ADP filter tray, 360px screen | 66px, 2 rows | 64px, 2 rows |
 * | a rule row | 43.5px | 44px |
 * | the seek key's date field | 30px | 30px |
 * | the window lenses | 1 row @454, 2 @332, 2 @302 | unchanged |
 *
 * Only two of them needed anything beyond the type. The ADP chip gave back the
 * width its wider text took ({@link compactSelect}) — it is the one control on a
 * *wrapping* row, where wider text is paid in rows rather than in width. And the
 * window's date lens gave back the native control's own internal chrome
 * (`.date-field-tight` in `globals.css`), which is worth ~40px it was spending
 * on padding nobody asked for. Everything else kept the padding it was drawn
 * with, and no control lost a touch target.
 *
 * **What is deliberately *not* here is anything that asks the device who it
 * is.** A `@media (pointer: coarse)` floor would leave the desktop design at the
 * exact pixel it is today, and it is the wrong trade: the failure mode of a
 * device query is a phone that reports the other thing, and that failure is
 * invisible from here — it surfaces as the zoom bug coming back for somebody
 * whose hardware nobody tested on. A floor that always holds cannot miss.
 */

/**
 * The size at and above which iOS Safari stops zooming a focused field.
 *
 * Spelled in pixels rather than `text-base`, which is `1rem` and therefore a
 * promise about the *root* — true today (`globals.css` pins `:root` to 16px) and
 * not a thing this rule should depend on, since the platform's threshold is an
 * absolute 16 CSS pixels whatever the document is set in.
 */
export const IOS_NO_ZOOM_PX = 16;

/**
 * A text-entry field at the floor, in the box it already had.
 *
 * `leading-5` is load-bearing rather than tidy — see the table above. Reach for
 * this where the field's width is a share of its row (a search box, a value
 * field with a fixed width), which is most of them: nothing about the layout
 * moves, the glyphs are simply bigger.
 */
export const mobileInputText = "text-[1rem] leading-5";

/** {@link mobileInputText} for a `<select>`, which zooms on the same rule. */
export const mobileSelectText = "text-[1rem] leading-5";

/**
 * A field that has to give something back for the type — the floor plus the
 * vertical padding that lands it on the height it was drawn at.
 *
 * The half-step off `py-1.5` is what keeps a 30px date field 30px; use it where
 * the box is *stated* (a panel's own field) rather than where it is a share of
 * a row.
 */
export const compactInput = `${mobileInputText} py-1`;

/**
 * A pill `<select>` at the floor, tightened horizontally to hold its row.
 *
 * The ADP drawer's filter tray is the case this is measured against: five chips
 * wrapping inside a pinned block that has to leave the board room, where 16px
 * text is ~14% more width per chip. `px-1.5` against the `px-2.5` it replaces
 * gives back 8px a chip — enough that the tray stays two rows at 390px *and* at
 * 360px, where `px-2` already spills to three. `py-0.5` holds the pill's height
 * within a pixel.
 *
 * It is the one place a padding was tightened rather than left alone, and the
 * reason is that a wrapping row is the one shape where wider text does not cost
 * width, it costs *height* — a row at a time.
 */
export const compactSelect = `${mobileSelectText} px-1.5 py-0.5`;

/**
 * The search field the subject rail, the shares sheet and the trades search
 * panel all draw.
 *
 * Three copies of one string is the drift a shared token exists to stop, and
 * this one had already been copied twice before it had a reason to change. The
 * *box* around it stays at each call site: they differ (`shrink-0` on two of
 * them, an ordering class on the third), and what is genuinely one thing is the
 * field.
 */
export const SEARCH_FIELD =
  `min-w-0 flex-1 bg-transparent ${mobileInputText} text-foreground outline-none placeholder:text-foreground/30`;
