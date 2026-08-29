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
 *   CARD_TITLE        Heading on the stats card
 *   ACTIVITY_DAYS     Days in the activity chart (default: 30)
 *   CALENDAR_PALETTE  "github" (default) or "rainbow" for the 3D calendar
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
const CALENDAR_PALETTE = process.env.CALENDAR_PALETTE || 'github';

if (!TOKEN) {
  console.error('GITHUB_TOKEN is required');
  process.exit(1);
}

/* ---------------------------------------------------------- design tokens */

/**
 * One shared geometry + type scale for every card, so the set reads as a
 * single system rather than four unrelated boxes.
 */
const D = {
  half: 430, // side-by-side cards
  full: 880, // full-bleed cards
  pad: 22, // inner padding
  radius: 6, // matches GitHub's own card radius
  head: 62, // baseline where card content starts
  type: { title: 14, label: 12, value: 12, caption: 10, big: 26, huge: 30 },
};

// Primer colour tokens. Borders use the *muted* value so the cards sit
// quietly on the profile page instead of framing themselves.
const THEMES = {
  light: {
    title: '#1f2328',
    text: '#1f2328',
    muted: '#59636e',
    faint: '#818b98',
    border: '#d8dee4',
    divider: '#e4e8ec',
    accent: '#0969da',
    track: '#e4e8ec',
    area: '#0969da',
    areaOpacity: 0.16,
    highlight: '#bc4c00',
    levels: ['#ebedf0', '#9be9a8', '#40c463', '#30a14e', '#216e39'],
    faceTop: 1,
    faceLeft: 0.7,
    faceRight: 0.85,
  },
  dark: {
    title: '#e6edf3',
    text: '#e6edf3',
    muted: '#8b949e',
    faint: '#6e7681',
    border: '#30363d',
    divider: '#21262d',
    accent: '#2f81f7',
    track: '#21262d',
    area: '#2f81f7',
    areaOpacity: 0.22,
    highlight: '#e3742a',
    levels: ['#161b22', '#0e4429', '#006d32', '#26a641', '#39d353'],
    faceTop: 1,
    faceLeft: 0.62,
    faceRight: 0.8,
  },
};

const FONT =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif";

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

const hsl = (h, s, l) => `hsl(${round(h)} ${s}% ${l}%)`;

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

const text = (x, y, str, { size = D.type.value, weight = 400, fill, anchor = 'start', opacity } = {}) =>
  `  <text x="${round(x)}" y="${round(y)}" font-family="${FONT}" font-size="${size}"` +
  ` font-weight="${weight}" fill="${fill}"` +
  (anchor === 'start' ? '' : ` text-anchor="${anchor}"`) +
  (opacity === undefined ? '' : ` opacity="${opacity}"`) +
  `>${esc(str)}</text>`;

/**
 * The single card primitive every asset is built from: same border, radius,
 * padding and header placement, so the cards line up as a set.
 */
const card = (w, h, t, { title, subtitle, body, responsive = false }) => {
  const parts = [
    `  <rect x="0.5" y="0.5" width="${w - 1}" height="${h - 1}" rx="${D.radius}"` +
      ` fill="none" stroke="${t.border}"/>`,
    title
      ? text(D.pad, subtitle ? 34 : 38, title, {
          size: D.type.title,
          weight: 600,
          fill: t.title,
        })
      : null,
    subtitle
      ? text(D.pad, 52, subtitle, { size: D.type.caption, fill: t.muted })
      : null,
    body,
  ].filter(Boolean);

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" ${responsive ? 'width="100%"' : `width="${w}"`}` +
    ` height="${h}" viewBox="0 0 ${w} ${h}" fill="none" role="img"` +
    ` preserveAspectRatio="xMidYMid meet">\n${parts.join('\n')}\n</svg>\n`
  );
};

const ring = (cx, cy, r, fraction, t, stroke = 5) => {
  const c = 2 * Math.PI * r;
  return (
    `  <circle cx="${cx}" cy="${cy}" r="${r}" stroke="${t.track}" stroke-width="${stroke}" fill="none"/>\n` +
    `  <circle cx="${cx}" cy="${cy}" r="${r}" stroke="${t.accent}" stroke-width="${stroke}" fill="none"` +
    ` stroke-linecap="round" stroke-dasharray="${round(c)}"` +
    ` stroke-dashoffset="${round(c * (1 - Math.min(1, fraction)))}"` +
    ` transform="rotate(-90 ${cx} ${cy})"/>`
  );
};

/* ------------------------------------------------------------------ cards */

function statsCard(data, t) {
  const W = D.half;
  const H = 200;
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
  const cx = W - D.pad - 52;

  const body = [
    ...rows.map((r, i) => {
      const y = D.head + 12 + i * 19;
      return (
        text(D.pad, y, r[0], { size: D.type.label, fill: t.muted }) +
        '\n' +
        text(W - D.pad - 122, y, num(r[1]), {
          size: D.type.value,
          weight: 600,
          fill: t.text,
          anchor: 'end',
        })
      );
    }),
    ring(cx, 118, 36, activeDays / elapsed, t, 5),
    text(cx, 116, String(activeDays), {
      size: D.type.big,
      weight: 700,
      fill: t.text,
      anchor: 'middle',
    }),
    text(cx, 132, 'active days', { size: 9, fill: t.muted, anchor: 'middle' }),
    text(cx, 174, `${Math.round((activeDays / elapsed) * 100)}% of ${currentYear}`, {
      size: D.type.caption,
      fill: t.faint,
      anchor: 'middle',
    }),
  ].join('\n');

  return card(W, H, t, { title: TITLE, body });
}

function langsCard(data, t) {
  const W = D.half;
  const H = 200;
  const barW = W - D.pad * 2;
  const barY = D.head + 6;
  const colW = barW / 2;

  let offset = 0;
  const segments = data.languages.map((l) => {
    const w = (l.percent / 100) * barW;
    const seg =
      `  <rect x="${round(D.pad + offset)}" y="${barY}"` +
      ` width="${round(Math.max(w - 1, 0.5))}" height="8" fill="${l.color}"/>`;
    offset += w;
    return seg;
  });

  const legend = data.languages.map((l, i) => {
    const x = D.pad + (i % 2) * colW;
    const y = barY + 40 + Math.floor(i / 2) * 26;
    return [
      `  <circle cx="${round(x + 5)}" cy="${round(y - 4)}" r="5" fill="${l.color}"/>`,
      text(x + 17, y, l.name, { size: D.type.label, weight: 500, fill: t.text }),
      // Right-aligned to a fixed column so proportional glyph widths cannot
      // push the percentage into the language name.
      text(x + colW - 14, y, `${l.percent}%`, {
        size: D.type.caption,
        fill: t.muted,
        anchor: 'end',
      }),
    ].join('\n');
  });

  const body = [
    `  <mask id="bar"><rect x="${D.pad}" y="${barY}" width="${barW}" height="8" rx="4" fill="#fff"/></mask>`,
    '  <g mask="url(#bar)">',
    `  <rect x="${D.pad}" y="${barY}" width="${barW}" height="8" fill="${t.track}"/>`,
    ...segments,
    '  </g>',
    ...legend,
  ].join('\n');

  return card(W, H, t, { title: 'Most Used Languages', body });
}

function streakCard(data, t) {
  const W = D.full;
  const H = 168;
  const { current, longest } = data.streaks;
  const col = W / 3;

  const range = (s) =>
    s.length === 0
      ? 'no active streak'
      : s.start === s.end
        ? pretty(s.start)
        : `${pretty(s.start)} - ${pretty(s.end)}`;

  const panel = (index, value, label, sub) => {
    const cx = col * index + col / 2;
    return [
      text(cx, 108, comma(value), {
        size: D.type.huge,
        weight: 700,
        fill: t.text,
        anchor: 'middle',
      }),
      text(cx, 130, label, {
        size: 11,
        weight: 600,
        fill: t.highlight,
        anchor: 'middle',
      }),
      text(cx, 147, sub, { size: D.type.caption, fill: t.muted, anchor: 'middle' }),
    ].join('\n');
  };

  const body = [
    `  <line x1="${col}" y1="${D.head + 4}" x2="${col}" y2="${H - 22}" stroke="${t.divider}"/>`,
    `  <line x1="${col * 2}" y1="${D.head + 4}" x2="${col * 2}" y2="${H - 22}" stroke="${t.divider}"/>`,
    panel(0, data.totals.contributions, 'TOTAL CONTRIBUTIONS', `${pretty(data.since)} - Present`),
    panel(1, current.length, 'CURRENT STREAK', range(current)),
    panel(2, longest.length, 'LONGEST STREAK', range(longest)),
  ].join('\n');

  return card(W, H, t, { title: 'Contribution Streak', body, responsive: true });
}

function activityCard(data, t) {
  const W = D.full;
  const H = 240;
  const plot = { top: 84, right: D.pad + 8, bottom: 40, left: D.pad + 22 };
  const plotW = W - plot.left - plot.right;
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
      ` stroke="${t.divider}"/>\n` +
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
      })
    );

  const dots = points
    .map(([px, py], i) =>
      series[i].count === 0
        ? null
        : `  <circle cx="${round(px)}" cy="${round(py)}" r="2.5" fill="${t.area}"/>`
    )
    .filter(Boolean);

  const total = series.reduce((a, p) => a + p.count, 0);

  const body = [
    '  <linearGradient id="fade" x1="0" y1="0" x2="0" y2="1">',
    `    <stop offset="0%" stop-color="${t.area}" stop-opacity="${round(t.areaOpacity * 2.5)}"/>`,
    `    <stop offset="100%" stop-color="${t.area}" stop-opacity="0"/>`,
    '  </linearGradient>',
    ...gridLines,
    `  <path d="${area}" fill="url(#fade)"/>`,
    `  <path d="${line}" fill="none" stroke="${t.area}" stroke-width="2"` +
      ' stroke-linecap="round" stroke-linejoin="round"/>',
    ...dots,
    ...xLabels,
  ].join('\n');

  return card(W, H, t, {
    title: 'Contribution Activity',
    subtitle: `Last ${ACTIVITY_DAYS} days · ${comma(total)} contributions · peak ${max} in a day`,
    body,
    responsive: true,
  });
}

/* ------------------------------------------------- 3D contribution calendar */

/**
 * Isometric replacement for github-profile-3d-contrib. Each day is an
 * extruded box on a 53x7 grid, projected with a standard 2:1 isometric
 * transform and painted back-to-front.
 */
function calendarCard(data, t) {
  const W = D.full;
  const HW = 13; // half width of a tile diamond
  const HH = 4.5; // half height; flatter than a true 2:1 isometric so the
  //                 53-week band does not run away down the card
  const MAX_H = 44; // tallest box, in user units
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
      cells.push({ w, d, count, date: iso(date) });
    }
  }

  const level = (c) => (c === 0 ? 0 : Math.min(4, Math.ceil((c / max) * 4)));

  const colorFor = (cell) =>
    CALENDAR_PALETTE === 'rainbow' && cell.count > 0
      ? hsl((cell.w / WEEKS) * 330, 72, 58)
      : t.levels[level(cell.count)];

  // A gentle power curve keeps single-contribution days visible next to a
  // 121-contribution spike.
  const heightFor = (c) => (c === 0 ? 0 : 3 + Math.pow(c / max, 0.6) * MAX_H);

  const px = (w, d) => (w - d) * HW;
  const py = (w, d) => (w + d) * HH;

  // Painter's algorithm: in this projection a larger (w + d) sits nearer the
  // viewer, so drawing in ascending order layers the boxes correctly.
  const ordered = [...cells].sort((a, b) => a.w + a.d - (b.w + b.d) || a.w - b.w);

  const shapes = [];
  for (const cell of ordered) {
    const X = px(cell.w, cell.d);
    const Y = py(cell.w, cell.d);
    const h = heightFor(cell.count);
    const base = colorFor(cell);

    const top = `${X},${round(Y - h)} ${round(X + HW)},${round(Y + HH - h)} ${X},${round(Y + 2 * HH - h)} ${round(X - HW)},${round(Y + HH - h)}`;

    if (h > 0) {
      shapes.push(
        `  <polygon points="${round(X - HW)},${round(Y + HH - h)} ${X},${round(Y + 2 * HH - h)} ${X},${round(Y + 2 * HH)} ${round(X - HW)},${round(Y + HH)}" fill="${shade(base, t.faceLeft)}"/>`,
        `  <polygon points="${X},${round(Y + 2 * HH - h)} ${round(X + HW)},${round(Y + HH - h)} ${round(X + HW)},${round(Y + HH)} ${X},${round(Y + 2 * HH)}" fill="${shade(base, t.faceRight)}"/>`
      );
    }
    shapes.push(`  <polygon points="${top}" fill="${base}"/>`);
  }

  // Fit the projected grid to the card instead of hand-tuning constants.
  const minX = -6 * HW - HW;
  const maxX = (WEEKS - 1) * HW + HW;
  const minY = -MAX_H - 3;
  const maxY = (WEEKS - 1 + 6) * HH + 2 * HH;
  const gridW = maxX - minX;
  const gridH = maxY - minY;
  const avail = W - D.pad * 2;
  const scale = avail / gridW;
  const H = Math.ceil(D.head + 10 + gridH * scale + D.pad + 22);

  // Anchored to the right padding edge: Less, the swatches, then More.
  const swatchEnd = W - D.pad - 34;
  const swatchStart = swatchEnd - (t.levels.length * 15 - 4);
  const legend = t.levels
    .map(
      (c, i) =>
        `  <rect x="${round(swatchStart + i * 15)}" y="${H - 33}" width="11" height="11" rx="2" fill="${c}"/>`
    )
    .join('\n');

  const body = [
    `  <g transform="translate(${round(D.pad - minX * scale)} ${round(D.head + 10 - minY * scale)}) scale(${round(scale)})">`,
    ...shapes,
    '  </g>',
    text(swatchStart - 6, H - 24, 'Less', { size: 9, fill: t.faint, anchor: 'end' }),
    legend,
    text(swatchEnd + 6, H - 24, 'More', { size: 9, fill: t.faint }),
  ].join('\n');

  return card(W, H, t, {
    title: 'Contribution Calendar',
    subtitle: `${pretty(iso(start))} - ${pretty(iso(end))} · ${comma(total)} contributions · peak ${max} in a day`,
    body,
    responsive: true,
  });
}

/* ------------------------------------------------------------------- main */

const data = await fetchStats();
await mkdir(OUT_DIR, { recursive: true });

const cards = {
  stats: statsCard,
  langs: langsCard,
  streak: streakCard,
  activity: activityCard,
  calendar: calendarCard,
};

for (const [name, render] of Object.entries(cards)) {
  for (const [themeName, theme] of Object.entries(THEMES)) {
    await writeFile(join(OUT_DIR, `${name}-${themeName}.svg`), render(data, theme), 'utf8');
    console.log(`wrote assets/${name}-${themeName}.svg`);
  }
}

console.log(
  `\n${USERNAME}: ${data.totals.contributions} contributions, ${data.stars} stars, ` +
    `current streak ${data.streaks.current.length}, longest ${data.streaks.longest.length}`
);
