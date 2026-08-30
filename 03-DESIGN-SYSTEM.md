---
kind: design system
intent: "Apple / iOS visual language, expressed as tokens rather than as a mood"
created: "2026-08-27"
revised: "2026-08-30 — §2 gains the rise-and-fall rule: one accent holds, grey carries the fall"
verified_by: "npm run design — fails the build if this document and global.css disagree"
---

# 03 · DESIGN SYSTEM

## 0 · 🚚 Porting this to another repository

This document is written to be handed to a **different codebase** that already
has its layout and needs the styling brought into line. Everything below is
framework-agnostic: it is CSS custom properties and rules, not Astro, not
Tailwind, not a component library.

### 0.1 🔴 Do these four in order

| # | Do | Why this order |
| - | -- | -------------- |
| 1 | Paste §0.2 in as the **first** stylesheet, before any existing CSS | Cascade layers put it under everything, so nothing you already have breaks on contact |
| 2 | Delete every hard-coded colour, radius, shadow, duration and px spacing in the existing styles, replacing each with the nearest token | ⚠️ The tokens do nothing while a component still hard-codes `#333` |
| 3 | Apply §1's seven traits and both anti-rules to the existing layout | This is where it starts looking like the same family. Layout stays, treatment changes |
| 4 | Check against §0.4 | Most "it still doesn't look right" is one of those six lines |

⚠️ **Do not port the layout.** This site's page compositions are hand-authored
per page and are the wrong thing to copy — §1 and §2–§6 are what makes the look,
not the arrangement.

### 0.2 The complete token block — copy verbatim

```css
@layer reset, tokens, base, layout, overrides;

@layer tokens {
  :root {
    color-scheme: light dark;

    /* surfaces — the plain value is the fallback, light-dark() wins where supported */
    --bg:          #fbfbfd;  --bg:          light-dark(#fbfbfd, #000000);
    --bg-sunken:   #f5f5f7;  --bg-sunken:   light-dark(#f5f5f7, #0a0a0c);
    --bg-elevated: #ffffff;  --bg-elevated: light-dark(#ffffff, #1c1c1e);
    --bg-glass:    rgb(251 251 253 / .72);
    --bg-glass:    light-dark(rgb(251 251 253 / .72), rgb(0 0 0 / .72));

    /* ink */
    --text:   #1d1d1f;  --text:   light-dark(#1d1d1f, #f5f5f7);
    --text-2: #515154;  --text-2: light-dark(#515154, #a1a1a6);
    --text-3: #6e6e73;  --text-3: light-dark(#6e6e73, #86868b);

    /* lines */
    --hairline:      rgb(0 0 0 / .10);
    --hairline:      light-dark(rgb(0 0 0 / .10), rgb(255 255 255 / .13));
    --hairline-soft: rgb(0 0 0 / .06);
    --hairline-soft: light-dark(rgb(0 0 0 / .06), rgb(255 255 255 / .08));

    /* 🔴 the ONE accent. In dark it is vivid, so filled controls take DARK ink:
       white on #4dff9b is 1.3:1 and unreadable; #04140b is 14.5:1. */
    --accent:      #03744e;  --accent:     light-dark(#03744e, #4dff9b);
    --accent-ink:  #ffffff;  --accent-ink: light-dark(#ffffff, #04140b);
    --accent-wash: color-mix(in oklab, var(--accent) 12%, transparent);
    --focus: var(--accent);

    /* type — ⛔ no web font, on purpose. §3.1 */
    --font-sans: -apple-system, BlinkMacSystemFont, "Segoe UI Variable Display",
                 "Segoe UI", Roboto, system-ui, sans-serif;
    --font-mono: ui-monospace, "SF Mono", "Cascadia Mono", "JetBrains Mono",
                 Menlo, Consolas, monospace;

    --fs-h1:   clamp(2rem,    1.45rem + 2.6vw, 3.25rem);
    --fs-h2:   clamp(1.5rem,  1.25rem + 1.2vw, 2.25rem);
    --fs-h3:   clamp(1.25rem, 1.15rem + 0.5vw, 1.5rem);
    --fs-lead: clamp(1.125rem,1.02rem + 0.5vw, 1.375rem);
    --fs-stat: clamp(1.25rem, 0.95rem + 1.5vw, 1.9375rem);
    --fs-body: 1.0625rem;
    --fs-sm:   0.9375rem;
    --fs-xs:   0.8125rem;

    /* space — 4 px base, ⛔ never a magic number */
    --s-1: 4px;  --s-2: 8px;  --s-3: 12px; --s-4: 16px; --s-5: 20px;
    --s-6: 24px; --s-8: 32px; --s-10: 40px; --s-12: 48px; --s-16: 64px;
    --s-20: 80px; --s-24: 96px; --s-32: 128px;

    --container:       1120px;
    --container-prose: 720px;
    --container-mid:   940px;
    --container-wide:  1320px;
    --gutter: clamp(20px, 5vw, 40px);
    --section-y: clamp(72px, 9vw, 128px);
    --nav-h: 56px;

    /* radii — ⛔ nothing on this site has a 4 px corner */
    --r-chip: 980px; --r-sm: 10px; --r-md: 16px; --r-lg: 20px; --r-xl: 28px;

    /* elevation */
    --sh-sm: 0 1px 2px rgb(0 0 0 / .04), 0 1px 1px rgb(0 0 0 / .03);
    --sh-md: 0 4px 16px rgb(0 0 0 / .06);
    --sh-lg: 0 16px 48px rgb(0 0 0 / .10);

    /* motion — decelerating only */
    --ease: cubic-bezier(.22, 1, .36, 1);
    --ease-in: cubic-bezier(.4, 0, 1, 1);
    --dur-fast: 150ms; --dur: 260ms; --dur-slow: 420ms;
  }

  /* the theme control drives color-scheme; every light-dark() token follows */
  :root[data-theme="light"] { color-scheme: light; }
  :root[data-theme="dark"]  { color-scheme: dark; }

  @media (min-width: 900px) { :root { --nav-h: 64px; } }

  /* 🔴 dark: depth comes from elevated surfaces and hairlines, NEVER shadow */
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) { --sh-sm: none; --sh-md: none; --sh-lg: none; }
  }
  :root[data-theme="dark"] { --sh-sm: none; --sh-md: none; --sh-lg: none; }
}
```

### 0.3 The cascade-layer contract

```css
@layer reset, tokens, base, layout, overrides;
```

Declared once, first, before anything. Order is the whole point: an unlayered
stylesheet always beats a layered one, so a host repo's existing CSS keeps
winning until it is migrated — the port can be done a component at a time
instead of in one break-everything commit.

| Layer | Holds |
| ----- | ----- |
| `reset` | Minimal modern reset, `box-sizing`, media defaults |
| `tokens` | §0.2, and nothing else ever |
| `base` | Element defaults, type, focus ring, selection |
| `layout` | Containers, buttons, chips, utilities |
| `overrides` | `:lang(zh)`, `prefers-reduced-motion`, view transitions, print |

⚠️ **Components must not add to the `tokens` layer.** §7.2 lists the four
component-scoped tokens that exist and the rule for when a fifth would be
allowed.

### 0.4 🔴 The six lines that decide whether it looks right

Most of the resemblance comes from these, not from the palette. If the port
looks "close but off", check them in order:

1. **`letter-spacing: -0.026em` on h1, `-0.021em` on h2.** Tight tracking on
   large type is the single most Apple-looking move there is. ⛔ Default
   tracking on a 52 px heading will look wrong no matter what else is right.
2. **`font-weight: 660 / 620 / 600`** on h1/h2/h3 — ⛔ not 700 everywhere.
3. **`border-radius: 980px` on every button and chip.** Pills, not rounded
   rectangles.
4. **`min-height: 44px` on every interactive element**, including ones that
   look smaller. Apple HIG, and it is also what makes the UI feel unhurried.
5. **Separation by hairline, never by shadow.** `1px solid var(--hairline)`.
   ⛔ If deleting every `box-shadow` breaks the layout, the layout is wrong.
6. **`--section-y: clamp(72px, 9vw, 128px)` between sections.** Air is the
   primary layout tool here; most ports under-space by roughly half.

### 0.5 ⛔ What not to bring across

| ⛔ | Why |
| -- | --- |
| A second accent colour | §2. One accent. Tags are `--text-3` on `--bg-sunken`, and a palette of tag colours is the fastest way to look like a bootcamp project |
| A web font | §3.1. Zero bytes, CLS of 0, and it is the only choice that survives a CJK edition |
| Decorative gradients, glows, glass cards over photos | §1 anti-rules. Reads as 2021 SaaS, not as engineering |
| Tailwind, a preprocessor, a component library | §11. Modern CSS directly; the tokens are the abstraction |
| This site's page layouts | §0.1. Copy the treatment, keep your own arrangement |

### 0.6 Staying in sync

`npm run design` compares this document against `src/styles/global.css` and
`src/**/*.astro` in **both** directions and exits non-zero on a disagreement —
tokens the CSS has and this file forgot, and tokens this file declares that no
stylesheet defines. The second is the dangerous one: an undefined custom
property makes CSS drop the whole declaration silently, so a phantom token in a
ported file produces no error and no style. ⚠️ `--fs-display` was exactly that
until 2026-08-29.

---

## 1 · What "feels like Apple" actually means

"iOS feel" is not a colour and not a font. It is seven measurable habits. Each
one below is a rule the build can be checked against.

| # | Trait | The rule |
| - | ----- | -------- |
| 1 | **Materials, not panels** | Surfaces that overlay content are translucent and blurred (`backdrop-filter: saturate(180%) blur(20px)`), separated by a **hairline**, never by a drop shadow. The header is the only permanently translucent element |
| 2 | **Continuous, generous radii** | 20 px on cards, 28 px on large panels, `980px` on every button and chip. Nothing on this site has a 4 px corner |
| 3 | **Tight, large, quiet type** | Display type is big and set at −0.03em tracking. Body type is 17 px, the iOS body size. There is one accent colour and no coloured headings |
| 4 | **Air as the primary layout tool** | Section rhythm is `clamp(72px, 9vw, 128px)`. Whitespace does the work that borders and boxes do on a normal portfolio |
| 5 | **Pill controls, 44 px minimum** | Every button is a pill. Every touch target is at least 44 × 44 px, per Apple HIG, including the ones that look smaller |
| 6 | **Motion that decelerates** | `cubic-bezier(.22, 1, .36, 1)`, 200–420 ms, opacity and small translate only. Nothing bounces, nothing spins, nothing waits for the user |
| 7 | **Light and dark are both first-class** | Dark is true black `#000` with `#1c1c1e` elevated surfaces — the iOS OLED palette, not a grey inversion |

And two anti-rules, because they are what separates a premium page from a
template:

* ⛔ **No decorative gradient, no glow, no glass card floating over a blurred
  photograph.** Those read as 2021 SaaS, not as engineering.
* ⛔ **No shadow does structural work.** If removing every `box-shadow` breaks
  the layout, the layout is wrong.

---

## 2 · Colour

Defined once, as tokens, using `light-dark()` so a single declaration covers
both schemes. `color-scheme` on `:root` also gives native form controls,
scrollbars and the iOS status bar the right treatment for free.

```css
:root {
  color-scheme: light dark;

  /* ---- surfaces ---- */
  --bg:            light-dark(#fbfbfd, #000000);
  --bg-sunken:     light-dark(#f5f5f7, #0a0a0c);
  --bg-elevated:   light-dark(#ffffff, #1c1c1e);
  --bg-glass:      light-dark(rgb(251 251 253 / .72), rgb(0 0 0 / .72));

  /* ---- ink ---- */
  --text:          light-dark(#1d1d1f, #f5f5f7);
  --text-2:        light-dark(#515154, #a1a1a6);
  --text-3:        light-dark(#6e6e73, #86868b);

  /* ---- lines ---- */
  --hairline:      light-dark(rgb(0 0 0 / .10), rgb(255 255 255 / .13));
  --hairline-soft: light-dark(rgb(0 0 0 / .06), rgb(255 255 255 / .08));

  /* ---- the one accent: green ---- */
  --accent:        light-dark(#03744e, #4dff9b);
  --accent-ink:    light-dark(#ffffff, #04140b);
  --accent-wash:   color-mix(in oklab, var(--accent) 12%, transparent);

  /* ---- focus ---- */
  --focus:         var(--accent);
}
```

✅ **Green, not blue — locked 2026-08-27**, after seeing four candidates against
true black. Blue is the default accent of every framework and every developer
portfolio; green on `#000` is more distinctive and reads warmer without reading
playful.

| | Value | On `--bg` | On `--bg-sunken` | Ink on a filled control |
| --- | --- | --- | --- | --- |
| Light | `#03744e` | 5.63 | 5.34 | `#ffffff` — 5.81 |
| Dark | `#4dff9b` | 16.09 | 15.16 | `#04140b` — 14.50 |

Deliberately asymmetric: a deep green carries a link on white, and a vivid green
carries a filled control on black. Every figure above clears WCAG AA (4.5).

🔴 **The dark-mode ink rule.** In dark the accent is vivid, so a filled control
takes **dark ink** (`#04140b`), not white. White on `#4dff9b` is **1.3:1** and
literally unreadable; dark ink clears it at 14.5:1. This is also how iOS treats
a vibrant fill, so contrast and visual language give the same answer.

**There is no second accent colour.** Capability tags, case tags and status
chips are all rendered in `--text-3` on `--bg-sunken`. A palette of six tag
colours is the fastest way to make a senior engineer's site look like a
bootcamp project.

⚖️ **A rise-and-fall chart still takes one accent — settled 2026-08-30.** This
was briefly an exception: the activity card was allowed a red counterpart to
the accent, on the argument that up and down have to be opposites or the chart
states nothing. Both halves of that argument turned out to be wrong, and the
exception was retired the same day it was written.

| | Red | Grey |
| --- | --- | --- |
| Against the accent, light | **1.15:1** | **3.45:1** |
| Against the accent, dark | **1.95:1** | **8.02:1** |

🔴 Red never did the work. Red and green sit at almost the same luminance, so
to a red-green colour-blind reader — roughly one man in twelve — the two bars
were the same grey and the chart conveyed nothing. The colour that was supposed
to be load-bearing was carrying nothing at all.

⛔ And on a profile page red **shouts**. It reads as an error state rather than
as a quieter week, and it pulled the eye to exactly the weeks least worth
looking at.

So: a week that grew is solid `--accent`, a week that fell back is grey. Grey
is recessive by nature, which is the correct relationship — growth leads, a
pullback recedes — and it separates from the accent for everyone. The pairing
is asymmetric for the same reason the accent is:

```js
// scripts/generate-cards.mjs — the light accent is deep, so its grey is light;
// the dark accent is vivid, so its grey is dark. `edge` exists because a
// recessive fill still has to read as a bar: 1.68:1 against the surface is not
// enough on its own, and the stroke is what draws the shape.
const QUIET = {
  light: { fill: '#c7c7cc', edge: '#a1a1a6' },
  dark:  { fill: '#3f3f44', edge: '#6e6e73' },
};
```

✅ Verified by rendering the card through a `grayscale(1)` filter: the series
must stay fully readable with no hue at all. Run that check on any chart whose
meaning lives in its colours.

📐 **And match the mark to the quantity.** The activity card was a candlestick
twice before it was a column chart, and both attempts failed the same way:
contributions are a *volume*, not a *price*. A price is a continuously quoted
level, so open/high/low/close are four real observations of one thing; a week’s
contributions is a flow — a single number. Forcing four out of it gave first an
artifact (a rolling window double-counting every spike) and then a lie (a
158-contribution week, the busiest of its quarter, drawn as the largest loss on
the card because it opened on a Sunday and closed on a quiet Saturday). A
column height cannot lie that way. Ask what the number *is* before choosing the
mark.

**Contrast, verified rather than assumed.** `--text` on `--bg` is 17.4:1 light
and 18.1:1 dark. `--text-3` on `--bg` is 4.8:1 light and 5.2:1 dark — above AA
for body text, and it is only ever used at 15 px or larger. `--accent` on `--bg`
is 6.4:1 light and 7.1:1 dark.

**`theme-color`**, so the iOS browser chrome matches the page:

```html
<meta name="theme-color" content="#fbfbfd" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#000000" media="(prefers-color-scheme: dark)">
```

### 2.1 Theme control

Three states — **Auto · Light · Dark** — as a segmented control in the header
overflow and in the mobile sheet. Auto is the default and is what an unvisited
reader gets. The choice is stored in `localStorage` and applied by a 400-byte
inline script placed **before** the stylesheet, so there is no flash of the
wrong theme. Wrapped in `try/catch`: a browser blocking storage must render the
Auto theme correctly, not throw.

---

## 3 · Typography

### 3.1 The stack — and why there is no web font

```css
--font-sans:
  -apple-system, BlinkMacSystemFont,       /* SF Pro — Apple devices, natively */
  "Segoe UI Variable Display", "Segoe UI", /* Windows 11 */
  Roboto,                                  /* Android */
  system-ui, sans-serif;

--font-mono:
  ui-monospace, "SF Mono", "Cascadia Mono", "JetBrains Mono", Menlo, monospace;
```

On an Apple device this is **actually SF Pro**, rendered by the OS — which is
the most authentic route to the requested feel, and it costs zero bytes. On
Windows 11 it is Segoe UI Variable, which is an excellent face. On Android,
Roboto.

The trade is real and worth stating: the site will not look byte-identical on
every platform. What it buys is a **0 ms font load, a CLS of exactly 0, no
`font-display` compromise, and no third-party request** — and it is the only
approach that stays consistent when the Chinese edition ships, because a web
CJK font is 5–10 MB and cannot be used regardless. Mixing a web font for
English with a system font for Chinese would make the two editions look like
two different sites.

If a distinctive face is wanted later, doc 08 question **B3** covers adding a
self-hosted Inter Display subset for headings only, at a cost of ~22 KB.

### 3.2 Scale

Fluid, `clamp()`-driven, no breakpoint jumps.

```css
--fs-h1:      clamp(2rem,    1.45rem + 2.6vw, 3.25rem);  /* 32 → 52 */
--fs-h2:      clamp(1.5rem,  1.25rem + 1.2vw, 2.25rem);  /* 24 → 36 */
--fs-h3:      clamp(1.25rem, 1.15rem + 0.5vw, 1.5rem);   /* 20 → 24 */
--fs-lead:    clamp(1.125rem,1.02rem + 0.5vw, 1.375rem); /* 18 → 22 */
--fs-stat:    clamp(1.25rem, 0.95rem + 1.5vw, 1.9375rem);/* 20 → 31 — figures */
--fs-body:    1.0625rem;                                 /* 17 — iOS body   */
--fs-sm:      0.9375rem;                                 /* 15 */
--fs-xs:      0.8125rem;                                 /* 13 — eyebrow    */
```

🔴 **There is no display token, and that is deliberate.** The hero title is the
only type on the site that must fit a *viewport*, not a column, so it is sized
inside the hero component and takes a height term the global scale cannot carry:

```css
/* the vw term keeps it to ONE line from 1024 px up — two lines at 68 px costs
   140 px of height; the svh term stops it dominating a short laptop */
font-size: clamp(2.5rem, min(0.6rem + 3.7vw, 8.4svh), 4.25rem);
```

⚠️ A `--fs-display` token was specified here and never existed in any
stylesheet. Copying it into another repo would have produced `font-size:` with
an undefined value, which CSS drops silently — the heading would simply inherit
and nothing would report an error. `npm run design` now fails on this class of
mistake in both directions.

### 3.3 Tracking and leading

Negative tracking on large type is the single most Apple-looking typographic
move there is, and it is also simply correct — large type needs less space.

| Role | Size | Weight | Tracking | Leading |
| ---- | ---- | ------ | -------- | ------- |
| Display (hero h1) | component-scoped clamp, ⛔ no token | 700 | −0.032em | 1.04 |
| h1 | `--fs-h1` | 660 | −0.026em | 1.08 |
| h2 | `--fs-h2` | 620 | −0.021em | 1.15 |
| h3 | `--fs-h3` | 600 | −0.014em | 1.3 |
| Lead paragraph | `--fs-lead` | 400 | −0.012em | 1.45 |
| Body | `--fs-body` | 400 | −0.006em | 1.6 |
| Eyebrow / label | `--fs-xs` | 600 | **+0.07em**, uppercase | 1.2 |
| Stat figure | `--fs-stat` | 700 | −0.03em, `tabular-nums` | 1.1 |

Also standard on every text block:

```css
h1, h2, h3 { text-wrap: balance; }
p          { text-wrap: pretty; }
.prose     { max-width: 68ch; hyphens: none; }
:root      { -webkit-text-size-adjust: 100%; text-size-adjust: 100%; }
body       { font-optical-sizing: auto; -webkit-font-smoothing: antialiased; }
```

`text-wrap: balance` on headings is what stops a two-word orphan on the second
line of a hero — the detail that makes a page look designed rather than
rendered.

---

## 4 · Space, grid and containers

A 4 px base, expressed as a named scale so spacing is never a magic number.

```css
--s-1: 4px;   --s-2: 8px;   --s-3: 12px;  --s-4: 16px;
--s-5: 20px;  --s-6: 24px;  --s-8: 32px;  --s-10: 40px;
--s-12: 48px; --s-16: 64px; --s-20: 80px; --s-24: 96px; --s-32: 128px;

--container:        1120px;   /* the standard page width          */
--container-mid:     940px;   /* narrower than standard, wider than prose */
--container-prose:  720px;    /* long-form reading (case, about)  */
--container-wide:   1320px;   /* full-bleed media only            */
--gutter:           clamp(20px, 5vw, 40px);

--section-y:        clamp(72px, 9vw, 128px);
--nav-h:            56px;     /* 64px at >=900px                  */
```

Every section is `padding-block: var(--section-y)` and every container is
`padding-inline: var(--gutter)` with `margin-inline: auto`. There is no grid
framework and no column classes — layout is done per component with CSS Grid.

### 4.0 🔴 The hero is measured in viewport HEIGHT, not in the section rhythm

The section rhythm exists to separate blocks that already have content above
them. Applied to the **first** section it does the opposite — it spends the top
of the viewport on nothing. At `--section-y` of 192 px plus a 64 px header, a
laptop loses 256 px before the eyebrow and the CTAs fall below the fold. That
fails the five-second test in doc 01 §1.

Centring the hero in a `min-height` box is **not** the fix on its own — that
only recentres content that is still too tall. The fix is that **every vertical
measurement inside the hero is capped by `svh` as well as by `vw`**, so the
hero fits by construction rather than by being tuned for one laptop.

```css
.hero-sec {
  --hstep: clamp(8px, 1.7svh, 20px);                                  /* gap unit */
  --fs-hero-lead: clamp(1.0625rem, min(1rem + .5vw, 2.9svh), 1.375rem);
  padding-block: clamp(16px, 2.6svh, 44px) clamp(32px, 5svh, 80px);
}
@media (min-width: 900px) {
  .hero-sec { display: grid; align-content: center;
              min-block-size: calc(100svh - var(--nav-h)); }
}
.hero__name  { font-size: clamp(2.5rem, min(.6rem + 3.7vw, 8.4svh), 4.25rem); }
.hero__lead  { margin-block-start: calc(var(--hstep) * 1.3); }
.hero__cta   { margin-block-start: calc(var(--hstep) * 1.6); }
/* …every hero margin is a multiple of --hstep */
```

Two details that carry most of the work:

* **The `min(vw, svh)` term on the name.** The `vw` half keeps it to one line
  from 1024 px up (two lines at 68 px costs 140 px of height); the `svh` half
  stops it dominating a short laptop.
* **The media is sized height-first** — `block-size: min(56svh, 520px)` with
  `inline-size: auto` and `aspect-ratio: 4/5` — so the portrait derives its
  width from a viewport-capped height and can never be the thing that pushes
  the CTAs down. Sizing it width-first is what makes a hero overflow on a 768 px
  laptop even after the padding has been fixed.

`svh` rather than `vh` throughout, so a mobile browser's collapsing URL bar
cannot make the hero taller than the visible viewport.

**Measured** (headless Chrome, `design/index.html`, hero content + header vs
viewport):

| Viewport | Hero needs | Fits |
| -------- | ---------: | ---- |
| 1366 × 640 | 588 px | ✓ +52 |
| 1280 × 720 | 619 px | ✓ +101 |
| 1440 × 780 | 643 px | ✓ +137 |
| 1920 × 900 | 670 px | ✓ +230 |

### 4.1 Breakpoints

Mobile-first, `min-width` only, five stops.

| Token | Width | What changes |
| ----- | ----- | ------------ |
| — | 320–599 | Single column. Sheet navigation. Cards stack. Stats 2-up |
| `sm` | 600 | Stats 3-up. Cards 2-up. Larger gutter |
| `md` | 900 | **Desktop navigation appears.** Hero becomes two columns. Cards 3-up |
| `lg` | 1200 | Case pages gain the sticky table-of-contents rail |
| `xl` | 1440 | Container caps; gutters grow; nothing reflows |

Component-level responsiveness uses **container queries**, not media queries, so
a work card is correct whether it sits in a 3-up home grid or a 2-up work index:

```css
.card-grid { container-type: inline-size; }
@container (min-width: 34rem) { .card { grid-template-columns: 1fr auto; } }
```

### 4.2 Safe areas

```css
body       { padding-inline: env(safe-area-inset-left) env(safe-area-inset-right); }
.site-nav  { padding-top: env(safe-area-inset-top); }
.site-foot { padding-bottom: max(var(--s-12), env(safe-area-inset-bottom)); }
```
Plus `<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">`.

---

## 5 · Radii, lines, elevation

```css
--r-chip:  980px;   /* chips, buttons, segmented controls */
--r-sm:    10px;    /* inline code, small media           */
--r-md:    16px;    /* inputs, list rows                  */
--r-lg:    20px;    /* cards                              */
--r-xl:    28px;    /* large panels, hero media frame     */

--sh-sm: 0 1px 2px rgb(0 0 0 / .04), 0 1px 1px rgb(0 0 0 / .03);
--sh-md: 0 4px 16px rgb(0 0 0 / .06);
--sh-lg: 0 16px 48px rgb(0 0 0 / .10);
```

In **dark mode every shadow is suppressed** and replaced by the elevated
surface plus a hairline — which is exactly how iOS handles depth in dark.

```css
@media (prefers-color-scheme: dark) {
  :root { --sh-sm: none; --sh-md: none; --sh-lg: none; }
}
```

### 5.1 The frosted material

```css
.material {
  background: var(--bg-glass);
  border-block-end: 1px solid var(--hairline);
}
@supports (backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px)) {
  .material {
    background: color-mix(in srgb, var(--bg) 72%, transparent);
    -webkit-backdrop-filter: saturate(180%) blur(20px);
    backdrop-filter: saturate(180%) blur(20px);
  }
}
```

The `@supports` guard is what keeps it honest: a browser without
`backdrop-filter` gets an opaque header, not an unreadable transparent one.

---

## 6 · Motion

```css
--ease:      cubic-bezier(.22, 1, .36, 1);     /* the iOS deceleration curve */
--ease-in:   cubic-bezier(.4, 0, 1, 1);
--dur-fast:  150ms;
--dur:       260ms;
--dur-slow:  420ms;
```

What is allowed to move, and nothing else:

1. **Hover / press feedback** — opacity and `translateY(-1px)` on cards,
   `scale(.97)` on button press. `--dur-fast`.
2. **Section reveal on scroll** — `opacity 0 → 1`, `translateY(12px) → 0`,
   driven by **CSS scroll-driven animation**, zero JavaScript:

   ```css
   @supports (animation-timeline: view()) {
     @media (prefers-reduced-motion: no-preference) {
       .reveal {
         animation: reveal linear both;
         animation-timeline: view();
         animation-range: entry 5% cover 22%;
       }
     }
   }
   ```
   Where unsupported, content is simply visible — the fallback is the correct
   state, never a hidden element waiting for a script that may not run. This
   matters for the AI requirement too: content must never depend on animation.

3. **Cross-document view transitions** — one line, and it gives the whole
   static multi-page site an app-like page change on Safari 18+ and Chromium:

   ```css
   @view-transition { navigation: auto; }
   ::view-transition-old(root) { animation: fade-out 120ms var(--ease-in) both; }
   ::view-transition-new(root) { animation: fade-in  220ms var(--ease)    both; }
   ```
   Elsewhere it is a normal page load. This is the single highest
   feel-per-byte item in the entire build.

4. **Global reduced-motion kill switch**, non-negotiable:

   ```css
   @media (prefers-reduced-motion: reduce) {
     *, *::before, *::after {
       animation-duration: .001ms !important;
       animation-iteration-count: 1 !important;
       transition-duration: .001ms !important;
       scroll-behavior: auto !important;
     }
     @view-transition { navigation: none; }
   }
   ```

⛔ No scroll-jacking. ⛔ No pinned sections. ⛔ No number counters that animate
from zero — the proof strip numbers are the most important text on the home
page and they render immediately.

### 6.1 Scroll snap — one boundary, `proximity`, never `mandatory`

**There is no threshold to tune.** CSS Scroll Snap has exactly two modes and
neither takes a percentage: `proximity` snaps only when the resting position is
already near a snap point (the range is a UA heuristic, not settable, and it
differs between Chromium and WebKit), and `mandatory` always snaps. A "snap once
you pass 50 % / 60 %" rule can only be built with a JS scroll handler — which
doc 01 §5 already rules out, costs INP on every wheel and touch event, and
breaks PageDown, find-in-page and screen-magnifier panning. A fixed percentage
is also the wrong model: what makes snapping feel right is fling *velocity*, not
distance, which is exactly why the browsers do not expose a number.

**`mandatory` is disqualified by measurement, not by taste.** The CSS Scroll
Snap spec warns that when a section is taller than the scrollport, mandatory
snapping can leave content between snap points unreachable. Measured on this
prototype:

| Viewport | Sections taller than the viewport |
| -------- | --------------------------------- |
| 1366 × 640 | **16 / 21** |
| 1280 × 720 | **13 / 21** |
| 1440 × 780 | **9 / 21** |
| 1920 × 900 | **9 / 21** |

On a case page it is worse — the article body runs five to eight viewports. So
the hazard is the majority case here, not an edge case.

**`proximity` on every section** is safe but close to pointless for the same
reason: most section start-edges are never near a resting position, so it rarely
fires. Complexity without the effect.

✅ **The rule: `proximity`, on the hero boundary only.** Exactly one snap edge,
on the one section guaranteed to be exactly one viewport tall. It delivers the
thing actually wanted — the first screen resolves cleanly instead of leaving a
sliver of the proof strip — and carries none of the reachability risk.

```css
html { scroll-padding-block-start: calc(var(--nav-h) + var(--s-2)); }
:root { scroll-snap-type: y proximity; }
.hero-sec, .hero-sec + .section { scroll-snap-align: start; }
@media (prefers-reduced-motion: reduce) { :root { scroll-snap-type: none; } }
```

`scroll-padding-block-start` is unconditional and load-bearing — without it the
sticky header covers the snap target and every `#anchor` destination.

---

## 7 · Components

Fourteen components carry the whole site.

| Component | Spec |
| --------- | ---- |
| **Site header** | Frosted, sticky, `--nav-h`. Bottom hairline appears only after 8 px scroll (a `scroll-timeline` trick, no JS). Logo is a 28 px `CT` monogram in a rounded square + the display name |
| **Nav sheet (mobile)** | `<details>` driven, slides in from the inline-end, 56 px rows, hairline dividers, closes on `Esc` and on backdrop tap. Works without JS |
| **Button — filled** | Pill, `--accent` background, `--accent-ink` text, 44 px min height, `padding-inline: var(--s-6)`, `scale(.97)` on `:active` |
| **Button — tinted** | Pill, `--accent-wash` background, `--accent` text. The secondary CTA |
| **Button — plain** | Text + `arrow-right` icon that translates 3 px on hover. The "read more" pattern everywhere |
| **Stat tile** | `--bg-elevated`, `--r-lg`, hairline. Figure at `--fs-h1`/700/`tabular-nums`, label at `--fs-sm`/`--text-3`. Exactly five exist |
| **Work card** | Whole card is one link. Eyebrow `Case N`, headline at `--fs-h3` (**the business change, never the stack**), the one-line outcome at `--fs-sm`, then capability chips, then an arrow. Hover: `translateY(-2px)` + hairline darkens |
| **Capability chip** | Pill, `--bg-sunken`, `--text-3`, 13 px, `+0.02em`. Monochrome by rule |
| **Step row** | Numbered `01`–`07` in mono `--text-3`, title, description. A vertical hairline connects the numbers into a spine on desktop |
| **Capability block** | 24 px SVG icon, `h3`, paragraph, then a `Supporting` line at 13 px in `--text-3` — the stack **always below** the capability, per `WEBSITE/README.md` §3 |
| **Prose block** | `--container-prose`, 68ch, `--fs-body`/1.6, `--s-5` between paragraphs. Used by About and by every case section |
| **Key-facts list** | A `<dl>` at the top of each case: Role · Period · Domain · Capabilities. Two columns on desktop, one on mobile. Built to be lifted verbatim by an LLM |
| **ToC rail** | Case pages ≥ 1200 px only. `position: sticky`, hairline left border, active item marked by `IntersectionObserver` (≈ 600 bytes, and the rail is fully functional without it). Below 1200 px it becomes a collapsed `<details>` at the top |
| **Contact band** | Full-width `--bg-sunken`, `--r-xl`, centred. Heading, roles line, filled email button with a copy affordance, then LinkedIn / GitHub links |

### 7.1 Two components that carry the "premium" judgement

**The proof strip caption.** The five numbers are set large and confident;
directly beneath them, at 15 px in `--text-3`, sits *"Two of those three AI
proposals did not go ahead, and that is the point."* That contrast — big
numbers, quiet honesty — is the design idea of the whole home page. It is not
decoration and it must not be dropped for space.

**The evidence marker.** Where a case says `[需要 Charlie 补充]`, it renders as a
visible dashed-hairline block labelled *Evidence pending*, in `--text-3`. A site
that shows its own gaps reads as more credible than one that hides them, and it
keeps the honesty rule enforceable at a glance.

### 7.2 Component-scoped tokens — the complete list

✅ A component may declare a token **only when the value is that component's
internal rhythm and nothing outside it may use it.** Four exist, and a fifth
would be a signal that the global set is wrong.

| Token | Owner | Value | Why it is not global |
| ----- | ----- | ----- | -------------------- |
| `--hstep` | hero | `clamp(8px, 1.7svh, 20px)` | Every hero margin is a multiple of it, so the block compresses as one unit on a short screen. Nothing else is height-driven |
| `--fs-hero-lead` | hero | `clamp(1.0625rem, min(1rem + .5vw, 2.9svh), 1.375rem)` | Same reason: the `svh` term exists so the hero fits a laptop viewport |
| `--dgm-min` | diagram | `540px` | Below it a diagram scrolls horizontally rather than shrinking its own labels. It is one figure's legibility floor, not a layout breakpoint |
| `--ratio` | image slot | set inline per instance | The aspect ratio is data, passed as a prop — `style="--ratio:4/5"` |

⛔ Anything else a component needs must come from the global tokens. A component
reaching for a colour the token set does not have means the token set is wrong,
not that a hex value may be typed inline.

---

## 8 · Iconography

* One inline `<svg>` symbol sprite per page, containing **only the symbols that
  page uses**. Zero requests, zero unused bytes.
* 24 × 24 viewBox, 1.5 px stroke, round caps and joins, `fill: none`,
  `stroke: currentColor`. Geometric, not playful.
* Every icon is `aria-hidden="true"` unless it is the only content of a control,
  in which case the control carries an `aria-label`.
* ⛔ No icon font. ⛔ No emoji as an icon. ⛔ No third-party icon set with a
  recognisable house style — it dates the page and it is somebody else's brand.

The full 26-icon list is in doc 07 §6.

---

## 9 · Accessibility

Not a section to be bolted on. Built in.

* Skip link as the first focusable element on every page.
* One `h1` per page; heading levels never skip.
* Landmarks: `header` / `nav` / `main` / `article` / `footer`, each labelled.
* `:focus-visible` ring: `outline: 2px solid var(--focus); outline-offset: 3px;`
  — never `outline: none`.
* **Targets: 44 px for chrome, WCAG 2.5.8 (24 × 24) for everything else, and
  the inline exception honoured** — a link inside a sentence is exempt, per the
  standard. Where a control must stay visually small (the segmented controls are
  30 px, as iOS ships them), the pill keeps its size and a transparent 44 px
  `::after` overlay carries the touch area. `npm run mobile` verifies this with
  `elementFromPoint` rather than `getBoundingClientRect`, because the box and the
  hit area are not the same thing.
* `prefers-reduced-motion` and `prefers-contrast` both handled.
* Colour is never the only carrier of meaning. Capability chips are text.
* Tables have `<caption>` and `<th scope>`. The experience table stays a real
  table and becomes a definition list under 600 px, not a horizontal scroller.
* Every external link is marked with an `arrow-up-right` icon plus visually
  hidden text `(opens in a new tab)`.
* Target: **Lighthouse Accessibility 100 and a manual keyboard pass**, because
  the automated score does not catch a focus trap.

---

## 10 · Chinese typography

The Chinese edition is not the English CSS with different words in it. Three
adjustments, scoped by `:lang(zh)` so they cost nothing on the English pages.

```css
:lang(zh) {
  --font-sans: -apple-system, "PingFang SC", "HarmonyOS Sans SC",
               "Microsoft YaHei UI", "Microsoft YaHei",
               "Noto Sans SC", system-ui, sans-serif;
  --fs-body: 1.0625rem;
  line-height: 1.8;          /* CJK needs more than the 1.6 English gets     */
  letter-spacing: 0;         /* negative tracking is wrong for CJK glyphs    */
  text-wrap: initial;        /* balance/pretty are tuned for word-space text */
}
:lang(zh) h1, :lang(zh) h2, :lang(zh) h3 {
  letter-spacing: 0;
  line-height: 1.35;         /* the English 1.04 clips CJK ascenders         */
  font-weight: 600;          /* 700 is too heavy at CJK stroke density       */
}
:lang(zh) .prose { max-width: 38em; }   /* ~38 CJK chars, not 68 latin chars */
```

Also:
* `word-break: normal` with `line-break: strict` — never `break-all`.
* Latin fragments inside Chinese text (`tulis.app`, `RabbitMQ`, `p95`) keep the
  latin stack via `unicode-range`, so they do not render in a CJK face.
* Chinese headlines are shorter than English ones. The layout is verified with
  the actual `CONTENT.ZH.md` strings, not with translated lorem.
* **The full name renders as `Charlie Tang Hoong (郑虎)`** — never `郑虎` alone.

---

## 11 · CSS architecture

Two halves: a **global layer** that every page shares, and **component-scoped
styles** that live inside the component that owns them.

### 11.1 Global — `src/styles/global.css`

Cascade layers, so specificity never becomes a fight.

```css
@layer reset, tokens, base, layout, overrides;
```

| Layer | Holds | Approx. |
| ----- | ----- | ------- |
| `reset` | Modern minimal reset, `box-sizing`, media defaults | 0.6 KB |
| `tokens` | Everything in §2–§6 of this document | 1.4 KB |
| `base` | Element defaults, typography, focus, selection | 1.2 KB |
| `layout` | Containers, sections, the editorial grid, safe areas | 1.2 KB |
| `overrides` | `:lang(zh)`, `prefers-reduced-motion`, `@view-transition`, print | 1.2 KB |

≈ 5.6 KB gzipped. Imported once in the base layout, hashed and cached for a
year.

### 11.2 Component-scoped — inside each `.astro` file

Astro scopes a component's `<style>` block to that component automatically, so
`.figure` inside `Hero.astro` cannot collide with `.figure` inside
`ProductCard.astro`. That removes the single biggest reason hand-written CSS
decays: the global class-name namespace.

It also removes the reason to reach for Tailwind. **No Tailwind, no
preprocessor, no PostCSS config.** Modern CSS is written directly, per
component, and Astro bundles and minifies it.

Component styles use the global tokens and add nothing to the token layer.
A component that wants a colour the tokens do not have is a signal that the
token set is wrong — not a licence to hard-code a hex value.

**Total shipped CSS ≈ 13 KB gzipped**, in one bundled file
(`build.inlineStylesheets: 'auto'` inlines the small leftovers).

---

## 12 · 🚚 The site mark

One mark, `public/favicon.svg`, meant to be reused unchanged on every
`*.tanghoong.com` property. Take this file as-is; ⛔ do not redraw it per site.

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-label="Charlie Tang Hoong">
  <rect width="64" height="64" rx="14.3" fill="#1d1d1f"/>
  <path d="M37 22a13 13 0 1 0 0 20" fill="none" stroke="#4dff9b" stroke-width="5.6" stroke-linecap="round"/>
  <circle cx="49" cy="32" r="4.6" fill="#4dff9b"/>
</svg>
```

| Rule | Why |
| ---- | --- |
| 🔴 **Geometry, never `<text>`** | The version this replaced set "CT" in a system font stack, so the letterform was whatever the viewer's OS had — and nothing where the stack missed. An icon reused across domains cannot depend on a font being installed |
| ⛔ **Not `CTH`** | Three letters do not survive a 16 px tab. Measured at 16/20/32/64/128, not assumed — `design/svg-trial/icons.png`. The header keeps CTH because it has 40 px to spend |
| **The dot is not decoration** | `·` is already this site's separator on every page ("Selangor, Malaysia · UTC+8"), and it is the endpoint the hero figure, the career timeline and the `/how-i-work` spine all run towards |
| **Dark tile in both schemes** | One file has to work on a light and a dark browser chrome and look identical wherever it is reused |
| **Ink is the vivid accent** | `#4dff9b` on `#1d1d1f` is ~13:1. ⚠️ The light-mode `#03744e` would be ~2.5:1 and unreadable at tab size — §2's dark-mode rule, applied to an icon |
| ⚠️ **A plain C is one line away** | If it ever needs to be more conservative, delete the `<circle>`. That was candidate B and it was the safe option |

**The other two files are derived from it and must be regenerated together**, or
the tab, the home-screen icon and the link preview stop agreeing:

* `public/apple-touch-icon.png` — 180 × 180, the same SVG rendered
* `public/og-default.png` — 1200 × 630, carries the mark plus name, role,
  `Selangor, Malaysia · UTC+8` and the domain

⚠️ Both were regenerated on 2026-08-29 because they still carried `CT` — the
header had already moved to `CTH` and neither followed. **A mark change is three
files, not one.**
