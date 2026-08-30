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
 *   ACTIVITY_WEEKS    Weekly candles in the activity chart (default: 52)
 *   GROWTH_YEARS      Years in the growth chart (default: 2 -- this and last)
 *   ACCENT            "green" (default) or "blue" -- drives every data mark
 *   ANIMATE           "1" (default) or "0" to emit static cards
 *   CALENDAR_STYLE    "clock" (default), "blocks" or "city"
 *   FRAMEWORKS        "1" (default) or "0" to skip the manifest scan
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'assets');

const TOKEN = process.env.GITHUB_TOKEN;
const USERNAME = process.env.USERNAME || 'tanghoong';
const TITLE = process.env.CARD_TITLE || `${USERNAME}'s Performance`;
const ACTIVITY_WEEKS = Number(process.env.ACTIVITY_WEEKS || 52);
const GROWTH_YEARS = Number(process.env.GROWTH_YEARS || 2);
const ACCENT = process.env.ACCENT === 'blue' ? 'blue' : 'green';
const ANIMATE = process.env.ANIMATE !== '0';
const CALENDAR_STYLE = ['blocks', 'city', 'clock'].includes(process.env.CALENDAR_STYLE)
  ? process.env.CALENDAR_STYLE
  : 'clock';
const SCAN_FRAMEWORKS = process.env.FRAMEWORKS !== '0';

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

/**
 * The one deliberate exception to §2's single accent. A candlestick chart is
 * only readable because up and down are opposite colours -- painting a down
 * week in a paler green would destroy the thing the chart exists to show. It
 * is built the same way the accent is (deep on white, vivid on black) so it
 * reads as the accent's counterpart rather than as a second brand colour, and
 * it appears on exactly one card.
 */
const DOWN = { light: [4, 74, 40], dark: [6, 100, 71] };

/** Ink that stays legible on an arbitrary fill -- used by the treemap. */
const inkOn = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.42 ? '#0a0a0c' : '#ffffff';
};

const makeTheme = (mode, base) => {
  const [h, s, l] = SCALES[ACCENT][mode];
  const [dh, ds, dl] = DOWN[mode];
  const shadeAt =
    mode === 'light'
      ? (t) => hslToHex(h, s - (1 - t) * 34, 80 - t * (80 - l))
      : (t) => hslToHex(h, s - (1 - t) * 28, 20 + t * (l - 20));
  return {
    ...base,
    accent: hslToHex(h, s, l),
    down: hslToHex(dh, ds, dl),
    downSoft: hslToHex(dh, ds - 14, mode === 'light' ? dl + 10 : dl - 10),
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
      .bar { animation: bar 420ms ${EASE} both; }
      @keyframes fade { from { opacity: 0; transform: translateY(6px); } }
      @keyframes rise { from { opacity: 0; transform: translateY(12px); } }
      @keyframes grow { from { transform: scaleX(0); } }
      @keyframes bar { from { transform: scaleY(0); } }
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

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

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

/**
 * `partial` is for the aliased manifest batches: one unreadable repository in
 * a batch of 25 comes back as an error alongside 24 perfectly good results, so
 * throwing would discard the batch over a repo the token simply cannot see.
 */
async function gql(query, variables, { partial = false } = {}) {
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
  if (body.errors && !(partial && body.data)) {
    throw new Error(`GraphQL: ${JSON.stringify(body.errors)}`);
  }
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
          name
          stargazerCount
          languages(first: 20, orderBy: { field: SIZE, direction: DESC }) {
            edges { size node { name color } }
          }
        }
      }
    }
  }
`;

/**
 * GitHub has no framework API, so frameworks are read out of the dependency
 * manifests. One aliased query fetches every manifest for a batch of repos, so
 * 300+ repos cost ~13 requests rather than one per file.
 */
const MANIFESTS = {
  pkg: 'package.json',
  req: 'requirements.txt',
  pyproj: 'pyproject.toml',
  composer: 'composer.json',
  cargo: 'Cargo.toml',
  gomod: 'go.mod',
};

/**
 * dependency name -> display name. Only things that shape how a project is
 * built are listed: a framework, runtime, ORM, test runner or major library.
 * Anything unlisted is ignored rather than guessed at, so the chart never
 * claims a stack that is not there.
 */
const NPM_FRAMEWORKS = {
  next: 'Next.js',
  react: 'React',
  'react-native': 'React Native',
  expo: 'Expo',
  vue: 'Vue',
  nuxt: 'Nuxt',
  svelte: 'Svelte',
  '@sveltejs/kit': 'SvelteKit',
  astro: 'Astro',
  '@angular/core': 'Angular',
  'solid-js': 'Solid',
  express: 'Express',
  fastify: 'Fastify',
  hono: 'Hono',
  koa: 'Koa',
  '@nestjs/core': 'NestJS',
  elysia: 'Elysia',
  tailwindcss: 'Tailwind CSS',
  bootstrap: 'Bootstrap',
  '@mui/material': 'MUI',
  electron: 'Electron',
  vite: 'Vite',
  webpack: 'Webpack',
  '@prisma/client': 'Prisma',
  'drizzle-orm': 'Drizzle',
  mongoose: 'Mongoose',
  typeorm: 'TypeORM',
  sequelize: 'Sequelize',
  wrangler: 'Cloudflare Workers',
  '@cloudflare/workers-types': 'Cloudflare Workers',
  firebase: 'Firebase',
  '@supabase/supabase-js': 'Supabase',
  'socket.io': 'Socket.IO',
  jest: 'Jest',
  vitest: 'Vitest',
  '@playwright/test': 'Playwright',
  cypress: 'Cypress',
  three: 'Three.js',
  d3: 'D3',
  'chart.js': 'Chart.js',
  'framer-motion': 'Framer Motion',
  openai: 'OpenAI SDK',
  '@anthropic-ai/sdk': 'Anthropic SDK',
  langchain: 'LangChain',
  'discord.js': 'discord.js',
  telegraf: 'Telegraf',
  puppeteer: 'Puppeteer',
  zod: 'Zod',
  redux: 'Redux',
  '@tanstack/react-query': 'TanStack Query',
};

const PY_FRAMEWORKS = {
  django: 'Django',
  flask: 'Flask',
  fastapi: 'FastAPI',
  streamlit: 'Streamlit',
  gradio: 'Gradio',
  pandas: 'pandas',
  numpy: 'NumPy',
  'scikit-learn': 'scikit-learn',
  torch: 'PyTorch',
  tensorflow: 'TensorFlow',
  transformers: 'Transformers',
  langchain: 'LangChain',
  openai: 'OpenAI SDK',
  anthropic: 'Anthropic SDK',
  scrapy: 'Scrapy',
  beautifulsoup4: 'BeautifulSoup',
  selenium: 'Selenium',
  requests: 'Requests',
  sqlalchemy: 'SQLAlchemy',
  pydantic: 'Pydantic',
  celery: 'Celery',
  pytest: 'pytest',
  matplotlib: 'Matplotlib',
  'opencv-python': 'OpenCV',
  pyqt5: 'PyQt',
  ccxt: 'CCXT',
  'python-telegram-bot': 'python-telegram-bot',
  'discord.py': 'discord.py',
};

const PHP_FRAMEWORKS = {
  'laravel/framework': 'Laravel',
  'laravel/sanctum': 'Laravel',
  'symfony/symfony': 'Symfony',
  'symfony/console': 'Symfony',
  'slim/slim': 'Slim',
  'livewire/livewire': 'Livewire',
  'filament/filament': 'Filament',
  'inertiajs/inertia-laravel': 'Inertia',
  'codeigniter4/framework': 'CodeIgniter',
  'phpunit/phpunit': 'PHPUnit',
};

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
  const repoNames = [];
  const langSizes = new Map();
  const langRepos = new Map();
  for (let cursor = null, more = true; more; ) {
    const repos = (await gql(REPOS_QUERY, { login: USERNAME, cursor })).user.repositories;
    for (const repo of repos.nodes) {
      stars += repo.stargazerCount;
      repoNames.push(repo.name);
      for (const { size, node } of repo.languages.edges) {
        langSizes.set(node.name, (langSizes.get(node.name) || 0) + size);
        langRepos.set(node.name, (langRepos.get(node.name) || 0) + 1);
      }
    }
    more = repos.pageInfo.hasNextPage;
    cursor = repos.pageInfo.endCursor;
  }

  const langBytes = [...langSizes.values()].reduce((a, b) => a + b, 0) || 1;
  // Every language, ranked. The overview card takes the head of this list; the
  // languages card shows the tail that the head hides.
  const languages = [...langSizes.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([name, size]) => ({
      name,
      bytes: size,
      repos: langRepos.get(name),
      percent: round((size / langBytes) * 100),
    }));

  // `public_repos` on the REST profile is public data, so it comes back the
  // same whatever token asked. Comparing it against what we could actually
  // enumerate is the only way to notice an under-scoped token: a repository
  // the token cannot see is not an error, it is simply absent, and the cards
  // render perfectly while describing a slice of the account.
  let visibleRepos = null;
  try {
    const res = await fetch(`https://api.github.com/users/${USERNAME}`, {
      headers: { Authorization: `bearer ${TOKEN}`, 'User-Agent': `${USERNAME}-profile-cards` },
    });
    if (res.ok) visibleRepos = (await res.json()).public_repos;
  } catch {
    // the check is a courtesy, never a reason to fail the run
  }

  return {
    user,
    totals,
    stars,
    languages,
    langBytes,
    repoCount: repoNames.length,
    visibleRepos,
    // Every card built from the repository scan carries this. When the token
    // can see the whole account it is empty and nothing is claimed; when it
    // cannot, the card says so on its own face rather than quietly presenting
    // a slice as the whole. A reader should never have to check the Actions
    // log to know which of the two they are looking at.
    scopeNote:
      visibleRepos !== null && repoNames.length < visibleRepos / 2
        ? ` · ⚠ public repos only (${repoNames.length} of ${visibleRepos} scanned)`
        : '',
    frameworks: SCAN_FRAMEWORKS ? await fetchFrameworks(repoNames) : [],
    days,
    streaks: computeStreaks(days),
    since: iso(createdAt),
  };
}

/**
 * Reads every repo's dependency manifests and counts, per framework, how many
 * repositories declare it. Counting repos rather than lines is what makes the
 * number mean "how often I reach for this" instead of "how big that project
 * happened to be".
 */
async function fetchFrameworks(repoNames) {
  const fields = Object.entries(MANIFESTS)
    .map(([key, file]) => `${key}: object(expression: "HEAD:${file}") { ... on Blob { text } }`)
    .join(' ');

  const counts = new Map();
  const BATCH = 25;
  for (let i = 0; i < repoNames.length; i += BATCH) {
    const batch = repoNames.slice(i, i + BATCH);
    const query =
      `query {\n` +
      batch
        .map(
          (name, j) =>
            `  r${j}: repository(owner: ${JSON.stringify(USERNAME)},` +
            ` name: ${JSON.stringify(name)}) { ${fields} }`
        )
        .join('\n') +
      `\n}`;

    let data;
    try {
      data = await gql(query, {}, { partial: true });
    } catch (err) {
      // A single unreadable repo must not take the whole run down; the chart
      // degrades to "the ones we could read".
      console.warn(`framework scan: batch ${i / BATCH} failed -- ${err.message.slice(0, 120)}`);
      continue;
    }

    for (const repo of Object.values(data)) {
      if (!repo) continue;
      const seen = new Set();
      const add = (display) => {
        if (seen.has(display)) return;
        seen.add(display);
        counts.set(display, (counts.get(display) || 0) + 1);
      };

      for (const [text, table] of [
        [repo.pkg?.text, NPM_FRAMEWORKS],
        [repo.composer?.text, PHP_FRAMEWORKS],
      ]) {
        if (!text) continue;
        try {
          const json = JSON.parse(text);
          const deps = {
            ...json.dependencies,
            ...json.devDependencies,
            ...json.require,
            ...json['require-dev'],
          };
          for (const dep of Object.keys(deps)) if (table[dep]) add(table[dep]);
        } catch {
          // an unparseable manifest simply contributes nothing
        }
      }

      // requirements.txt and pyproject.toml have no shared grammar worth
      // parsing, so both are reduced to their identifier tokens and matched
      // whole -- "requests" hits, "requests-oauthlib" does not.
      const py = `${repo.req?.text || ''}\n${repo.pyproj?.text || ''}`;
      if (py.trim()) {
        const tokens = new Set(py.toLowerCase().split(/[^a-z0-9._-]+/));
        for (const [dep, display] of Object.entries(PY_FRAMEWORKS)) {
          if (tokens.has(dep)) add(display);
        }
      }

      if (repo.cargo?.text) add('Cargo');
      if (repo.gomod?.text) add('Go modules');
    }
  }

  return [...counts.entries()]
    .map(([name, repos]) => ({ name, repos }))
    .sort((a, b) => b.repos - a.repos || a.name.localeCompare(b.name));
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
  // One baseline for every panel title on a card. Deciding per panel meant a
  // card where only one side had a subtitle -- which is exactly what happens
  // when the scan is degraded and only the languages panel carries a warning
  // -- put its two titles 4px out of line with each other.
  const titleY = heads.some((p) => p.subtitle) ? 36 : 40;

  const parts = [
    ANIMATE ? `  <style>${motionBlock(css)}\n  </style>` : null,
    // §5 and §0.4 rule 5: separation by hairline over an elevated surface,
    // never by shadow.
    `  <rect x="0.5" y="0.5" width="${W - 1}" height="${h - 1}" rx="${D.radius}"` +
      ` fill="${t.surface}" stroke="${t.hairline}" stroke-opacity="${t.hairlineOpacity}"/>`,
    ...heads.flatMap((p, i) =>
      [
        p.title
          ? text(p.x, titleY, p.title, {
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
  // The full ranking lives on the languages card; this is only its head.
  const top = data.languages.slice(0, 6);
  const n = top.length;
  const langColor = (i) => t.langAt(i, n);

  let offset = 0;
  const segments = top.map((l, i) => {
    const w = (l.percent / 100) * panelW;
    const seg =
      `  <rect x="${round(R + offset)}" y="${barY}"` +
      ` width="${round(Math.max(w - 1, 0.5))}" height="8" fill="${langColor(i)}"/>`;
    offset += w;
    return seg;
  });

  const legend = top.map((l, i) => {
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
      // The subtitle exists only in the degraded case, so a fully scanned card
      // keeps both panel titles on the same baseline.
      { x: R, title: 'Most Used Languages', subtitle: data.scopeNote.replace(/^ · /, '') },
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

/**
 * A candlestick chart over WEEKS, built the way a weekly candle is built from
 * daily prices: the seven daily contribution counts are the ticks, open is the
 * week's first day, close its last, and the wick spans its quietest and busiest
 * day. Fifty-two of them, so the chart carries a year at a density where the
 * week-to-week movement is actually visible.
 *
 * Two earlier attempts are worth recording, because both failed for reasons
 * that are easy to walk back into:
 *
 *   Rolling 7-day totals. A rolling window double-counts every spike -- a busy
 *   day enters the window as a green candle and seven days later leaves it as a
 *   red one of almost the same height -- so the chart alternated up/down/up/down
 *   through the busiest stretch of the year and reported reversals that never
 *   happened. The echo comes from the OVERLAP, not from the period length.
 *
 *   Monthly candles. Correct, but eighteen of them across the card is too
 *   coarse to read: a year of work compresses into a handful of bodies and the
 *   variation that makes the chart worth drawing disappears.
 *
 * Non-overlapping weeks fix both. Every contribution is counted once, in
 * exactly one candle, and there are enough candles to show a shape.
 *
 * This is the one card allowed a second colour (03-DESIGN-SYSTEM.md §2), and
 * direction is additionally encoded as hollow-vs-solid so it survives colour
 * blindness and greyscale.
 */
function activityCard(data, t) {
  const H = 268;
  const plot = { top: 92, right: D.pad + 6, bottom: 46, left: D.pad + 30 };
  const plotW = D.w - plot.left - plot.right;
  const plotH = H - plot.top - plot.bottom;

  const DAY = 86400000;
  const now = new Date();
  const todayUTC = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const thisSunday = todayUTC - new Date(todayUTC).getUTCDay() * DAY;

  const candles = [];
  for (let w = ACTIVITY_WEEKS - 1; w >= 0; w--) {
    const start = thisSunday - w * 7 * DAY;
    const ticks = [];
    for (let d = 0; d < 7 && start + d * DAY <= todayUTC; d++) {
      ticks.push(data.days.get(iso(new Date(start + d * DAY))) || 0);
    }
    if (!ticks.length) continue;
    candles.push({
      start: iso(new Date(start)),
      open: ticks[0],
      close: ticks.at(-1),
      high: Math.max(...ticks),
      low: Math.min(...ticks),
      sum: ticks.reduce((a, b) => a + b, 0),
    });
  }

  const hi = Math.max(1, ...candles.map((c) => c.high));
  const slot = plotW / candles.length;
  const bodyW = Math.min(slot * 0.6, 12);
  const cxOf = (i) => plot.left + slot * i + slot / 2;
  // Zero is the true floor of a contribution count, so the axis starts there
  // rather than at the series minimum -- a zoomed baseline would exaggerate
  // every wobble.
  const y = (v) => plot.top + plotH - (v / hi) * plotH;

  const gridLines = [0, 0.5, 1].map((f) => {
    const gy = round(plot.top + plotH * f);
    return (
      `  <line x1="${plot.left}" y1="${gy}" x2="${round(plot.left + plotW)}" y2="${gy}"` +
      ` stroke="${t.hairline}" stroke-opacity="${t.softOpacity}"/>\n` +
      text(plot.left - 10, gy + 3.5, String(Math.round(hi * (1 - f))), {
        size: 9,
        fill: t.faint,
        anchor: 'end',
      })
    );
  });

  // Up is hollow, down is solid -- the original Japanese convention, and here
  // it is a requirement rather than a flourish. The accent and its red
  // counterpart sit at almost the same luminance (1.15:1 in light, 1.95:1 in
  // dark), so to a red-green colour-blind reader they are the same grey and
  // the chart says nothing at all. Body fill carries the direction a second
  // time, independently of hue, which costs nothing and fixes that outright.
  const sticks = candles.map((c, i) => {
    const up = c.close >= c.open;
    const stroke = up ? t.accent : t.down;
    const cx = round(cxOf(i));
    const top = round(y(Math.max(c.open, c.close)));
    const h = Math.max(1.5, round(Math.abs(y(c.open) - y(c.close))));
    // Below about 4px a hollow body is all outline and reads as a smudge, so a
    // near-flat week falls back to solid -- there is no direction worth
    // encoding in it anyway.
    const hollow = up && h >= 4;
    const delay = 0.1 + (i / candles.length) * 0.7;
    return (
      `  <g${anim('rise', delay)}>\n` +
      `    <line x1="${cx}" y1="${round(y(c.high))}" x2="${cx}" y2="${round(y(c.low))}"` +
      ` stroke="${stroke}" stroke-width="1.2" stroke-linecap="round"/>\n` +
      `    <rect x="${round(cx - bodyW / 2)}" y="${top}" width="${round(bodyW)}"` +
      ` height="${h}" rx="1" fill="${hollow ? t.surface : stroke}"` +
      (hollow ? ` stroke="${stroke}" stroke-width="1.3"` : '') +
      `/>\n` +
      `  </g>`
    );
  });

  // A 4-week average of the closes, the way a chart carries its moving
  // average: neutral and thin, guiding the eye without competing.
  const MA = 4;
  const maPoints = candles
    .map((c, i) => {
      if (i < MA - 1) return null;
      const mean = candles.slice(i - MA + 1, i + 1).reduce((a, k) => a + k.close, 0) / MA;
      return `${round(cxOf(i))} ${round(y(mean))}`;
    })
    .filter(Boolean);
  const maLine = maPoints.length
    ? `  <polyline points="${maPoints.join(' ')}" fill="none" stroke="${t.faint}"` +
      ` stroke-width="1.5" stroke-opacity="0.5" stroke-linecap="round" stroke-linejoin="round"` +
      ` pathLength="1" stroke-dasharray="1" stroke-dashoffset="0"${anim('draw', 0.5)}/>`
    : null;

  // One label per month, on the first week that opens in it; the year only
  // where it changes, so the axis says which January without repeating itself.
  const xLabels = candles.flatMap((c, i) => {
    const month = c.start.slice(0, 7);
    if (i > 0 && candles[i - 1].start.slice(0, 7) === month) return [];
    const [yr, mo] = month.split('-').map(Number);
    const out = [
      text(cxOf(i), plot.top + plotH + 20, MONTHS[mo - 1], {
        size: 9,
        fill: t.faint,
        anchor: 'middle',
        cls: 'fade',
        delay: 0.85 + (i / candles.length) * 0.3,
      }),
    ];
    if (i === 0 || Number(candles[i - 1].start.slice(0, 4)) !== yr) {
      out.push(
        text(cxOf(i), plot.top + plotH + 32, String(yr), {
          size: 8.5,
          weight: 600,
          fill: t.faint,
          anchor: 'middle',
          cls: 'fade',
          delay: 0.9 + (i / candles.length) * 0.3,
        })
      );
    }
    return out;
  });

  // Legend: two miniature candles, so the colour rule needs no sentence. It
  // sits beside the header rather than under the plot, where it landed on top
  // of the last month labels.
  const legendX = D.w - D.pad - 92;
  const key = ['up', 'down'].flatMap((dir, i) => {
    const x = legendX + i * 50;
    const up = dir === 'up';
    const stroke = up ? t.accent : t.down;
    return [
      `  <line x1="${x + 4}" y1="30" x2="${x + 4}" y2="44" stroke="${stroke}" stroke-width="1.4"${anim('fade', 1.2)}/>`,
      `  <rect x="${x}" y="32" width="8" height="10" rx="1.5" fill="${up ? t.surface : stroke}"` +
        (up ? ` stroke="${stroke}" stroke-width="1.6"` : '') +
        `${anim('fade', 1.2)}/>`,
      text(x + 14, 41, dir, { size: 9, fill: t.faint, cls: 'fade', delay: 1.22 }),
    ];
  });

  const ups = candles.filter((c) => c.close >= c.open).length;
  const total = candles.reduce((a, c) => a + c.sum, 0);

  return card(H, t, {
    title: 'Contribution Activity',
    subtitle:
      `Last ${candles.length} weeks · ${comma(total)} contributions · one candle per week, ` +
      `open = first day, close = last, wick = quietest to busiest day · ` +
      `${ups} up / ${candles.length - ups} down`,
    body: [...gridLines, ...sticks, maLine, ...xLabels, ...key].filter(Boolean).join('\n'),
  });
}

/**
 * Two views the other cards cannot show, sharing one card: how this year is
 * tracking against last, and the weekday habit underneath it. Both are derived
 * from `days`, which is already in memory, so neither costs an API call.
 *
 * The growth panel used to run the whole account history, which meant a decade
 * of near-empty stubs squeezing the only two years anyone reads into the last
 * inch of the axis. It is now the current year against the previous one, drawn
 * horizontally so the two totals are compared along the card's long edge --
 * where there is room for the numbers to sit beside their bars.
 */
function rhythmCard(data, t) {
  const H = 208;
  const mid = D.w / 2;
  const L = D.pad;
  const R = mid + D.pad;
  const panelW = mid - D.pad * 2;
  const top = 88;
  const baseline = H - 44;
  const plotH = baseline - top;

  const byYear = new Map();
  const byWeekday = [0, 0, 0, 0, 0, 0, 0];
  for (const [date, count] of data.days) {
    const year = Number(date.slice(0, 4));
    byYear.set(year, (byYear.get(year) || 0) + count);
    byWeekday[new Date(`${date}T00:00:00Z`).getUTCDay()] += count;
  }

  /** Shade tracks value, so a bar's colour and length say the same thing. */
  const barFill = (v, mx) => t.shadeAt(0.4 + 0.6 * (v / mx));

  /* ---- left: this year against last, newest on top ---- */

  const now = new Date();
  const thisYear = now.getUTCFullYear();
  // Newest first, so 2026 is the top row and the reader meets the current year
  // before its predecessor.
  const shown = [];
  for (let y = thisYear; y > thisYear - GROWTH_YEARS; y--) shown.push([y, byYear.get(y) || 0]);

  // The current year is only partly run, so its bar is measured against a
  // whole one. The remainder is drawn as a faint pace marker rather than left
  // out, which is the only honest way to put a part-year beside a full one.
  const dayOfYear =
    Math.floor((Date.UTC(thisYear, now.getUTCMonth(), now.getUTCDate()) - Date.UTC(thisYear, 0, 1)) / 86400000) + 1;
  const yearLen = (thisYear % 4 === 0 && thisYear % 100 !== 0) || thisYear % 400 === 0 ? 366 : 365;
  const pace = Math.round(((byYear.get(thisYear) || 0) / dayOfYear) * yearLen);

  const growthMax = Math.max(1, pace, ...shown.map((s) => s[1]));
  const trackX = L + 44;
  const trackW = panelW - 44;
  const rowH = 26;
  const gap = 18;

  const growth = shown.flatMap(([year, v], i) => {
    const y = top + 6 + i * (rowH + gap);
    const w = (v / growthMax) * trackW;
    const delay = 0.12 + i * 0.08;
    const out = [
      text(L, y + rowH / 2 + 4, String(year), {
        size: D.type.label,
        weight: 600,
        fill: year === thisYear ? t.text : t.muted,
        cls: 'fade',
        delay,
      }),
      // The empty track carries the eye to the end of the axis, so a short bar
      // reads as "less of the same scale" rather than as a truncated one.
      `  <rect x="${round(trackX)}" y="${round(y)}" width="${round(trackW)}"` +
        ` height="${rowH}" rx="${rowH / 2}" fill="${t.track}"/>`,
    ];

    if (year === thisYear && pace > v) {
      out.push(
        `  <rect x="${round(trackX)}" y="${round(y)}" width="${round((pace / growthMax) * trackW)}"` +
          ` height="${rowH}" rx="${rowH / 2}" fill="none" stroke="${t.accent}"` +
          ` stroke-opacity="0.45" stroke-width="1" stroke-dasharray="3 3"` +
          anim('fade', delay + 0.3) +
          '/>'
      );
    }

    out.push(
      `  <rect x="${round(trackX)}" y="${round(y)}" width="${round(Math.max(w, v > 0 ? rowH : 0))}"` +
        ` height="${rowH}" rx="${rowH / 2}" fill="${barFill(v, growthMax)}"` +
        anim('grow', delay, `transform-origin:${round(trackX)}px ${round(y + rowH / 2)}px`) +
        '/>'
    );

    // Inside the bar when it is long enough to hold the figure, just past its
    // end when it is not -- so the number never straddles the edge.
    const inside = w > 64;
    out.push(
      text(inside ? trackX + w - 10 : trackX + Math.max(w, rowH) + 10, y + rowH / 2 + 4, comma(v), {
        size: D.type.label,
        weight: 600,
        fill: inside ? inkOn(barFill(v, growthMax)) : t.muted,
        anchor: inside ? 'end' : 'start',
        tabular: true,
        cls: 'fade',
        delay: delay + 0.18,
      })
    );
    return out;
  });

  const last = byYear.get(thisYear - 1) || 0;
  const delta = last ? Math.round((pace / last - 1) * 100) : null;
  const growthSub =
    `${dayOfYear} days in · on pace for ${comma(pace)}` +
    (delta === null ? '' : ` · ${delta >= 0 ? '+' : ''}${delta}% vs ${thisYear - 1}`);

  /* ---- right: the weekday habit, unchanged ---- */

  const dowMax = Math.max(1, ...byWeekday);
  const slot = panelW / 7;
  const bw = Math.min(slot * 0.62, 40);
  const weekly = byWeekday.flatMap((v, i) => {
    const cx = R + slot * i + slot / 2;
    const h = (v / dowMax) * plotH;
    const y = baseline - h;
    const delay = 0.12 + i * 0.04;
    return [
      `  <rect x="${round(cx - bw / 2)}" y="${round(y)}" width="${round(bw)}"` +
        ` height="${round(Math.max(h, v > 0 ? 3 : 0))}" rx="2" fill="${barFill(v, dowMax)}"` +
        anim('bar', delay, `transform-origin:${round(cx)}px ${baseline}px`) +
        '/>',
      text(cx, baseline + 16, DOW[i], {
        size: 9,
        fill: t.faint,
        anchor: 'middle',
        cls: 'fade',
        delay: delay + 0.04,
      }),
      text(cx, round(y) - 6, num(v), {
        size: 9,
        weight: 600,
        fill: t.muted,
        anchor: 'middle',
        cls: 'fade',
        delay: delay + 0.06,
      }),
    ];
  });

  const totalAll = byWeekday.reduce((a, b) => a + b, 0) || 1;
  const weekend = byWeekday[0] + byWeekday[6];
  const peakDay = byWeekday.indexOf(dowMax);

  const body = [
    `  <line x1="${mid}" y1="${D.head - 34}" x2="${mid}" y2="${H - 24}" stroke="${t.hairline}" stroke-opacity="${t.softOpacity}"/>`,
    `  <line x1="${R}" y1="${baseline}" x2="${R + panelW}" y2="${baseline}" stroke="${t.hairline}" stroke-opacity="${t.softOpacity}"/>`,
    ...growth,
    ...weekly,
  ].join('\n');

  return card(H, t, {
    panels: [
      { x: L, title: 'Contribution Growth', subtitle: growthSub },
      {
        x: R,
        title: 'Weekly Rhythm',
        subtitle: `${DOW[peakDay]} is the busiest day · ${Math.round((weekend / totalAll) * 100)}% on weekends`,
      },
    ],
    body,
  });
}

/* ------------------------------------------------- languages & frameworks */

/**
 * The whole language ranking, not just the head of it that fits on the
 * overview card. The stacked bar is every language at once; the grid names the
 * top 18 with both its share of bytes and how many repositories it appears in,
 * because those two say different things -- Python is a third of the bytes in
 * 39 repos, Shell is a rounding error spread across 36.
 */
function languagesCard(data, t) {
  const langs = data.languages;
  const inner = D.w - D.pad * 2;
  const barY = 76;
  const GRID_ROWS = 6;
  const GRID_COLS = 3;
  const shown = langs.slice(0, GRID_ROWS * GRID_COLS);
  const rest = langs.slice(shown.length);
  const H = barY + 34 + GRID_ROWS * 22 + (rest.length ? 34 : 12);

  // One ramp across the whole ranking, flattening out in the tail so the long
  // list of sub-1% languages does not fade to invisible.
  const rampAt = (i) => t.shadeAt(1 - Math.min(i, 15) / 15 * 0.82);

  let offset = 0;
  const segments = langs.map((l, i) => {
    const w = (l.percent / 100) * inner;
    const seg =
      `  <rect x="${round(D.pad + offset)}" y="${barY}"` +
      ` width="${round(Math.max(w - 0.5, 0.4))}" height="10" fill="${rampAt(i)}"/>`;
    offset += w;
    return seg;
  });

  const colW = inner / GRID_COLS;
  const legend = shown.flatMap((l, i) => {
    const x = D.pad + (i % GRID_COLS) * colW;
    const y = barY + 46 + Math.floor(i / GRID_COLS) * 22;
    const d = 0.2 + i * 0.025;
    return [
      `  <circle cx="${round(x + 5)}" cy="${round(y - 4)}" r="5" fill="${rampAt(i)}"${anim('fade', d)}/>`,
      text(x + 17, y, l.name, {
        size: D.type.label,
        weight: 500,
        fill: t.text,
        cls: 'fade',
        delay: d,
      }),
      // Right-aligned to a fixed column so proportional glyphs cannot push the
      // figures into the name.
      text(x + colW - 16, y, `${l.percent < 0.1 ? '<0.1' : l.percent}% · ${l.repos}×`, {
        size: D.type.caption,
        fill: t.muted,
        anchor: 'end',
        cls: 'fade',
        delay: d + 0.03,
      }),
    ];
  });

  // The tail, named rather than counted: "+18 more" tells you nothing, the
  // names tell you Ruby is in there at 0.05% and not worth a legend row.
  const tail = [];
  if (rest.length) {
    let line = '';
    for (const l of rest) {
      const next = line ? `${line}, ${l.name}` : l.name;
      if (next.length > 108) {
        line = `${line}, +${rest.length - line.split(', ').length} others`;
        break;
      }
      line = next;
    }
    const cut = rest[0].percent;
    tail.push(
      text(D.pad, H - 16, `${rest.length} more at ${cut > 0 ? cut : '<0.01'}% or less: ${line}`, {
        size: D.type.caption,
        fill: t.faint,
        cls: 'fade',
        delay: 0.7,
      })
    );
  }

  const mb = data.langBytes / 1e6;

  return card(H, t, {
    title: 'All Languages',
    subtitle:
      `${langs.length} languages · ${mb >= 10 ? Math.round(mb) : round(mb)} MB across ` +
      `${data.repoCount} repositories · % of bytes, × = repositories using it` + data.scopeNote,
    css: `\n      .grow-bar { animation: grow 620ms ${EASE} 120ms both; }`,
    body: [
      `  <mask id="langbar"><rect x="${D.pad}" y="${barY}" width="${inner}" height="10" rx="5" fill="#fff"/></mask>`,
      `  <g mask="url(#langbar)"${anim('grow-bar', 0, `transform-origin:${D.pad}px ${barY + 5}px`)}>`,
      `  <rect x="${D.pad}" y="${barY}" width="${inner}" height="10" fill="${t.track}"/>`,
      ...segments,
      '  </g>',
      ...legend,
      ...tail,
    ].join('\n'),
  });
}

/**
 * Squarified treemap (Bruls, Huizing & van Wijk). Lays items out largest-first
 * into rows chosen to keep every rectangle as close to square as it can, which
 * is what makes the areas comparable by eye.
 */
function squarify(items, x0, y0, w0, h0) {
  const total = items.reduce((a, i) => a + i.value, 0) || 1;
  const scale = (w0 * h0) / total;
  const queue = items.map((i) => ({ ...i, area: i.value * scale }));

  let [x, y, w, h] = [x0, y0, w0, h0];
  const placed = [];

  /** Aspect ratio of the worst rectangle in `row` if laid along `len`. */
  const worst = (row, len) => {
    const sum = row.reduce((a, r) => a + r.area, 0);
    if (sum <= 0 || len <= 0) return Infinity;
    const max = Math.max(...row.map((r) => r.area));
    const min = Math.min(...row.map((r) => r.area));
    return Math.max((len * len * max) / (sum * sum), (sum * sum) / (len * len * min));
  };

  const flush = (row) => {
    const sum = row.reduce((a, r) => a + r.area, 0);
    if (sum <= 0) return;
    if (w >= h) {
      // The short side is the height, so the row becomes a column.
      const colW = Math.min(sum / h, w);
      let cy = y;
      for (const it of row) {
        const ih = it.area / colW;
        placed.push({ ...it, x, y: cy, w: colW, h: ih });
        cy += ih;
      }
      x += colW;
      w -= colW;
    } else {
      const rowH = Math.min(sum / w, h);
      let cx = x;
      for (const it of row) {
        const iw = it.area / rowH;
        placed.push({ ...it, x: cx, y, w: iw, h: rowH });
        cx += iw;
      }
      y += rowH;
      h -= rowH;
    }
  };

  let row = [];
  for (const it of queue) {
    const len = Math.min(w, h);
    if (row.length === 0 || worst([...row, it], len) <= worst(row, len)) {
      row.push(it);
    } else {
      flush(row);
      row = [it];
    }
  }
  if (row.length) flush(row);
  return placed;
}

/**
 * What the code is actually built with, which no GitHub API reports: every
 * repo's dependency manifests are read and each framework is counted once per
 * repository. Area is that count, so the biggest box is the thing reached for
 * most often -- and the ranking runs largest-first from the top left, the way
 * the squarified layout emits it.
 */
function frameworksCard(data, t) {
  const inner = D.w - D.pad * 2;
  const plotY = 84;
  const plotH = 232;
  const H = plotY + plotH + 40;
  const GAP = 3;

  /** Splits a multi-word name at the point that leaves the two halves evenest. */
  const wrap = (name) => {
    const parts = name.split(' ');
    if (parts.length < 2) return null;
    let at = 1;
    let best = Infinity;
    for (let i = 1; i < parts.length; i++) {
      const diff = Math.abs(parts.slice(0, i).join(' ').length - parts.slice(i).join(' ').length);
      if (diff < best) {
        best = diff;
        at = i;
      }
    }
    return [parts.slice(0, at).join(' '), parts.slice(at).join(' ')];
  };

  /**
   * How, if at all, this tile can carry its own name. Tier 1 is the 11px
   * stacked label with a count under it; tier 2 is 9px centred, on one line or
   * two. Wrapping matters more than it looks: "Cloudflare Workers" needs 104px
   * on one line and 63px on two, which is the difference between the card
   * showing six frameworks and showing fourteen.
   */
  const labelPlan = (b, w, h) => {
    if (h >= 36 && b.name.length * 6.2 + 18 < w) return { tier: 1, lines: [b.name] };
    if (h >= 20 && b.name.length * 5.1 + 12 < w) return { tier: 2, lines: [b.name] };
    const two = wrap(b.name);
    if (two && h >= 30 && Math.max(...two.map((l) => l.length)) * 5.1 + 12 < w) {
      return { tier: 2, lines: two };
    }
    return null;
  };

  // A tile showing a bare "1" tells the reader nothing -- it was the clearest
  // fault in the first version of this card. So the item count is not fixed:
  // it drops until every tile in the layout can carry its own name, and
  // whatever will not fit is named in the footer instead.
  let top = [];
  let boxes = [];
  for (let n = Math.min(14, data.frameworks.length); n >= 4; n--) {
    const candidate = data.frameworks.slice(0, n);
    const laid = squarify(
      candidate.map((f) => ({ ...f, value: f.repos })),
      D.pad,
      plotY,
      inner,
      plotH
    );
    top = candidate;
    boxes = laid;
    if (laid.every((b) => labelPlan(b, b.w - GAP, b.h - GAP))) break;
  }

  if (!top.length) {
    return card(plotY + 60, t, {
      title: 'Frameworks & Tooling',
      subtitle: 'No dependency manifests found',
      body: text(D.pad, plotY + 20, 'Nothing to show yet.', { size: D.type.label, fill: t.faint }),
    });
  }

  const n = boxes.length;
  const cells = boxes.flatMap((b, i) => {
    const fill = t.shadeAt(1 - (i / Math.max(1, n - 1)) * 0.8);
    const ink = inkOn(fill);
    const w = Math.max(0, b.w - GAP);
    const h = Math.max(0, b.h - GAP);
    const r = Math.min(10, w / 3, h / 3);
    const out = [
      `  <rect x="${round(b.x)}" y="${round(b.y)}" width="${round(w)}" height="${round(h)}"` +
        ` rx="${round(Math.max(r, 0))}" fill="${fill}"${anim('rise', 0.1 + i * 0.035)}/>`,
    ];
    // Labels only where they fit whole; a clipped framework name is worse than
    // no name, and the legend-free layout depends on every visible word being
    // complete. The item count above guarantees a tier, so no tile can end up
    // as an unexplained number.
    const d = 0.3 + i * 0.035;
    const plan = labelPlan(b, w, h);
    if (plan?.tier === 1) {
      out.push(
        text(b.x + 9, b.y + 20, b.name, { size: 11, weight: 600, fill: ink, cls: 'fade', delay: d }),
        text(b.x + 9, b.y + 35, `${b.repos} repos`, {
          size: 9,
          fill: ink,
          cls: 'fade',
          delay: d + 0.04,
        })
      );
    } else if (plan?.tier === 2) {
      // The whole label block is centred on the tile: name lines first, then
      // the count if there is still room under them.
      const showCount = h >= plan.lines.length * 11 + 14;
      const blockH = plan.lines.length * 11 + (showCount ? 11 : 0);
      let ty = b.y + h / 2 - blockH / 2 + 9;
      for (const line of plan.lines) {
        out.push(
          text(b.x + w / 2, ty, line, {
            size: 9,
            weight: 600,
            fill: ink,
            anchor: 'middle',
            cls: 'fade',
            delay: d,
          })
        );
        ty += 11;
      }
      if (showCount) {
        out.push(
          text(b.x + w / 2, ty, String(b.repos), {
            size: 8.5,
            fill: ink,
            anchor: 'middle',
            tabular: true,
            cls: 'fade',
            delay: d + 0.04,
          })
        );
      }
    }
    return out.filter(Boolean);
  });

  // The tail needs to say WHY it is a tail. "Also: Webpack" left a reader
  // guessing; naming the threshold it fell under does not.
  const hidden = data.frameworks.slice(top.length);
  const cutoff = hidden.length ? hidden[0].repos : 0;
  const named = hidden.slice(0, 12).map((f) => f.name).join(', ');
  const footer = hidden.length
    ? text(
        D.pad,
        H - 16,
        `${hidden.length} more too small to plot, each in ${cutoff} ` +
          `${cutoff === 1 ? 'repository' : 'repositories'} or fewer: ${named}` +
          (hidden.length > 12 ? `, +${hidden.length - 12} others` : ''),
        { size: D.type.caption, fill: t.faint, cls: 'fade', delay: 0.9 }
      )
    : null;

  return card(H, t, {
    title: 'Frameworks & Tooling',
    subtitle:
      `${data.frameworks.length} detected · box area = repositories that depend on it · ` +
      `read from each repo's dependency manifests` + data.scopeNote,
    body: [...cells, footer].filter(Boolean).join('\n'),
  });
}

/* --------------------------------------------------------- ability radar */

/**
 * Six axes chosen to be things a person can actually be strong or weak at,
 * rather than six restatements of "writes a lot of code". They have to be
 * roughly disjoint or the radar just measures volume twice.
 */
const ABILITY_AXES = ['Frontend', 'Backend', 'Data & AI', 'Infra & DevOps', 'Systems', 'Testing'];

/**
 * language -> { axis: weight }. A language that genuinely serves two axes
 * splits its weight instead of being forced into one: Python really is both
 * the backend and the data language here, and pretending otherwise would move
 * 32MB of evidence onto whichever axis won the coin toss.
 *
 * Testing has no entry anywhere, on purpose -- test code is written in the
 * same languages as the thing it tests, so bytes cannot see it. That is why
 * the score below takes the stronger of two channels rather than their mean.
 */
const LANG_AXIS = {
  TypeScript: { Frontend: 0.75, Backend: 0.25 },
  JavaScript: { Frontend: 0.75, Backend: 0.25 },
  HTML: { Frontend: 1 },
  CSS: { Frontend: 1 },
  SCSS: { Frontend: 1 },
  Vue: { Frontend: 1 },
  Astro: { Frontend: 1 },
  Svelte: { Frontend: 1 },
  MDX: { Frontend: 1 },
  Blade: { Frontend: 1 },
  Twig: { Frontend: 1 },
  Mako: { Frontend: 1 },
  Jinja: { Frontend: 1 },
  Slim: { Frontend: 1 },
  PHP: { Backend: 1 },
  Hack: { Backend: 1 },
  PLpgSQL: { Backend: 1 },
  Ruby: { Backend: 1 },
  Java: { Backend: 1 },
  Python: { Backend: 0.45, 'Data & AI': 0.55 },
  'Jupyter Notebook': { 'Data & AI': 1 },
  Cython: { 'Data & AI': 0.5, Systems: 0.5 },
  Go: { Backend: 0.5, Systems: 0.5 },
  Kotlin: { Backend: 0.5, Systems: 0.5 },
  Rust: { Systems: 1 },
  C: { Systems: 1 },
  'C++': { Systems: 1 },
  Assembly: { Systems: 1 },
  Shell: { 'Infra & DevOps': 1 },
  PowerShell: { 'Infra & DevOps': 1 },
  Batchfile: { 'Infra & DevOps': 1 },
  Dockerfile: { 'Infra & DevOps': 1 },
  Makefile: { 'Infra & DevOps': 1 },
  HCL: { 'Infra & DevOps': 1 },
  'Inno Setup': { 'Infra & DevOps': 1 },
  Roff: { 'Infra & DevOps': 1 },
  'Go Template': { 'Infra & DevOps': 1 },
};

/** Framework display name -> axis. Anything unmapped contributes nothing. */
const FRAMEWORK_AXIS = {
  React: 'Frontend',
  'React Native': 'Frontend',
  Expo: 'Frontend',
  Electron: 'Frontend',
  PyQt: 'Frontend',
  Vue: 'Frontend',
  'Next.js': 'Frontend',
  Nuxt: 'Frontend',
  Svelte: 'Frontend',
  SvelteKit: 'Frontend',
  Astro: 'Frontend',
  Angular: 'Frontend',
  Solid: 'Frontend',
  'Tailwind CSS': 'Frontend',
  Bootstrap: 'Frontend',
  MUI: 'Frontend',
  Vite: 'Frontend',
  Webpack: 'Frontend',
  'Framer Motion': 'Frontend',
  Redux: 'Frontend',
  'TanStack Query': 'Frontend',
  'Three.js': 'Frontend',
  D3: 'Frontend',
  'Chart.js': 'Frontend',
  Express: 'Backend',
  Fastify: 'Backend',
  Hono: 'Backend',
  Koa: 'Backend',
  NestJS: 'Backend',
  Elysia: 'Backend',
  Laravel: 'Backend',
  Symfony: 'Backend',
  Slim: 'Backend',
  Livewire: 'Backend',
  Filament: 'Backend',
  Inertia: 'Backend',
  CodeIgniter: 'Backend',
  Django: 'Backend',
  Flask: 'Backend',
  FastAPI: 'Backend',
  Prisma: 'Backend',
  Drizzle: 'Backend',
  Mongoose: 'Backend',
  TypeORM: 'Backend',
  Sequelize: 'Backend',
  SQLAlchemy: 'Backend',
  'Socket.IO': 'Backend',
  Celery: 'Backend',
  Pydantic: 'Backend',
  Zod: 'Backend',
  Requests: 'Backend',
  Telegraf: 'Backend',
  'discord.js': 'Backend',
  'discord.py': 'Backend',
  'python-telegram-bot': 'Backend',
  pandas: 'Data & AI',
  NumPy: 'Data & AI',
  'scikit-learn': 'Data & AI',
  PyTorch: 'Data & AI',
  TensorFlow: 'Data & AI',
  Transformers: 'Data & AI',
  LangChain: 'Data & AI',
  'OpenAI SDK': 'Data & AI',
  'Anthropic SDK': 'Data & AI',
  Streamlit: 'Data & AI',
  Gradio: 'Data & AI',
  Matplotlib: 'Data & AI',
  OpenCV: 'Data & AI',
  Scrapy: 'Data & AI',
  BeautifulSoup: 'Data & AI',
  Selenium: 'Data & AI',
  Puppeteer: 'Data & AI',
  CCXT: 'Data & AI',
  'Cloudflare Workers': 'Infra & DevOps',
  Firebase: 'Infra & DevOps',
  Supabase: 'Infra & DevOps',
  Cargo: 'Infra & DevOps',
  'Go modules': 'Infra & DevOps',
  Jest: 'Testing',
  Vitest: 'Testing',
  Playwright: 'Testing',
  Cypress: 'Testing',
  pytest: 'Testing',
  PHPUnit: 'Testing',
};

/**
 * Scores each axis on two independent channels and keeps the STRONGER of the
 * two, normalised against the leading axis:
 *
 *   bytes -- share of code written in that axis's languages
 *   reach -- share of repositories that pull in that axis's frameworks
 *
 * Taking the stronger rather than the mean is what lets Testing register at
 * all: it has no languages of its own, so averaging in a structural zero would
 * halve a real signal. It also stops a language-heavy axis being dragged down
 * by having few named frameworks, and vice versa.
 *
 * The result is square-rooted. Raw shares put the leading axis at 100 and
 * everything else in the bottom fifth of the chart, which draws a spike rather
 * than a profile and hides exactly the weak-axis detail the card exists to
 * show. The raw evidence sits beside each axis unscaled, so nothing is hidden
 * by the compression.
 */
function computeAbility(data) {
  const axes = Object.fromEntries(
    ABILITY_AXES.map((a) => [a, { bytes: 0, reach: 0, langs: [], frameworks: [] }])
  );

  for (const lang of data.languages) {
    const split = LANG_AXIS[lang.name];
    if (!split) continue;
    for (const [axis, weight] of Object.entries(split)) {
      axes[axis].bytes += lang.bytes * weight;
      axes[axis].langs.push({ name: lang.name, bytes: lang.bytes * weight });
    }
  }

  for (const fw of data.frameworks) {
    const axis = FRAMEWORK_AXIS[fw.name];
    if (!axis) continue;
    axes[axis].reach += fw.repos;
    axes[axis].frameworks.push(fw);
  }

  const maxBytes = Math.max(1, ...ABILITY_AXES.map((a) => axes[a].bytes));
  const maxReach = Math.max(1, ...ABILITY_AXES.map((a) => axes[a].reach));
  const totalBytes = data.langBytes || 1;

  return ABILITY_AXES.map((name) => {
    const a = axes[name];
    const raw = Math.max(a.bytes / maxBytes, a.reach / maxReach);
    return {
      name,
      score: Math.round(Math.sqrt(raw) * 100),
      bytePercent: round((a.bytes / totalBytes) * 100),
      reach: a.reach,
      // What the reader should look at to check the score: the two languages
      // and two frameworks carrying the axis.
      evidence: [
        ...a.langs.sort((x, y) => y.bytes - x.bytes).slice(0, 2).map((l) => l.name),
        ...a.frameworks.slice(0, 2).map((f) => f.name),
      ],
    };
  });
}

/**
 * The radar itself on the left, and the same six axes as a ranked list on the
 * right. The polygon answers "what shape am I" at a glance; the list answers
 * "why does it say that", which a radar on its own never can.
 */
function abilityCard(data, t) {
  const H = 336;
  const mid = D.w / 2;
  const L = D.pad;
  const R = mid + D.pad;
  const panelW = mid - D.pad * 2;

  const scores = computeAbility(data);
  const ranked = [...scores].sort((a, b) => b.score - a.score);

  /* ---- left: the radar ---- */

  const RAD = 84;
  const cx = L + panelW / 2;
  const cy = 96 + RAD + 12;
  const N = ABILITY_AXES.length;
  // -90deg puts the first axis at the top; the rest run clockwise.
  const pt = (r, i) => {
    const ang = ((i / N) * 360 - 90) * (Math.PI / 180);
    return [cx + r * Math.cos(ang), cy + r * Math.sin(ang)];
  };
  const poly = (r, values) =>
    (values || Array(N).fill(1))
      .map((v, i) => pt(r * v, i).map(round).join(','))
      .join(' ');

  const rings = [0.25, 0.5, 0.75, 1].map(
    (f) =>
      `  <polygon points="${poly(RAD * f)}" fill="none" stroke="${t.hairline}"` +
      ` stroke-opacity="${f === 1 ? t.hairlineOpacity : t.softOpacity}"/>`
  );

  const spokes = ABILITY_AXES.map((_, i) => {
    const [x, y] = pt(RAD, i);
    return (
      `  <line x1="${round(cx)}" y1="${round(cy)}" x2="${round(x)}" y2="${round(y)}"` +
      ` stroke="${t.hairline}" stroke-opacity="${t.softOpacity}"/>`
    );
  });

  const shape = scores.map((s) => s.score / 100);
  const area =
    `  <polygon points="${poly(RAD, shape)}" fill="${t.accent}" fill-opacity="${t.areaOpacity}"` +
    ` stroke="${t.accent}" stroke-width="1.8" stroke-linejoin="round"` +
    anim('grow-radar', 0.2, `transform-origin:${round(cx)}px ${round(cy)}px`) +
    '/>';

  const knots = scores.map((s, i) => {
    const [x, y] = pt(RAD * (s.score / 100), i);
    return (
      `  <circle cx="${round(x)}" cy="${round(y)}" r="2.6" fill="${t.accent}"` +
      anim('fade', 0.5 + i * 0.05) +
      '/>'
    );
  });

  // Axis captions sit outside the outer ring, anchored by which side of the
  // circle they are on so none of them overhangs the panel.
  const axisLabels = scores.flatMap((s, i) => {
    const [x, y] = pt(RAD + 16, i);
    const dx = x - cx;
    const anchor = Math.abs(dx) < 6 ? 'middle' : dx > 0 ? 'start' : 'end';
    return [
      text(x, y + 3, s.name, {
        size: 9,
        weight: 600,
        fill: t.muted,
        anchor,
        cls: 'fade',
        delay: 0.55 + i * 0.05,
      }),
    ];
  });

  /* ---- right: the same six, ranked, with their evidence ---- */

  const rowH = 36;
  const barX = R + 96;
  const barW = panelW - 96 - 34;
  const rows = ranked.flatMap((s, i) => {
    const y = 96 + i * rowH;
    const d = 0.25 + i * 0.06;
    return [
      text(R, y + 3, s.name, {
        size: D.type.label,
        weight: 600,
        fill: t.text,
        cls: 'fade',
        delay: d,
      }),
      `  <rect x="${round(barX)}" y="${round(y - 7)}" width="${round(barW)}" height="9" rx="4.5" fill="${t.track}"/>`,
      `  <rect x="${round(barX)}" y="${round(y - 7)}" width="${round((s.score / 100) * barW)}"` +
        ` height="9" rx="4.5" fill="${t.shadeAt(0.4 + 0.6 * (s.score / 100))}"` +
        anim('grow', d, `transform-origin:${round(barX)}px ${round(y - 2.5)}px`) +
        '/>',
      text(R + panelW, y + 3, String(s.score), {
        size: D.type.label,
        weight: 600,
        fill: t.muted,
        anchor: 'end',
        tabular: true,
        cls: 'fade',
        delay: d + 0.05,
      }),
      text(
        R,
        y + 18,
        `${s.bytePercent}% of code · ${s.reach} framework ${s.reach === 1 ? 'use' : 'uses'}` +
          (s.evidence.length ? ` · ${s.evidence.join(', ')}` : ''),
        { size: 9, fill: t.faint, cls: 'fade', delay: d + 0.08 }
      ),
    ];
  });

  const strongest = ranked[0];
  const weakest = ranked.at(-1);

  return card(H, t, {
    css:
      `\n      .grow-radar { animation: grow-radar 520ms ${EASE} 200ms both; }` +
      `\n      @keyframes grow-radar { from { transform: scale(0.4); opacity: 0; } }`,
    panels: [
      {
        x: L,
        title: 'Ability Profile',
        subtitle: `Strongest ${strongest.name} · weakest ${weakest.name}`,
      },
      {
        x: R,
        title: 'What the shape is made of',
        subtitle: `Stronger of code share and framework reach, square-root scaled${data.scopeNote}`,
      },
    ],
    body: [
      `  <line x1="${mid}" y1="${D.head - 34}" x2="${mid}" y2="${H - 24}" stroke="${t.hairline}" stroke-opacity="${t.softOpacity}"/>`,
      ...rings,
      ...spokes,
      area,
      ...knots,
      ...axisLabels,
      ...rows,
    ].join('\n'),
  });
}

/* ------------------------------------------------------ year clock calendar */

/**
 * The contribution year as a dial rather than a grid. GitHub already draws the
 * grid on the profile page directly above these cards, so repeating it adds
 * nothing; a clock face does something the grid cannot, which is show a whole
 * year as one closed shape you can compare against the year beside it.
 *
 * January sits at 12 o'clock and the year runs clockwise, one spoke per day:
 * length and shade both carry the day's count. The current year's dial stops
 * at today, so the gap in the ring is the rest of the year still to come.
 */
function clockCalendar(data, t) {
  const R_HUB = 52;
  const R_MAX = 72; // longest spoke, measured outward from the hub
  const R_OUT = R_HUB + R_MAX;
  const R_LABEL = R_OUT + 16;
  const BOX = R_LABEL + 14;

  const dialTop = D.head + 10;
  const cy = dialTop + BOX;
  const H = cy + BOX + 46;

  const now = new Date();
  const todayUTC = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const thisYear = now.getUTCFullYear();
  const years = [thisYear, thisYear - 1];

  const pt = (cx, r, deg) => {
    const rad = ((deg - 90) * Math.PI) / 180;
    return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)];
  };

  // One scale across both dials, so a longer spoke always means a busier day
  // no matter which year it is in.
  let peak = 1;
  const perYear = years.map((year) => {
    const len = ((year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 366 : 365);
    const counts = [];
    for (let i = 0; i < len; i++) {
      const ms = Date.UTC(year, 0, 1) + i * 86400000;
      counts.push(ms > todayUTC ? null : data.days.get(iso(new Date(ms))) || 0);
    }
    peak = Math.max(peak, ...counts.filter((c) => c !== null));
    return { year, len, counts };
  });

  const level = (c) => (c === 0 ? 0 : Math.min(4, Math.ceil((c / peak) * 4)));
  // A power curve, so a single-contribution day is still visible next to a
  // three-figure spike without the spike leaving the card.
  const lenOf = (c) => (c === 0 ? 4 : 4 + (c / peak) ** 0.55 * (R_MAX - 4));

  const dials = perYear.flatMap(({ year, len, counts }, panel) => {
    const cx = D.w / 4 + (D.w / 2) * panel;
    const active = counts.filter((c) => c).length;
    const total = counts.reduce((a, c) => a + (c || 0), 0);
    const yearPeak = Math.max(0, ...counts.map((c) => c || 0));

    // 731 spokes carrying their own stroke would be a 70KB file for what is
    // five distinct colours, so they are bucketed by level and the colour is
    // hoisted onto one group per bucket -- same drawing, a third of the bytes.
    const buckets = t.levels.map(() => []);
    for (let i = 0; i < counts.length; i++) {
      const c = counts[i];
      if (c === null) continue;
      const deg = (i / len) * 360;
      const [x1, y1] = pt(cx, R_HUB, deg);
      const [x2, y2] = pt(cx, R_HUB + lenOf(c), deg);
      const d1 = (n) => Math.round(n * 10) / 10;
      buckets[level(c)].push(
        `<line x1="${d1(x1)}" y1="${d1(y1)}" x2="${d1(x2)}" y2="${d1(y2)}"/>`
      );
    }
    const spokes = buckets
      .map((lines, lv) =>
        lines.length
          ? `    <g stroke="${t.levels[lv]}" stroke-width="1.8">${lines.join('')}</g>`
          : null
      )
      .filter(Boolean);

    const ticks = MONTHS.flatMap((name, m) => {
      const boundary = (Date.UTC(year, m, 1) - Date.UTC(year, 0, 1)) / 86400000 / len;
      const midDeg = (boundary + (Date.UTC(year, m + 1, 1) - Date.UTC(year, m, 1)) / 86400000 / len / 2) * 360;
      const [tx1, ty1] = pt(cx, R_OUT + 3, boundary * 360);
      const [tx2, ty2] = pt(cx, R_OUT + 8, boundary * 360);
      const [lx, ly] = pt(cx, R_LABEL, midDeg);
      return [
        `    <line x1="${round(tx1)}" y1="${round(ty1)}" x2="${round(tx2)}" y2="${round(ty2)}"` +
          ` stroke="${t.hairline}" stroke-opacity="${t.hairlineOpacity}"/>`,
        text(lx, ly + 3.2, name, { size: 8.5, fill: t.faint, anchor: 'middle', track: 0 }),
      ];
    });

    return [
      `  <g${anim('fade', 0.1 + panel * 0.12)}>`,
      // The hub rim closes the dial, so the missing spokes of an unfinished
      // year read as "not yet" rather than as a broken drawing.
      `    <circle cx="${round(cx)}" cy="${cy}" r="${R_HUB}" fill="none" stroke="${t.hairline}" stroke-opacity="${t.hairlineOpacity}"/>`,
      `    <circle cx="${round(cx)}" cy="${cy}" r="${R_OUT}" fill="none" stroke="${t.hairline}" stroke-opacity="${t.softOpacity}"/>`,
      ...spokes,
      ...ticks,
      text(cx, cy - 2, String(year), {
        size: D.type.big,
        weight: 700,
        fill: t.text,
        anchor: 'middle',
        track: TRACK.stat,
        tabular: true,
      }),
      text(cx, cy + 16, comma(total), {
        size: D.type.label,
        weight: 600,
        fill: t.muted,
        anchor: 'middle',
        tabular: true,
      }),
      text(cx, cy + BOX - 2, `${active} active days · peak ${yearPeak} in a day`, {
        size: D.type.caption,
        fill: t.faint,
        anchor: 'middle',
      }),
      '  </g>',
    ];
  });

  const swatchEnd = D.w - D.pad - 34;
  const swatchStart = swatchEnd - (t.levels.length * 15 - 4);
  const legend = t.levels.map(
    (c, i) =>
      `  <rect x="${round(swatchStart + i * 15)}" y="${H - 33}" width="11" height="11" rx="2" fill="${c}"${anim('fade', 1.1 + i * 0.05)}/>`
  );

  const total = perYear.reduce((a, y) => a + y.counts.reduce((s, c) => s + (c || 0), 0), 0);

  return card(H, t, {
    title: 'Contribution Year Clock',
    subtitle: `Jan at 12 o'clock, one spoke per day · ${comma(total)} contributions across ${years.at(-1)}-${years[0]}`,
    body: [
      ...dials,
      text(swatchStart - 6, H - 24, 'Less', {
        size: 9,
        fill: t.faint,
        anchor: 'end',
        cls: 'fade',
        delay: 1.1,
      }),
      ...legend,
      text(swatchEnd + 6, H - 24, 'More', { size: 9, fill: t.faint, cls: 'fade', delay: 1.35 }),
    ].join('\n'),
  });
}

/* ------------------------------------------------- 3D contribution calendar */

/**
 * Isometric replacement for github-profile-3d-contrib. Each day is an
 * extruded box on a 53x7 grid, projected with a flattened isometric
 * transform and painted back-to-front.
 */
function calendarCard(data, t) {
  // The dial is the default; the isometric grid and the skyline stay reachable
  // through CALENDAR_STYLE for anyone who wants them back.
  if (CALENDAR_STYLE === 'clock') return clockCalendar(data, t);
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

/**
 * Declaration order is README order, and it runs most-signal-first: who this
 * is and the headline numbers, then the two cards that answer "is this person
 * active right now", then the two that answer "what do they build with", then
 * the slower-moving shape of the year. The tallest and most decorative card is
 * last, where its height costs a reader nothing.
 */
const cards = {
  overview: overviewCard,
  streak: streakCard,
  ability: abilityCard,
  activity: activityCard,
  frameworks: frameworksCard,
  languages: languagesCard,
  rhythm: rhythmCard,
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
    ` (accent=${ACCENT}, animate=${ANIMATE})\n` +
    `  scanned ${data.repoCount} repositories` +
    (data.visibleRepos === null ? '' : ` (the account has ${data.visibleRepos} public)`) +
    ` · ${data.languages.length} languages · ${data.frameworks.length} frameworks`
);

// A properly scoped token sits ABOVE this ratio, often far above it, because
// the scan includes private repositories that `public_repos` does not. Falling
// under half the public count means whole swathes of the account are invisible
// -- which is not an error anywhere, just a quietly wrong chart.
if (data.visibleRepos && data.repoCount < data.visibleRepos / 2) {
  console.warn(
    `\n  WARNING: only ${data.repoCount} of ${data.visibleRepos} repositories were visible to` +
      ` this token.\n  The language and framework cards now describe that slice, not the` +
      ` account.\n  Use a personal access token with read:user rather than a repository-scoped` +
      ` one.\n`
  );
}
