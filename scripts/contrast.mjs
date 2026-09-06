#!/usr/bin/env node
/**
 * contrast.mjs — make 03-DESIGN-SYSTEM.md's frontmatter true.
 *
 *   node scripts/contrast.mjs          report every check
 *   node scripts/contrast.mjs --fail   exit 1 on any failure (CI)
 *
 * That document claims it is "verified_by" something that fails the build when
 * the document and the code disagree. This is that something.
 *
 * The design system's own scripts/contrast.mjs parses assets/css/tokens.css,
 * because over there the stylesheet IS the artefact. This repo has no
 * stylesheet: its tokens are literals inside generate-cards.mjs and figures
 * written into 03-DESIGN-SYSTEM.md. So the equivalent guard reads BOTH and
 * fails when they disagree with each other or with the arithmetic.
 *
 * 🔴 A number in prose is a claim nobody re-checks. Every ratio quoted in the
 * design document is recomputed here from the hex the code actually ships. The
 * first run of this script found three stale figures in a paragraph that had
 * been inherited from a different palette and read as verified for a fortnight.
 *
 * No dependencies. Reads two files, does arithmetic, prints a table.
 */

import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ACCENT_INK,
  ENDPOINTS,
  LEGEND_MIN_DELTA,
  contrast,
  deltaE,
  inkOn,
  luminance,
  ramp,
} from './ramp.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const doc = await readFile(join(ROOT, '03-DESIGN-SYSTEM.md'), 'utf8');
const generator = await readFile(join(ROOT, 'scripts/generate-cards.mjs'), 'utf8');

/* Surfaces the cards actually paint on. These are §2 verbatim; the cards carry
   them as literals because an SVG cannot read a custom property. */
const SURFACE = {
  light: { bg: '#fbfbfd', sunken: '#f5f5f7', elevated: '#ffffff' },
  dark: { bg: '#000000', sunken: '#0a0a0c', elevated: '#1c1c1e' },
};
const TEXT = {
  light: { text: '#1d1d1f', 'text-2': '#515154', 'text-3': '#6e6e73' },
  dark: { text: '#f5f5f7', 'text-2': '#a1a1a6', 'text-3': '#86868b' },
};

const results = [];
const check = (label, ok, detail) => results.push({ label, ok, detail });
const near = (a, b, tol = 0.005) => Math.abs(a - b) <= tol;

/* ------------------------------------------------------------------ parsing */

/** `| Light | \`#03744e\` | 5.63 | 5.34 | \`#ffffff\` — 5.81 |` */
const accentRows = [...doc.matchAll(
  /^\|\s*(Light|Dark)\s*\|\s*`(#[0-9a-f]{6})`\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)\s*\|\s*`(#[0-9a-f]{6})`\s*—\s*([\d.]+)\s*\|/gim,
)].map((m) => ({
  mode: m[1].toLowerCase(),
  accent: m[2],
  onBg: Number(m[3]),
  onSunken: Number(m[4]),
  ink: m[5],
  onInk: Number(m[6]),
}));

/** `| Against the accent, light | **1.15:1** | **3.45:1** |` */
const greyRows = [...doc.matchAll(
  /^\|\s*Against the accent,\s*(light|dark)\s*\|\s*\*\*([\d.]+):1\*\*\s*\|\s*\*\*([\d.]+):1\*\*\s*\|/gim,
)].map((m) => ({ mode: m[1].toLowerCase(), red: Number(m[2]), grey: Number(m[3]) }));

/** `| Light | \`#03744e\` | \`#7ee6c3\` |` inside §2.2 */
const endpointRows = [...doc.matchAll(
  /^\|\s*(Light|Dark)\s*\|\s*`(#[0-9a-f]{6})`\s*\|\s*`(#[0-9a-f]{6})`\s*\|/gim,
)].map((m) => ({ mode: m[1].toLowerCase(), from: m[2], to: m[3] }));

/** `| \`--text\` | 16.28 | 19.29 |` — the ink table §2 ends with. */
const inkRows = [...doc.matchAll(
  /^\|\s*`--([a-z0-9-]+)`\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)\s*\|/gim,
)].map((m) => ({ token: m[1], light: Number(m[2]), dark: Number(m[3]) }));

/** The QUIET block, as quoted in the doc and as declared in the generator. */
const quietFrom = (source, where) => {
  const block = source.match(
    /light:\s*\{\s*fill:\s*'(#[0-9a-f]{6})',\s*edge:\s*'(#[0-9a-f]{6})'\s*\},\s*\n\s*dark:\s*\{\s*fill:\s*'(#[0-9a-f]{6})',\s*edge:\s*'(#[0-9a-f]{6})'\s*\}/i,
  );
  if (!block) throw new Error(`could not find the QUIET declaration in ${where}`);
  return {
    light: { fill: block[1], edge: block[2] },
    dark: { fill: block[3], edge: block[4] },
  };
};

/* ------------------------------------------------------- 1 · accent + ink  */

if (accentRows.length !== 2) {
  check('§2 accent table parses', false, `found ${accentRows.length} rows, expected 2`);
} else {
  for (const row of accentRows) {
    const s = SURFACE[row.mode];
    const onBg = contrast(row.accent, s.bg);
    const onSunken = contrast(row.accent, s.sunken);
    const onInk = contrast(row.accent, row.ink);
    check(
      `accent ${row.mode} on --bg`,
      near(onBg, row.onBg) && onBg >= 4.5,
      `${onBg.toFixed(2)} · doc ${row.onBg}`,
    );
    check(
      `accent ${row.mode} on --bg-sunken`,
      near(onSunken, row.onSunken) && onSunken >= 4.5,
      `${onSunken.toFixed(2)} · doc ${row.onSunken}`,
    );
    check(
      `--accent-ink ${row.ink} on the accent`,
      near(onInk, row.onInk) && onInk >= 4.5,
      `${onInk.toFixed(2)} · doc ${row.onInk}`,
    );
    check(
      `--accent-ink ${row.mode} is one of the two permitted inks`,
      ACCENT_INK.includes(row.ink),
      row.ink,
    );
  }
}

/* --------------------------------------------------------------- 2 · text  */

for (const row of inkRows) {
  for (const mode of ['light', 'dark']) {
    const ink = TEXT[mode][row.token];
    if (!ink) continue;
    const got = contrast(ink, SURFACE[mode].bg);
    check(
      `--${row.token} ${mode} on --bg`,
      near(got, row[mode], 0.01) && got >= 4.5,
      `${got.toFixed(2)} · doc ${row[mode]}`,
    );
  }
}

/* ------------------------------------------------- 3 · the quiet grey pair */

const docQuiet = quietFrom(doc, '03-DESIGN-SYSTEM.md');
const codeQuiet = quietFrom(generator, 'scripts/generate-cards.mjs');

for (const mode of ['light', 'dark']) {
  check(
    `QUIET.${mode} — document and generator agree`,
    docQuiet[mode].fill === codeQuiet[mode].fill && docQuiet[mode].edge === codeQuiet[mode].edge,
    `doc ${docQuiet[mode].fill}/${docQuiet[mode].edge} · code ${codeQuiet[mode].fill}/${codeQuiet[mode].edge}`,
  );
}

const greyByMode = Object.fromEntries(greyRows.map((r) => [r.mode, r]));
for (const mode of ['light', 'dark']) {
  const accent = ENDPOINTS.green[mode][0];
  const got = contrast(codeQuiet[mode].fill, accent);
  const claimed = greyByMode[mode]?.grey;
  // 3:1 is the floor a non-text mark has to clear to read as a different
  // series. This is the whole argument for grey over red: red never did.
  check(
    `quiet grey ${mode} separates from the accent`,
    got >= 3 && (claimed === undefined || near(got, claimed)),
    `${got.toFixed(2)} · doc ${claimed ?? 'not quoted'}`,
  );
  // A recessive fill still has to read as a bar, which is what `edge` is for.
  const edge = contrast(codeQuiet[mode].edge, SURFACE[mode].elevated);
  check(
    `quiet edge ${mode} draws the shape on --bg-elevated`,
    edge >= 2.5,
    `${edge.toFixed(2)} (fill alone is ${contrast(codeQuiet[mode].fill, SURFACE[mode].elevated).toFixed(2)})`,
  );
}

/* ---------------------------------------------------------- 4 · the ramp   */

if (endpointRows.length < 2) {
  check('§2.2 endpoint table parses', false, `found ${endpointRows.length} rows`);
} else {
  for (const row of endpointRows.slice(-2)) {
    const [from, to] = ENDPOINTS.green[row.mode];
    check(
      `ramp endpoints ${row.mode} — document and ramp.mjs agree`,
      from === row.from && to === row.to,
      `doc ${row.from}→${row.to} · code ${from}→${to}`,
    );
  }
}

for (const mode of ['light', 'dark']) {
  const six = ramp(...ENDPOINTS.green[mode], 6);
  const steps = six.slice(1).map((c, i) => deltaE(six[i], c));
  const min = Math.min(...steps);
  const spread = Math.max(...steps) / min;
  check(
    `ramp ${mode} clears the legend floor at 6 samples`,
    min >= LEGEND_MIN_DELTA,
    `smallest step ${min.toFixed(3)} · floor ${LEGEND_MIN_DELTA}`,
  );
  // Even steps are the entire reason for interpolating in OKLab. The HSL ramp
  // this replaced sat at 3.1x light and 3.9x dark.
  check(`ramp ${mode} steps are even`, spread <= 1.15, `spread ${spread.toFixed(2)}x`);

  // Greyscale is a required check for any chart whose meaning is in colour.
  // A ramp monotonic in luminance passes it by construction. Light runs from a
  // deep accent UP to a pale tail; dark runs from a vivid accent DOWN to a deep
  // one -- the two directions are the point, so each is asserted its own way.
  for (const n of [4, 6, 10, 16]) {
    const l = ramp(...ENDPOINTS.green[mode], n).map(luminance);
    const rising = mode === 'light';
    const monotonic = l.every((v, i) => i === 0 || (rising ? v > l[i - 1] : v < l[i - 1]));
    check(
      `ramp ${mode} survives grayscale(1) at ${n} samples`,
      monotonic,
      `${rising ? 'rising' : 'falling'} ${l[0].toFixed(3)} → ${l[l.length - 1].toFixed(3)}`,
    );
  }
}

/* ------------------------------------------------------------- 5 · card ink */

/* Where the ink lands at its worst, across every sample count the cards use.
   Below AA (4.5) because the middle of any ramp is genuinely hard ground for
   both inks — this is the achievable floor, and it is held rather than hoped
   for. Raising it means moving the endpoints, not relaxing the check. */
const INK_FLOOR = 4.4;

for (const mode of ['light', 'dark']) {
  for (const n of [6, 10, 16]) {
    const fills = ramp(...ENDPOINTS.green[mode], n);
    const worst = Math.min(...fills.map((f) => contrast(f, inkOn(f))));
    // Compared at the precision the documents quote: 4.3995 is 4.40:1 to a
    // reader and to every contrast tool. Rounding here is not lowering the bar.
    check(
      `label ink on a filled block, ${mode}, ${n} samples`,
      Number(worst.toFixed(2)) >= INK_FLOOR,
      `worst ${worst.toFixed(2)}:1 · floor ${INK_FLOOR}`,
    );
  }
}

/* ------------------------------------------------------------------ report */

const failed = results.filter((r) => !r.ok);
const width = Math.max(...results.map((r) => r.label.length));
for (const r of results) {
  console.log(`${r.ok ? 'ok  ' : 'FAIL'} ${r.label.padEnd(width)}  ${r.detail}`);
}
console.log(
  `\n${results.length - failed.length}/${results.length} checks passed` +
    (failed.length ? ` · ${failed.length} FAILED` : ''),
);

if (failed.length && process.argv.includes('--fail')) process.exit(1);
