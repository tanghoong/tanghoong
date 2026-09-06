#!/usr/bin/env node
/**
 * The chart ramp — a FUNCTION, not a palette.
 *
 * design.tanghoong.com states the rule: interpolate --c-from to --c-to and
 * sample it at however many series you have, IN OKLAB. sRGB (and HSL, which is
 * just sRGB in polar clothing) looks like the obvious choice and produces
 * perceptually uneven steps that bunch at one end.
 *
 * That is not a theoretical objection. The six-sample ramp this file replaces
 * was a linear walk through HSL saturation and lightness, and its steps came
 * out like this, measured as OKLab distance between neighbours:
 *
 *   light  .154 .134 .052 .049 .063   — a 3.1x spread
 *   dark   .036 .064 .135 .139 .136   — a 3.9x spread
 *   OKLAB  .073 .071 .072 .071 .072   — even, by construction
 *
 * In the dark theme the first three samples were #4dff9b #25f981 #0de26a:
 * three shades a reader cannot tell apart, in a chart whose only job is
 * telling series apart. At ten samples it was worse — the first four steps
 * were .019 each, so the whole head of the frameworks treemap was one green.
 *
 *   node scripts/ramp.mjs <n> [--json] [--accent green|blue] [--theme light|dark]
 *   node scripts/ramp.mjs --check     verify against the published tokens
 *
 * Zero dependencies, so CI needs no install step. Imported by
 * generate-cards.mjs, which is the only consumer that matters.
 */

/**
 * Index 0 is the largest series and IS the accent; the far end is the tail.
 *
 * green is verbatim from design.tanghoong.com/assets/css/tokens.css
 * (--c-from / --c-to). Do not "improve" these: a six-sample ramp between them
 * has to reproduce --c-1..--c-6 byte for byte, and --check proves it does.
 *
 * blue is the alternate ACCENT and the design system does not specify it, so
 * it is derived by the same construction: hue and chroma ratio taken from the
 * blue accent, tail lightness matched to green's tail in OKLab. Its dark span
 * is inherently shorter — #55a3fc is a much darker starting point than
 * #4dff9b, so there is less room below it — and the tail is placed to keep the
 * last block visible (3.14:1 on --bg-elevated, against green's 3.35:1) rather
 * than to maximise the spread. A block nobody can see is the worse failure.
 */
export const ENDPOINTS = {
  green: { light: ['#03744e', '#7ee6c3'], dark: ['#4dff9b', '#107f40'] },
  blue: { light: ['#0967d3', '#79cfff'], dark: ['#55a3fc', '#3c6ca4'] },
};

/** The six-sample case, as published. --check asserts we still land on it. */
const PUBLISHED = {
  light: ['#03744e', '#268a64', '#3da07b', '#53b792', '#69ceaa', '#7ee6c3'],
  dark: ['#4dff9b', '#41e488', '#35ca75', '#29b063', '#1d9751', '#107f40'],
};

const toLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toGamma = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

/** sRGB hex -> OKLab. Björn Ottosson's matrices, unrounded. */
export const hexToOklab = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => toLinear(v / 255));
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
};

/**
 * OKLab -> sRGB hex. Channels are clamped rather than gamut-mapped: both
 * endpoints are in gamut and the segment between them stays in gamut for every
 * pair in ENDPOINTS, so the clamp is a guard, not a colour decision.
 */
export const oklabToHex = ([L, A, B]) => {
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  const ch = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
  return `#${ch
    .map((v) => {
      const byte = Math.round(255 * Math.min(1, Math.max(0, toGamma(v))));
      return byte.toString(16).padStart(2, '0');
    })
    .join('')}`;
};

/** One point on the ramp. `p` runs 0 (the accent) to 1 (the tail). */
export const sampleAt = (from, to, p) => {
  const a = hexToOklab(from);
  const b = hexToOklab(to);
  const t = Math.min(1, Math.max(0, p));
  return oklabToHex(a.map((v, i) => v + (b[i] - v) * t));
};

/** `n` evenly spaced samples, ends inclusive. n === 1 returns the accent. */
export const ramp = (from, to, n) =>
  Array.from({ length: n }, (_, i) => sampleAt(from, to, n === 1 ? 0 : i / (n - 1)));

/** Both themes at once, which is how every consumer actually needs it. */
export const rampBoth = (n, accent = 'green') => ({
  light: ramp(...ENDPOINTS[accent].light, n),
  dark: ramp(...ENDPOINTS[accent].dark, n),
});

/* -------------------------------------------------------------------------- */
/* CLI                                                                        */
/* -------------------------------------------------------------------------- */

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'));
if (isMain) {
  const argv = process.argv.slice(2);
  const flag = (name, fallback) => {
    const hit = argv.find((a) => a.startsWith(`--${name}=`));
    return hit ? hit.slice(name.length + 3) : fallback;
  };

  if (argv.includes('--check')) {
    let bad = 0;
    for (const [theme, want] of Object.entries(PUBLISHED)) {
      const got = ramp(...ENDPOINTS.green[theme], 6);
      const ok = got.every((c, i) => c === want[i]);
      if (!ok) bad++;
      console.log(`${ok ? 'ok  ' : 'FAIL'} ${theme}  ${got.join(' ')}`);
      if (!ok) console.log(`     expected  ${want.join(' ')}`);
    }
    console.log(
      bad
        ? `\n${bad} theme(s) no longer reproduce tokens.css --c-1..--c-6.`
        : '\nSix samples reproduce tokens.css --c-1..--c-6 exactly.',
    );
    process.exit(bad ? 1 : 0);
  }

  const n = Number(argv.find((a) => /^\d+$/.test(a)) || 6);
  const accent = flag('accent', 'green');
  const theme = flag('theme', null);

  if (!ENDPOINTS[accent]) {
    console.error(`Unknown accent "${accent}". Try: ${Object.keys(ENDPOINTS).join(', ')}`);
    process.exit(1);
  }
  if (!Number.isInteger(n) || n < 1) {
    console.error('Sample count must be a positive integer.');
    process.exit(1);
  }

  const all = rampBoth(n, accent);
  const themes = theme ? [theme] : ['light', 'dark'];

  if (argv.includes('--json')) {
    const out = { accent, n };
    for (const k of themes) out[k] = all[k];
    console.log(JSON.stringify(out, null, 2));
  } else {
    for (const k of themes) console.log(`${accent} · ${k.padEnd(5)}  ${all[k].join(' ')}`);
    // Paste-ready only where CSS can use it; past six there is no token to fill.
    if (n <= 6 && !theme) {
      console.log('');
      for (let i = 0; i < n; i++) {
        console.log(`  --c-${i + 1}: light-dark(${all.light[i]}, ${all.dark[i]});`);
      }
    }
  }
}
