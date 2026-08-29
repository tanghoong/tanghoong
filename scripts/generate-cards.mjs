#!/usr/bin/env node
/**
 * Generates the profile README cards as static SVGs, with no third-party
 * services involved. Everything is derived from the GitHub GraphQL API and
 * written to assets/ so the README only ever references files in this repo.
 *
 * Usage: GITHUB_TOKEN=... USERNAME=tanghoong node scripts/generate-cards.mjs
 *
 * Env:
 *   USERNAME          GitHub login to render (default: tanghoong)
 *   CARD_TITLE        Heading on the overview card
 *   ACTIVITY_DAYS     Days in the activity chart (default: 30)
 *   ACCENT            "green" (default) or "blue" -- drives every data mark
 *   ANIMATE           "1" (default) or "0" to emit static cards
 *   CALENDAR_STYLE    "blocks" (default) or "city" for the skyline calendar
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'assets');

const TOKEN = process.env.GITHUB_TOKEN;
const USERNAME = process.env.USERNAME || 'tanghoong';
const TITLE = process.env.CARD_TITLE || `${USERNAME}'s Performance`;
const ACTIVITY_DAYS = Number(process.env.ACTIVITY_DAYS || 30);
const ACCENT = process.env.ACCENT === 'blue' ? 'blue' : 'green';
const ANIMATE = process.env.ANIMATE !== '0';
const CALENDAR_STYLE = process.env.CALENDAR_STYLE === 'city' ? 'city' : 'blocks';

if (!TOKEN) {
  console.error('GITHUB_TOKEN is required');
  process.exit(1);
}

/* ---------------------------------------------------------- design tokens */

/**
 * Geometry, on the design system's 4px space scale (03-DESIGN-SYSTEM.md §4) --
 * "never a magic number". Every card is full-bleed at the same width, which is
 * what keeps their corners aligned once GitHub scales them to the README
 * column. Radius is --r-lg, the system's card radius; per §5 nothing here has
 * a 4px corner.
 */
const D = {
  w: 880,
  pad: 24, // --s-6
  radius: 20, // --r-lg, "cards"
  head: 64, // --s-16, baseline where card content starts
  type: { title: 14, label: 12, value: 12, caption: 10, big: 20, huge: 30 },
};

/** Tracking from §3.3, in ems -- applied against each element's own size. */
const TRACK = { title: -0.014, body: -0.006, stat: -0.03, eyebrow: 0.07 };

const hslToHex = (h, s, l) => {
  const a = (s / 100) * Math.min(l / 100, 1 - l / 100);
  const f = (n) => {
    const k = (n + h / 30) % 12;
    const v = l / 100 - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(255 * v)
      .toString(16)
      .padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
};

/**
 * §2: there is exactly ONE accent, and it is green. Every data mark on every
 * card -- the ring, the activity area, the language bar and the calendar -- is
 * a shade of it, generated here rather than hand-picked.
 *
 * The doc is explicit that a palette of six colours is what makes a page look
 * like a bootcamp project, so the language bar uses this ramp too instead of
 * GitHub's per-language identity colours.
 *
 * `t` runs 0 (weakest) to 1 (the accent itself). Light and dark move in
 * opposite directions because the accent is deliberately asymmetric: a deep
 * green carries on white, a vivid green carries on black.
 */
const SCALES = {
  green: { light: [160, 95, 23], dark: [146, 100, 65] },
  blue: { light: [212, 92, 43], dark: [212, 96, 66] },
};

const makeTheme = (mode, base) => {
  const [h, s, l] = SCALES[ACCENT][mode];
  const shadeAt =
    mode === 'light'
      ? (t) => hslToHex(h, s - (1 - t) * 34, 80 - t * (80 - l))
      : (t) => hslToHex(h, s - (1 - t) * 28, 20 + t * (l - 20));
  return {
    ...base,
    accent: hslToHex(h, s, l),
    shadeAt,
    // Calendar intensity: index 0 is an empty day, so it stays a neutral
    // sunken surface rather than a faint green.
    levels: [base.sunken, shadeAt(0.25), shadeAt(0.5), shadeAt(0.75), shadeAt(1)],
    // Most-used language is the accent itself; each rank steps down the ramp.
    langAt: (i, n) => shadeAt(1 - (i / Math.max(1, n - 1)) * 0.78),
  };
};

// §2 tokens verbatim. Hairlines are a colour plus an opacity because SVG
// presentation attributes take them separately.
const THEMES = {
  light: makeTheme('light', {
    surface: '#ffffff', // --bg-elevated
    sunken: '#f5f5f7', // --bg-sunken
    title: '#1d1d1f', // --text
    text: '#1d1d1f',
    muted: '#515154', // --text-2
    faint: '#6e6e73', // --text-3
    hairline: '#000000',
    hairlineOpacity: 0.1,
    softOpacity: 0.06,
    track: '#f5f5f7',
    areaOpacity: 0.16,
    faceLeft: 0.72,
    faceRight: 0.87,
    // City: asphalt, and storey bands that read as glass catching the light.
    road: '#e8e8ed',
    windowLeft: 0.52,
    windowRight: 0.66,
  }),
  dark: makeTheme('dark', {
    surface: '#1c1c1e',
    sunken: '#0a0a0c',
    title: '#f5f5f7',
    text: '#f5f5f7',
    muted: '#a1a1a6',
    faint: '#86868b',
    hairline: '#ffffff',
    hairlineOpacity: 0.13,
    softOpacity: 0.08,
    track: '#2a2a2d',
    areaOpacity: 0.22,
    faceLeft: 0.62,
    faceRight: 0.8,
    // City at night: storeys are brighter than their wall, so they read as lit
    // windows -- still the one accent, never a warm second colour (§2).
    road: '#101013',
    windowLeft: 0.92,
    windowRight: 1.12,
  }),
};

// §3.1: the system stack, no web font. Family names are single-quoted -- these
// go into a double-quoted SVG attribute, and a raw " would close it and blank
// the whole card.
const FONT =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI Variable Display', 'Segoe UI'," +
  ' Roboto, system-ui, sans-serif';

/**
 * §6: the iOS deceleration curve and the three duration tokens -- nothing here
 * invents its own timing. Keyframes declare only `from`, so each element's own
 * attributes are the resting state, which is what lets the opt-in gate below
 * fall back to a complete card rather than a hidden one.
 */
const EASE = 'cubic-bezier(.22, 1, .36, 1)';
const MOTION = `
      .fade { animation: fade 260ms ${EASE} both; }
      .rise { animation: rise 420ms ${EASE} both; }
      .grow { animation: grow 420ms ${EASE} both; }
      .draw { animation: draw 900ms ${EASE} both; }
      @keyframes fade { from { opacity: 0; transform: translateY(6px); } }
      @keyframes rise { from { opacity: 0; transform: translateY(12px); } }
      @keyframes grow { from { transform: scaleX(0); } }
      @keyframes draw { from { stroke-dashoffset: 1; } }`;

/**
 * §6.2: "the fallback is the correct state, never a hidden element waiting for
 * a script that may not run -- content must never depend on animation."
 *
 * So motion is opt-IN behind `no-preference`, rather than opt-out behind
 * `reduce`. Every entrance starts from `opacity: 0`, and an SVG is rendered by
 * plenty of things that never tick an animation (image proxies, preview
 * generators, screenshotters). Under a `reduce` kill switch those all show a
 * blank card, because `both` fill paints the backwards state while an
 * animation sits unstarted. Verified against a non-ticking renderer: with the
 * rules opt-out the card renders HIDDEN, opt-in it renders VISIBLE.
 *
 * This also subsumes the kill switch -- a reduced-motion reader simply never
 * matches, so no `!important` override is needed, and no `animation-delay`
 * survives to stagger content in front of someone who asked for stillness.
 */
const motionBlock = (css = '') =>
  `\n    @media (prefers-reduced-motion: no-preference) {${MOTION}${css}\n    }`;

/* ------------------------------------------------------------------ utils */

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' };
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ESCAPES[c]);

const num = (n) => {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1).replace(/\.0$/, '')}M`;
  if (n >= 10000) return `${Math.round(n / 1000)}k`;
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  return String(n);
};

const comma = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

const round = (n) => Math.round(n * 100) / 100;

const iso = (d) => d.toISOString().slice(0, 10);

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const pretty = (isoDate) => {
  const [y, m, d] = isoDate.split('-').map(Number);
  return `${MONTHS[m - 1]} ${d}, ${y}`;
};

const shortDate = (isoDate) => {
  const [, m, d] = isoDate.split('-').map(Number);
  return `${MONTHS[m - 1]} ${d}`;
};

/** Multiplies a hex colour, used to shade the sides of the isometric boxes. */
const shade = (hex, f) => {
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) =>
    Math.max(0, Math.min(255, Math.round(v * f)))
  );
  return `#${ch.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
};

/**
 * Animation class + delay, or nothing at all when ANIMATE is off. `extraStyle`
 * is merged into the same style attribute -- emitting a second one would be
 * duplicate-attribute XML and the whole card would fail to parse.
 */
const anim = (cls, delay = 0, extraStyle = '') => {
  if (!ANIMATE) return extraStyle ? ` style="${extraStyle}"` : '';
  const style = [extraStyle, delay ? `animation-delay:${round(delay)}s` : '']
    .filter(Boolean)
    .join(';');
  return ` class="${cls}"${style ? ` style="${style}"` : ''}`;
};

/* ------------------------------------------------------------------- data */

async function gql(query, variables) {
  const res = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: {
      Authorization: `bearer ${TOKEN}`,
      'Content-Type': 'application/json',
      'User-Agent': `${USERNAME}-profile-cards`,
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`GitHub API ${res.status}: ${await res.text()}`);
  const body = await res.json();
  if (body.errors) throw new Error(`GraphQL: ${JSON.stringify(body.errors)}`);
  return body.data;
}

const PROFILE_QUERY = `
  query($login: String!) {
    user(login: $login) {
      name
      login
      createdAt
      followers { totalCount }
      repositories(ownerAffiliations: OWNER, isFork: false) { totalCount }
    }
  }
`;

const YEAR_QUERY = `
  query($login: String!, $from: DateTime!, $to: DateTime!) {
    user(login: $login) {
      contributionsCollection(from: $from, to: $to) {
        totalCommitContributions
        totalPullRequestContributions
        totalIssueContributions
        totalPullRequestReviewContributions
        restrictedContributionsCount
        contributionCalendar {
          totalContributions
          weeks { contributionDays { date contributionCount } }
        }
      }
    }
  }
`;

const REPOS_QUERY = `
  query($login: String!, $cursor: String) {
    user(login: $login) {
      repositories(
        first: 100
        after: $cursor
        ownerAffiliations: OWNER
        isFork: false
        orderBy: { field: STARGAZERS, direction: DESC }
      ) {
        pageInfo { hasNextPage endCursor }
        nodes {
          stargazerCount
          languages(first: 10, orderBy: { field: SIZE, direction: DESC }) {
            edges { size node { name color } }
          }
        }
      }
    }
  }
`;

async function fetchStats() {
  const { user } = await gql(PROFILE_QUERY, { login: USERNAME });
  const createdAt = new Date(user.createdAt);
  const now = new Date();

  // The contribution calendar is capped at one year per query, so walk the
  // account year by year and stitch the days back together.
  const days = new Map();
  const totals = { commits: 0, prs: 0, issues: 0, reviews: 0, private: 0, contributions: 0 };

  for (let year = createdAt.getUTCFullYear(); year <= now.getUTCFullYear(); year++) {
    const from = new Date(Date.UTC(year, 0, 1));
    const to = new Date(Date.UTC(year, 11, 31, 23, 59, 59));
    const c = (
      await gql(YEAR_QUERY, {
        login: USERNAME,
        from: (from < createdAt ? createdAt : from).toISOString(),
        to: (to > now ? now : to).toISOString(),
      })
    ).user.contributionsCollection;

    totals.commits += c.totalCommitContributions;
    totals.prs += c.totalPullRequestContributions;
    totals.issues += c.totalIssueContributions;
    totals.reviews += c.totalPullRequestReviewContributions;
    totals.private += c.restrictedContributionsCount;
    // The calendar total already folds in restrictedContributionsCount, so it
    // must not be added on top of it again.
    totals.contributions += c.contributionCalendar.totalContributions;

    for (const week of c.contributionCalendar.weeks) {
      for (const day of week.contributionDays) {
        days.set(day.date, (days.get(day.date) || 0) + day.contributionCount);
      }
    }
  }

  let stars = 0;
  const langSizes = new Map();
  const langColors = new Map();
  for (let cursor = null, more = true; more; ) {
    const repos = (await gql(REPOS_QUERY, { login: USERNAME, cursor })).user.repositories;
    for (const repo of repos.nodes) {
      stars += repo.stargazerCount;
      for (const { size, node } of repo.languages.edges) {
        langSizes.set(node.name, (langSizes.get(node.name) || 0) + size);
        langColors.set(node.name, node.color || '#858585');
      }
    }
    more = repos.pageInfo.hasNextPage;
    cursor = repos.pageInfo.endCursor;
  }

  const langTotal = [...langSizes.values()].reduce((a, b) => a + b, 0) || 1;
  const languages = [...langSizes.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([name, size]) => ({
      name,
      color: langColors.get(name),
      percent: round((size / langTotal) * 100),
    }));

  return {
    user,
    totals,
    stars,
    languages,
    days,
    streaks: computeStreaks(days),
    since: iso(createdAt),
  };
}

/**
 * Today only breaks a streak once it is over: an empty today still counts as
 * "in progress" as long as yesterday had contributions.
 */
function computeStreaks(days) {
  const sorted = [...days.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  const today = iso(new Date());

  let longest = { length: 0, start: null, end: null };
  let run = { length: 0, start: null, end: null };
  let current = { length: 0, start: null, end: null };

  for (const [date, count] of sorted) {
    if (date > today) break;
    if (count > 0) {
      run = { length: run.length + 1, start: run.start ?? date, end: date };
      if (run.length > longest.length) longest = { ...run };
      current = { ...run };
    } else if (date !== today) {
      run = { length: 0, start: null, end: null };
      current = { length: 0, start: null, end: null };
    }
  }

  return { current, longest };
}

/* -------------------------------------------------------------- svg parts */

/**
 * `track` is a §3.3 tracking value in ems, resolved against this element's own
 * size -- large type takes tighter tracking, eyebrows take looser.
 */
const text = (
  x,
  y,
  str,
  {
    size = D.type.value,
    weight = 400,
    fill,
    anchor = 'start',
    track = TRACK.body,
    tabular = false,
    cls,
    delay,
  } = {}
) =>
  `  <text x="${round(x)}" y="${round(y)}" font-family="${FONT}" font-size="${size}"` +
  ` font-weight="${weight}" fill="${fill}"` +
  (anchor === 'start' ? '' : ` text-anchor="${anchor}"`) +
  (track ? ` letter-spacing="${round(track * size)}"` : '') +
  (cls ? anim(cls, delay, tabular ? 'font-variant-numeric:tabular-nums' : '') : '') +
  `>${esc(str)}</text>`;

/**
 * The single card primitive every asset is built from: same width, border,
 * radius, padding and header placement, so the cards stack into one column
 * with their corners aligned.
 */
const card = (h, t, { title, subtitle, body, css = '', panels = [] }) => {
  const W = D.w;
  const heads = panels.length ? panels : [{ x: D.pad, title, subtitle }];

  const parts = [
    ANIMATE ? `  <style>${motionBlock(css)}\n  </style>` : null,
    // §5 and §0.4 rule 5: separation by hairline over an elevated surface,
    // never by shadow.
    `  <rect x="0.5" y="0.5" width="${W - 1}" height="${h - 1}" rx="${D.radius}"` +
      ` fill="${t.surface}" stroke="${t.hairline}" stroke-opacity="${t.hairlineOpacity}"/>`,
    ...heads.flatMap((p, i) =>
      [
        p.title
          ? text(p.x, p.subtitle ? 36 : 40, p.title, {
              size: D.type.title,
              weight: 600,
              fill: t.title,
              track: TRACK.title,
              cls: 'fade',
              delay: 0.04 * i,
            })
          : null,
        p.subtitle
          ? text(p.x, 54, p.subtitle, {
              size: D.type.caption,
              fill: t.faint,
              cls: 'fade',
              delay: 0.04 * i + 0.06,
            })
          : null,
      ].filter(Boolean)
    ),
    body,
  ].filter(Boolean);

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="${h}"` +
    ` viewBox="0 0 ${W} ${h}" fill="none" role="img"` +
    ` preserveAspectRatio="xMidYMid meet">\n${parts.join('\n')}\n</svg>\n`
  );
};

/* ------------------------------------------------------------------ cards */

/**
 * Stats and languages share one card so the top of the README is a single
 * full-width block, flush with the cards below it.
 */
function overviewCard(data, t) {
  const H = 208;
  const mid = D.w / 2;
  const L = D.pad; // left panel inset
  const R = mid + D.pad; // right panel inset
  const panelW = mid - D.pad * 2;

  /* ---- left: headline numbers + active-days ring ---- */

  const rows = [
    ['Total Stars Earned', data.stars],
    ['Public Commits', data.totals.commits],
    ['Private Contributions', data.totals.private],
    ['Pull Requests', data.totals.prs],
    ['Issues Opened', data.totals.issues],
    ['Followers', data.user.followers.totalCount],
  ];

  // Share of the year so far with at least one contribution -- unlike a raw
  // contribution count this stays meaningful as a ring.
  const now = new Date();
  const currentYear = String(now.getUTCFullYear());
  const activeDays = [...data.days.entries()].filter(
    ([d, c]) => d.startsWith(currentYear) && c > 0
  ).length;
  const elapsed = Math.max(
    1,
    Math.round((now - new Date(Date.UTC(now.getUTCFullYear(), 0, 1))) / 86400000) + 1
  );
  const frac = Math.min(1, activeDays / elapsed);
  // A wider ring and a smaller figure inside it: at 26px the number crowded
  // the stroke, so the ring grows and the figure drops to --big (20px),
  // leaving clear space on all four sides.
  const rCirc = 42;
  const circ = 2 * Math.PI * rCirc;
  const cx = mid - D.pad - rCirc - 4;

  const statRows = rows.map((r, i) => {
    const y = D.head + 14 + i * 19;
    return (
      text(L, y, r[0], { size: D.type.label, fill: t.muted, cls: 'fade', delay: 0.1 + i * 0.05 }) +
      '\n' +
      text(cx - rCirc - 22, y, num(r[1]), {
        size: D.type.value,
        weight: 600,
        fill: t.text,
        anchor: 'end',
        cls: 'fade',
        delay: 0.14 + i * 0.05,
      })
    );
  });

  const ring = [
    `  <circle cx="${round(cx)}" cy="122" r="${rCirc}" stroke="${t.track}" stroke-width="5" fill="none"/>`,
    `  <circle cx="${round(cx)}" cy="122" r="${rCirc}" stroke="${t.accent}" stroke-width="5"` +
      ` fill="none" stroke-linecap="round" stroke-dasharray="${round(circ)}"` +
      ` stroke-dashoffset="${round(circ * (1 - frac))}"` +
      ` transform="rotate(-90 ${round(cx)} 122)"${anim('sweep')}/>`,
    text(cx, 120, String(activeDays), {
      size: D.type.big,
      weight: 700,
      fill: t.text,
      anchor: 'middle',
      track: TRACK.stat,
      tabular: true,
      cls: 'fade',
      delay: 0.3,
    }),
    text(cx, 137, 'active days', {
      size: 9,
      fill: t.faint,
      anchor: 'middle',
      cls: 'fade',
      delay: 0.34,
    }),
    text(cx, 186, `${Math.round(frac * 100)}% of ${currentYear}`, {
      size: D.type.caption,
      fill: t.faint,
      anchor: 'middle',
      cls: 'fade',
      delay: 0.38,
    }),
  ].join('\n');

  /* ---- right: language bar + legend ---- */

  const barY = D.head + 8;
  const colW = panelW / 2;

  // §2 / §0.5: one accent, no palette of six. Rank drives the shade, so the
  // bar also reads as a ranking rather than as six unrelated tags.
  const n = data.languages.length;
  const langColor = (i) => t.langAt(i, n);

  let offset = 0;
  const segments = data.languages.map((l, i) => {
    const w = (l.percent / 100) * panelW;
    const seg =
      `  <rect x="${round(R + offset)}" y="${barY}"` +
      ` width="${round(Math.max(w - 1, 0.5))}" height="8" fill="${langColor(i)}"/>`;
    offset += w;
    return seg;
  });

  const legend = data.languages.map((l, i) => {
    const x = R + (i % 2) * colW;
    const y = barY + 42 + Math.floor(i / 2) * 27;
    const d = 0.34 + i * 0.05;
    return [
      `  <circle cx="${round(x + 5)}" cy="${round(y - 4)}" r="5" fill="${langColor(i)}"${anim('fade', d)}/>`,
      text(x + 17, y, l.name, {
        size: D.type.label,
        weight: 500,
        fill: t.text,
        cls: 'fade',
        delay: d,
      }),
      // Right-aligned to a fixed column so proportional glyph widths cannot
      // push the percentage into the language name.
      text(x + colW - 16, y, `${l.percent}%`, {
        size: D.type.caption,
        fill: t.muted,
        anchor: 'end',
        cls: 'fade',
        delay: d + 0.03,
      }),
    ].join('\n');
  });

  const body = [
    `  <line x1="${mid}" y1="${D.head - 34}" x2="${mid}" y2="${H - 24}" stroke="${t.hairline}" stroke-opacity="${t.softOpacity}"/>`,
    ...statRows,
    ring,
    `  <mask id="bar"><rect x="${R}" y="${barY}" width="${panelW}" height="8" rx="4" fill="#fff"/></mask>`,
    `  <g mask="url(#bar)"${anim('grow', 0.15, `transform-origin:${R}px ${barY + 4}px`)}>`,
    `  <rect x="${R}" y="${barY}" width="${panelW}" height="8" fill="${t.track}"/>`,
    ...segments,
    '  </g>',
    ...legend,
  ].join('\n');

  return card(H, t, {
    css:
      `\n      .sweep { animation: sweep 420ms ${EASE} 120ms both; }` +
      `\n      @keyframes sweep { from { stroke-dashoffset: ${round(circ)}; } }`,
    panels: [
      { x: L, title: TITLE },
      { x: R, title: 'Most Used Languages' },
    ],
    body,
  });
}

function streakCard(data, t) {
  const H = 168;
  const { current, longest } = data.streaks;
  const col = D.w / 3;

  const range = (s) =>
    s.length === 0
      ? 'no active streak'
      : s.start === s.end
        ? pretty(s.start)
        : `${pretty(s.start)} - ${pretty(s.end)}`;

  const panel = (index, value, label, sub) => {
    const cx = col * index + col / 2;
    const d = 0.12 + index * 0.12;
    return [
      text(cx, 108, comma(value), {
        size: D.type.huge,
        weight: 700,
        fill: t.text,
        anchor: 'middle',
        track: TRACK.stat,
        tabular: true,
        cls: 'rise',
        delay: d,
      }),
      text(cx, 130, label, {
        size: 10,
        weight: 600,
        fill: t.muted,
        anchor: 'middle',
        track: TRACK.eyebrow,
        cls: 'fade',
        delay: d + 0.06,
      }),
      text(cx, 147, sub, {
        size: D.type.caption,
        fill: t.faint,
        anchor: 'middle',
        cls: 'fade',
        delay: d + 0.1,
      }),
    ].join('\n');
  };

  const body = [
    `  <line x1="${col}" y1="${D.head + 4}" x2="${col}" y2="${H - 22}" stroke="${t.hairline}" stroke-opacity="${t.softOpacity}"/>`,
    `  <line x1="${col * 2}" y1="${D.head + 4}" x2="${col * 2}" y2="${H - 22}" stroke="${t.hairline}" stroke-opacity="${t.softOpacity}"/>`,
    panel(0, data.totals.contributions, 'TOTAL CONTRIBUTIONS', `${pretty(data.since)} - Present`),
    panel(1, current.length, 'CURRENT STREAK', range(current)),
    panel(2, longest.length, 'LONGEST STREAK', range(longest)),
  ].join('\n');

  return card(H, t, { title: 'Contribution Streak', body });
}

function activityCard(data, t) {
  const H = 240;
  const plot = { top: 84, right: D.pad + 8, bottom: 40, left: D.pad + 22 };
  const plotW = D.w - plot.left - plot.right;
  const plotH = H - plot.top - plot.bottom;

  const today = new Date();
  const series = [];
  for (let i = ACTIVITY_DAYS - 1; i >= 0; i--) {
    const d = new Date(
      Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - i)
    );
    series.push({ date: iso(d), count: data.days.get(iso(d)) || 0 });
  }

  const max = Math.max(1, ...series.map((p) => p.count));
  const x = (i) => plot.left + (i / (series.length - 1)) * plotW;
  const y = (v) => plot.top + plotH - (v / max) * plotH;
  const points = series.map((p, i) => [x(i), y(p.count)]);
  const baseline = plot.top + plotH;

  // Catmull-Rom to cubic bezier, clamped so the curve never leaves the plot.
  const clamp = (v) => Math.min(baseline, Math.max(plot.top, v));
  let line = `M ${round(points[0][0])} ${round(points[0][1])}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] || points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] || p2;
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, clamp(p1[1] + (p2[1] - p0[1]) / 6)];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, clamp(p2[1] - (p3[1] - p1[1]) / 6)];
    line +=
      ` C ${round(c1[0])} ${round(c1[1])}, ${round(c2[0])} ${round(c2[1])},` +
      ` ${round(p2[0])} ${round(p2[1])}`;
  }
  const area = `${line} L ${round(points.at(-1)[0])} ${baseline} L ${round(points[0][0])} ${baseline} Z`;

  const gridLines = [0, 0.5, 1].map((f) => {
    const gy = round(plot.top + plotH * f);
    return (
      `  <line x1="${plot.left}" y1="${gy}" x2="${plot.left + plotW}" y2="${gy}"` +
      ` stroke="${t.hairline}" stroke-opacity="${t.softOpacity}"/>\n` +
      text(plot.left - 10, gy + 3.5, String(Math.round(max * (1 - f))), {
        size: 9,
        fill: t.faint,
        anchor: 'end',
      })
    );
  });

  // Always label the final day, and drop any stepped label that would collide
  // with it.
  const step = Math.max(1, Math.round(series.length / 8));
  const last = series.length - 1;
  const minGap = step * 0.6;
  const xLabels = series
    .map((p, i) => (i === last || (i % step === 0 && last - i > minGap) ? { p, i } : null))
    .filter(Boolean)
    .map(({ p, i }) =>
      text(x(i), baseline + 20, shortDate(p.date), {
        size: 9,
        fill: t.faint,
        anchor: 'middle',
        cls: 'fade',
        delay: 0.9 + (i / last) * 0.3,
      })
    );

  // Dots pop in behind the advancing line head, so the chart reads left to
  // right as one gesture.
  const dots = points
    .map(([px, py], i) =>
      series[i].count === 0
        ? null
        : `  <circle cx="${round(px)}" cy="${round(py)}" r="2.5" fill="${t.accent}"` +
          `${anim('fade', 0.25 + (i / last) * 1.15)}/>`
    )
    .filter(Boolean);

  const total = series.reduce((a, p) => a + p.count, 0);

  const body = [
    '  <linearGradient id="fade-grad" x1="0" y1="0" x2="0" y2="1">',
    `    <stop offset="0%" stop-color="${t.accent}" stop-opacity="${round(t.areaOpacity * 2.5)}"/>`,
    `    <stop offset="100%" stop-color="${t.accent}" stop-opacity="0"/>`,
    '  </linearGradient>',
    ...gridLines,
    `  <path d="${area}" fill="url(#fade-grad)"${anim('fade', 0.75)}/>`,
    `  <path d="${line}" fill="none" stroke="${t.accent}" stroke-width="2"` +
      ` stroke-linecap="round" stroke-linejoin="round"` +
      ` pathLength="1" stroke-dasharray="1" stroke-dashoffset="0"${anim('draw', 0.2)}/>`,
    ...dots,
    ...xLabels,
  ].join('\n');

  return card(H, t, {
    title: 'Contribution Activity',
    subtitle: `Last ${ACTIVITY_DAYS} days · ${comma(total)} contributions · peak ${max} in a day`,
    body,
  });
}

/* ------------------------------------------------- 3D contribution calendar */

/**
 * Isometric replacement for github-profile-3d-contrib. Each day is an
 * extruded box on a 53x7 grid, projected with a flattened isometric
 * transform and painted back-to-front.
 */
function calendarCard(data, t) {
  const CITY = CALENDAR_STYLE === 'city';
  const HW = 13; // half width of a tile diamond
  const HH = 4.5; // half height; flatter than a true 2:1 isometric so the
  //                 53-week band does not run away down the card
  // The city needs far more vertical range than the blocks do -- towers are
  // what make it read as a skyline rather than a bar chart.
  const MAX_H = CITY ? 92 : 44;
  const PLOT = 0.62; // building footprint as a share of its tile; the margin
  //                    left over is what reads as the street grid
  const WEEKS = 53;

  // Rebuild GitHub's own grid: 53 columns ending on today, each starting on a
  // Sunday.
  const today = new Date();
  const todayUTC = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const end = new Date(todayUTC);
  const start = new Date(todayUTC - ((WEEKS - 1) * 7 + end.getUTCDay()) * 86400000);

  const cells = [];
  let max = 1;
  let total = 0;
  for (let w = 0; w < WEEKS; w++) {
    for (let d = 0; d < 7; d++) {
      const date = new Date(start.getTime() + (w * 7 + d) * 86400000);
      if (date.getTime() > todayUTC) continue;
      const count = data.days.get(iso(date)) || 0;
      max = Math.max(max, count);
      total += count;
      cells.push({ w, d, count });
    }
  }

  const level = (c) => (c === 0 ? 0 : Math.min(4, Math.ceil((c / max) * 4)));
  // A gentle power curve keeps single-contribution days visible next to a
  // three-figure spike.
  const heightFor = (c) =>
    c === 0 ? 0 : CITY ? 5 + Math.pow(c / max, 0.5) * MAX_H : 3 + Math.pow(c / max, 0.6) * MAX_H;

  /**
   * One city block. The tile is drawn full-width as ground, and the tower is
   * inset to PLOT of it -- the leftover margin between neighbours is the road,
   * so the street grid comes for free from the calendar's own 53x7 layout.
   *
   * Storeys are horizontal bands across the two visible faces rather than
   * individual windows: at ~370 buildings, per-window quads run to six figures
   * of polygons, while bands cost one quad per floor per face and read the
   * same at this scale.
   */
  const cityBlock = (cell) => {
    const X = (cell.w - cell.d) * HW;
    const Y = (cell.w + cell.d) * HH;
    const h = heightFor(cell.count);
    const base = t.levels[level(cell.count)];
    const out = [];

    // Ground first: an empty day is a vacant lot, which keeps the grid legible.
    out.push(
      `  <polygon points="${X},${round(Y)} ${round(X + HW)},${round(Y + HH)} ${X},${round(Y + 2 * HH)} ${round(X - HW)},${round(Y + HH)}" fill="${t.road}"/>`
    );
    if (h === 0) return out;

    const bw = HW * PLOT;
    const bh = HH * PLOT;
    const cy = Y + HH; // tile centre, where the footprint is anchored
    const left = shade(base, t.faceLeft);
    const right = shade(base, t.faceRight);

    // Footprint corners, clockwise from the west corner.
    const W_ = [X - bw, cy];
    const S_ = [X, cy + bh];
    const E_ = [X + bw, cy];

    out.push(
      `  <polygon points="${round(W_[0])},${round(W_[1] - h)} ${round(S_[0])},${round(S_[1] - h)} ${round(S_[0])},${round(S_[1])} ${round(W_[0])},${round(W_[1])}" fill="${left}"/>`,
      `  <polygon points="${round(S_[0])},${round(S_[1] - h)} ${round(E_[0])},${round(E_[1] - h)} ${round(E_[0])},${round(E_[1])} ${round(S_[0])},${round(S_[1])}" fill="${right}"/>`
    );

    // Storey bands, only once a tower is tall enough to have them read.
    if (h > 16) {
      const floors = Math.min(6, Math.floor(h / 11));
      const band = 2.2;
      for (let f = 1; f <= floors; f++) {
        const v = (h / (floors + 1)) * f;
        for (const [a, b, tint] of [
          [W_, S_, t.windowLeft],
          [S_, E_, t.windowRight],
        ]) {
          out.push(
            `  <polygon points="${round(a[0])},${round(a[1] - v - band)} ${round(b[0])},${round(b[1] - v - band)} ${round(b[0])},${round(b[1] - v)} ${round(a[0])},${round(a[1] - v)}" fill="${shade(base, tint)}"/>`
          );
        }
      }
    }

    // Roof last, so it sits over both faces.
    out.push(
      `  <polygon points="${X},${round(cy - bh - h)} ${round(E_[0])},${round(E_[1] - h)} ${X},${round(S_[1] - h)} ${round(W_[0])},${round(W_[1] - h)}" fill="${base}"/>`
    );
    return out;
  };

  // Painter's algorithm: in this projection a larger (w + d) sits nearer the
  // viewer, so drawing diagonals in ascending order layers the boxes
  // correctly -- and grouping by diagonal gives the entrance a single wave
  // that sweeps the band, for 59 extra tags rather than one per day.
  const diagonals = new Map();
  for (const cell of cells) {
    const key = cell.w + cell.d;
    if (!diagonals.has(key)) diagonals.set(key, []);
    diagonals.get(key).push(cell);
  }

  const groups = [...diagonals.keys()]
    .sort((a, b) => a - b)
    .map((key, i) => {
      const shapes = diagonals
        .get(key)
        .sort((a, b) => a.w - b.w)
        .flatMap((cell) => {
          if (CITY) return cityBlock(cell);
          const X = (cell.w - cell.d) * HW;
          const Y = (cell.w + cell.d) * HH;
          const h = heightFor(cell.count);
          const base = t.levels[level(cell.count)];
          const out = [];
          if (h > 0) {
            out.push(
              `  <polygon points="${round(X - HW)},${round(Y + HH - h)} ${X},${round(Y + 2 * HH - h)} ${X},${round(Y + 2 * HH)} ${round(X - HW)},${round(Y + HH)}" fill="${shade(base, t.faceLeft)}"/>`,
              `  <polygon points="${X},${round(Y + 2 * HH - h)} ${round(X + HW)},${round(Y + HH - h)} ${round(X + HW)},${round(Y + HH)} ${X},${round(Y + 2 * HH)}" fill="${shade(base, t.faceRight)}"/>`
            );
          }
          out.push(
            `  <polygon points="${X},${round(Y - h)} ${round(X + HW)},${round(Y + HH - h)} ${X},${round(Y + 2 * HH - h)} ${round(X - HW)},${round(Y + HH - h)}" fill="${base}"/>`
          );
          return out;
        });
      return `  <g${anim('rise', 0.15 + i * 0.016)}>\n${shapes.join('\n')}\n  </g>`;
    });

  // Fit the projected grid to the card instead of hand-tuning constants.
  const minX = -7 * HW;
  const maxX = WEEKS * HW;
  const minY = -MAX_H - 3;
  const maxY = (WEEKS + 5) * HH + 2 * HH;
  const scale = (D.w - D.pad * 2) / (maxX - minX);
  const H = Math.ceil(D.head + 10 + (maxY - minY) * scale + D.pad + 22);

  // Anchored to the right padding edge: Less, the swatches, then More.
  const swatchEnd = D.w - D.pad - 34;
  const swatchStart = swatchEnd - (t.levels.length * 15 - 4);
  const legend = t.levels
    .map(
      (c, i) =>
        `  <rect x="${round(swatchStart + i * 15)}" y="${H - 33}" width="11" height="11" rx="2" fill="${c}"${anim('fade', 1.2 + i * 0.05)}/>`
    )
    .join('\n');

  const body = [
    `  <g transform="translate(${round(D.pad - minX * scale)} ${round(D.head + 10 - minY * scale)}) scale(${round(scale)})">`,
    ...groups,
    '  </g>',
    text(swatchStart - 6, H - 24, 'Less', {
      size: 9,
      fill: t.faint,
      anchor: 'end',
      cls: 'fade',
      delay: 1.2,
    }),
    legend,
    text(swatchEnd + 6, H - 24, 'More', {
      size: 9,
      fill: t.faint,
      cls: 'fade',
      delay: 1.45,
    }),
  ].join('\n');

  return card(H, t, {
    title: 'Contribution Calendar',
    subtitle: `${pretty(iso(start))} - ${pretty(iso(end))} · ${comma(total)} contributions · peak ${max} in a day`,
    body,
  });
}

/* ------------------------------------------------------------------- main */

const data = await fetchStats();
await mkdir(OUT_DIR, { recursive: true });

const cards = {
  overview: overviewCard,
  streak: streakCard,
  activity: activityCard,
  calendar: calendarCard,
};

/**
 * A malformed SVG renders as a broken image with no error anywhere, so every
 * card is checked for duplicate attributes and balanced tags before it is
 * written.
 */
function assertWellFormed(name, svg) {
  const tags = svg.match(/<[a-zA-Z][^>]*>/g) || [];
  for (const tag of tags) {
    const seen = new Set();
    for (const [, attr] of tag.matchAll(/([a-zA-Z-]+)\s*=\s*"/g)) {
      if (seen.has(attr)) throw new Error(`${name}: duplicate "${attr}" attribute in ${tag}`);
      seen.add(attr);
    }
    // A well-formed tag is a name followed only by name="value" pairs. Testing
    // that grammar catches a raw " inside a value, which silently closes its
    // own attribute and renders the card as a blank image with no error
    // anywhere. A quote-parity check does not: a stray pair keeps the count
    // even.
    const attrs = tag.replace(/^<[a-zA-Z][a-zA-Z0-9-]*/, '').replace(/\/?>$/, '');
    if (!/^(\s+[a-zA-Z-][a-zA-Z0-9-:]*\s*=\s*"[^"]*")*\s*$/.test(attrs)) {
      throw new Error(`${name}: malformed attributes in ${tag.slice(0, 140)}`);
    }
  }
  const open = (svg.match(/<(?!\/)[a-zA-Z][^>]*(?<!\/)>/g) || []).length;
  const close = (svg.match(/<\/[a-zA-Z]/g) || []).length;
  if (open !== close) throw new Error(`${name}: ${open} opening tags vs ${close} closing tags`);
}

for (const [name, render] of Object.entries(cards)) {
  for (const [themeName, theme] of Object.entries(THEMES)) {
    const file = `${name}-${themeName}.svg`;
    const svg = render(data, theme);
    assertWellFormed(file, svg);
    await writeFile(join(OUT_DIR, file), svg, 'utf8');
    console.log(`wrote assets/${file}`);
  }
}

console.log(
  `\n${USERNAME}: ${data.totals.contributions} contributions, ${data.stars} stars, ` +
    `current streak ${data.streaks.current.length}, longest ${data.streaks.longest.length}` +
    ` (accent=${ACCENT}, animate=${ANIMATE})`
);
