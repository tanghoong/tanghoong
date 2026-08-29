#!/usr/bin/env node
/**
 * Generates the profile README cards as static SVGs, with no third-party
 * services involved. Everything is derived from the GitHub GraphQL API and
 * written to assets/ so the README only ever references files in this repo.
 *
 * Usage: GITHUB_TOKEN=... USERNAME=tanghoong node scripts/generate-cards.mjs
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

if (!TOKEN) {
  console.error('GITHUB_TOKEN is required');
  process.exit(1);
}

/* ------------------------------------------------------------------ theme */

const THEMES = {
  light: {
    title: '#0969da',
    text: '#1f2328',
    muted: '#59636e',
    border: '#d1d9e0',
    accent: '#0969da',
    ring: '#0969da',
    ringTrack: '#d1d9e0',
    grid: '#d1d9e0',
    area: '#0969da',
    areaOpacity: 0.14,
    fire: '#bc4c00',
  },
  dark: {
    title: '#2f81f7',
    text: '#e6edf3',
    muted: '#8b949e',
    border: '#3d444d',
    accent: '#2f81f7',
    ring: '#2f81f7',
    ringTrack: '#30363d',
    grid: '#30363d',
    area: '#2f81f7',
    areaOpacity: 0.2,
    fire: '#e3742a',
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
        totalRepositoriesWithContributedCommits
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
  let contributedTo = 0;

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
    contributedTo = Math.max(contributedTo, c.totalRepositoriesWithContributedCommits);

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
    contributedTo,
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

const svg = (w, h, body, { responsive = false } = {}) =>
  `<svg xmlns="http://www.w3.org/2000/svg" ${responsive ? 'width="100%"' : `width="${w}"`}` +
  ` height="${h}" viewBox="0 0 ${w} ${h}" fill="none" role="img"` +
  ` preserveAspectRatio="xMidYMid meet">\n${body}\n</svg>\n`;

const frame = (w, h, t) =>
  `  <rect x="0.5" y="0.5" width="${w - 1}" height="${h - 1}" rx="6" fill="none" stroke="${t.border}"/>`;

const text = (x, y, str, { size = 12, weight = 400, fill, anchor = 'start' } = {}) =>
  `  <text x="${x}" y="${y}" font-family="${FONT}" font-size="${size}" font-weight="${weight}"` +
  ` fill="${fill}"${anchor === 'start' ? '' : ` text-anchor="${anchor}"`}>${esc(str)}</text>`;

const ring = (cx, cy, r, fraction, t, stroke = 5) => {
  const c = 2 * Math.PI * r;
  return (
    `  <circle cx="${cx}" cy="${cy}" r="${r}" stroke="${t.ringTrack}" stroke-width="${stroke}" fill="none"/>\n` +
    `  <circle cx="${cx}" cy="${cy}" r="${r}" stroke="${t.ring}" stroke-width="${stroke}" fill="none"` +
    ` stroke-linecap="round" stroke-dasharray="${round(c)}"` +
    ` stroke-dashoffset="${round(c * (1 - Math.min(1, fraction)))}"` +
    ` transform="rotate(-90 ${cx} ${cy})"/>`
  );
};

/* ------------------------------------------------------------------ cards */

function statsCard(data, t) {
  const W = 460;
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

  const body = [
    frame(W, H, t),
    text(25, 33, TITLE, { size: 16, weight: 600, fill: t.title }),
    ...rows.map((r, i) => {
      const y = 66 + i * 21;
      return (
        text(25, y, r[0], { size: 12, fill: t.muted }) +
        '\n' +
        text(300, y, num(r[1]), { size: 12, weight: 600, fill: t.text, anchor: 'end' })
      );
    }),
    ring(378, 108, 38, activeDays / elapsed, t, 6),
    text(378, 106, String(activeDays), { size: 22, weight: 700, fill: t.text, anchor: 'middle' }),
    text(378, 122, 'active days', { size: 9, fill: t.muted, anchor: 'middle' }),
    text(378, 168, `${Math.round((activeDays / elapsed) * 100)}% of ${currentYear}`, {
      size: 10,
      fill: t.muted,
      anchor: 'middle',
    }),
  ].join('\n');

  return svg(W, H, body);
}

function langsCard(data, t) {
  const W = 340;
  const H = 200;
  const barX = 25;
  const barW = W - 50;
  const barY = 52;

  let offset = 0;
  const segments = data.languages.map((l) => {
    const w = (l.percent / 100) * barW;
    const seg =
      `  <rect x="${round(barX + offset)}" y="${barY}"` +
      ` width="${round(Math.max(w - 1, 0.5))}" height="9" rx="2" fill="${l.color}"/>`;
    offset += w;
    return seg;
  });

  const legend = data.languages.map((l, i) => {
    const x = barX + (i % 2) * 148;
    const y = 90 + Math.floor(i / 2) * 26;
    return [
      `  <circle cx="${x + 5}" cy="${y - 4}" r="5" fill="${l.color}"/>`,
      text(x + 17, y, l.name, { size: 12, weight: 600, fill: t.text }),
      // Right-aligned to a fixed column so proportional glyph widths cannot
      // push the percentage into the language name.
      text(x + 128, y, `${l.percent}%`, { size: 11, fill: t.muted, anchor: 'end' }),
    ].join('\n');
  });

  const body = [
    frame(W, H, t),
    text(25, 33, 'Most Used Languages', { size: 16, weight: 600, fill: t.title }),
    `  <mask id="bar"><rect x="${barX}" y="${barY}" width="${barW}" height="9" rx="4.5" fill="#fff"/></mask>`,
    '  <g mask="url(#bar)">',
    `  <rect x="${barX}" y="${barY}" width="${barW}" height="9" fill="${t.ringTrack}"/>`,
    ...segments,
    '  </g>',
    ...legend,
  ].join('\n');

  return svg(W, H, body);
}

function streakCard(data, t) {
  const W = 800;
  const H = 180;
  const { current, longest } = data.streaks;
  const col = W / 3;

  const range = (s) =>
    s.length === 0
      ? 'no active streak'
      : s.start === s.end
        ? pretty(s.start)
        : `${pretty(s.start)} - ${pretty(s.end)}`;

  const panel = (index, value, label, sub, { highlight = false } = {}) => {
    const cx = col * index + col / 2;
    return [
      highlight ? ring(cx, 76, 40, 1, t, 5) : null,
      text(cx, 86, num(value), { size: 30, weight: 700, fill: t.text, anchor: 'middle' }),
      text(cx, highlight ? 138 : 116, label, {
        size: 13,
        weight: 600,
        fill: t.fire,
        anchor: 'middle',
      }),
      text(cx, highlight ? 156 : 136, sub, { size: 11, fill: t.muted, anchor: 'middle' }),
    ]
      .filter(Boolean)
      .join('\n');
  };

  const body = [
    frame(W, H, t),
    `  <line x1="${col}" y1="30" x2="${col}" y2="${H - 30}" stroke="${t.border}"/>`,
    `  <line x1="${col * 2}" y1="30" x2="${col * 2}" y2="${H - 30}" stroke="${t.border}"/>`,
    panel(0, data.totals.contributions, 'Total Contributions', `${pretty(data.since)} - Present`),
    panel(1, current.length, 'Current Streak', range(current), { highlight: true }),
    panel(2, longest.length, 'Longest Streak', range(longest)),
  ].join('\n');

  return svg(W, H, body, { responsive: true });
}

function activityCard(data, t) {
  const W = 880;
  const H = 280;
  const pad = { top: 78, right: 40, bottom: 46, left: 52 };
  const plotW = W - pad.left - pad.right;
  const plotH = H - pad.top - pad.bottom;

  const today = new Date();
  const series = [];
  for (let i = ACTIVITY_DAYS - 1; i >= 0; i--) {
    const d = new Date(
      Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - i)
    );
    series.push({ date: iso(d), count: data.days.get(iso(d)) || 0 });
  }

  const max = Math.max(1, ...series.map((p) => p.count));
  const x = (i) => pad.left + (i / (series.length - 1)) * plotW;
  const y = (v) => pad.top + plotH - (v / max) * plotH;
  const points = series.map((p, i) => [x(i), y(p.count)]);
  const baseline = pad.top + plotH;

  // Catmull-Rom to cubic bezier, clamped so the curve never leaves the plot.
  const clamp = (v) => Math.min(baseline, Math.max(pad.top, v));
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
    const gy = round(pad.top + plotH * f);
    return (
      `  <line x1="${pad.left}" y1="${gy}" x2="${pad.left + plotW}" y2="${gy}"` +
      ` stroke="${t.grid}" stroke-dasharray="3 4"/>\n` +
      text(pad.left - 10, gy + 4, String(Math.round(max * (1 - f))), {
        size: 10,
        fill: t.muted,
        anchor: 'end',
      })
    );
  });

  // Always label the final day, and drop any stepped label that would sit on
  // top of it.
  const step = Math.max(1, Math.round(series.length / 8));
  const last = series.length - 1;
  const minGap = plotW / (series.length - 1) < 3 ? 3 : step * 0.6;
  const xLabels = series
    .map((p, i) => (i === last || (i % step === 0 && last - i > minGap) ? { p, i } : null))
    .filter(Boolean)
    .map(({ p, i }) =>
      text(round(x(i)), baseline + 22, shortDate(p.date), {
        size: 10,
        fill: t.muted,
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
    frame(W, H, t),
    text(30, 38, 'Contribution Activity', { size: 16, weight: 600, fill: t.title }),
    text(30, 58, `Last ${ACTIVITY_DAYS} days - ${total} contributions - peak ${max} in a day`, {
      size: 11,
      fill: t.muted,
    }),
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

  return svg(W, H, body, { responsive: true });
}

/* ------------------------------------------------------------------- main */

const data = await fetchStats();
await mkdir(OUT_DIR, { recursive: true });

const cards = {
  stats: statsCard,
  langs: langsCard,
  streak: streakCard,
  activity: activityCard,
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
