# CLAUDE.md — the profile repo (`tanghoong/tanghoong`)

This repo is Charlie's GitHub profile README and the generator behind it. Every
image on the profile is an SVG **built here, committed here, and served from
here** — no third-party badge service is in the render path, so nothing breaks
when someone else's free tier expires.

Styling is not decided in this repo. It comes from the design system at
**design.tanghoong.com**, whose complete machine-readable spec is
[`llms.txt`](https://design.tanghoong.com/llms.txt) — read that before any
styling work rather than reconstructing the system from a rendered card. Its
source lives in `../cth-design` (github.com/tanghoong/cth-design).

---

## Current state — 2026-09-06

The chart ramp moved from an HSL walk to an **OKLab function**, and colour is
now guarded rather than trusted.

| Landed | What it means day to day |
| --- | --- |
| `scripts/ramp.mjs` | The repo's colour module and CLI. Endpoints, sampling, `luminance`, `contrast`, `deltaE`, `inkOn`. Nothing else may define a colour. |
| `scripts/contrast.mjs` | 40 checks that recompute every ratio quoted in 03-DESIGN-SYSTEM.md from the hex the code ships. Runs in CI. |
| `inkOn()` measures | Was a fixed luminance cut-off that put labels at 2.2:1. Now picks the better of the two `--accent-ink` values; worst case 4.40:1. |
| Docs corrected | §2 had three stale contrast figures inherited from another palette. The guard found them; they are fixed. |

Nothing is outstanding. The next change to any chart starts from §4 of
[04-PROFILE-CARDS.md](04-PROFILE-CARDS.md).

---

## What you are working with

| You need | It is in |
| --- | --- |
| How the cards are generated, and every trap | [`04-PROFILE-CARDS.md`](04-PROFILE-CARDS.md) — read this before touching `scripts/` |
| Tokens, colour rules, type, space, motion | [`03-DESIGN-SYSTEM.md`](03-DESIGN-SYSTEM.md) |
| The system as it actually ships | [design.tanghoong.com/llms.txt](https://design.tanghoong.com/llms.txt) |
| The generator | `scripts/generate-cards.mjs` (~2400 lines, one function per card) |
| Colour, and only colour | `scripts/ramp.mjs` |
| Whether the docs still tell the truth | `node scripts/contrast.mjs --fail` |
| The schedule and the token it needs | `.github/workflows/profile.yml` |

```bash
# regenerate locally (see the warning below before committing anything)
GITHUB_TOKEN=$(gh auth token) USERNAME=tanghoong node scripts/generate-cards.mjs

node scripts/ramp.mjs 10 --json   # the ramp at any sample count
node scripts/ramp.mjs --check     # six samples still equal tokens.css --c-1..--c-6
node scripts/contrast.mjs --fail  # all 40 colour checks
```

---

## The four that will waste your afternoon

1. 🔴 **Never commit `assets/` from a local run.** A local `gh auth token` sees
   a slice of the account (32 of 74 public repos, where CI sees 320). The cards
   render perfectly and describe the wrong thing. Preview, then
   `git checkout -- assets/` and let CI rebuild them. Full detail: §1.1.
2. 🔴 **`USERNAME` is a built-in Windows environment variable**, already set to
   the OS account name. Always pass it explicitly. §1.2.
3. ⚠️ **Git Bash on Windows eats backslashes and backticks inside heredocs.**
   Edit `.mjs` and `.md` with an editor, never `cat <<EOF` — it corrupts
   regexes and code fences without erroring. §4.2.
4. ⚠️ **The workflow commits with `git add -A .`**, so any untracked scratch
   file in the tree gets swept into the next bot commit. Keep it clean. §5.

---

## Rules that are already decided

Do not relitigate these; they are settled and the reasoning is written down.

- **One accent, and it is green.** No second hue, no per-language identity
  colours, no red for a down week — grey carries the fall. 03 §2.
- **The ramp is a function, not a palette.** Sample the two endpoints at
  whatever count the card needs, in OKLab. Never hand-pick a shade, never
  interpolate in sRGB or HSL. 03 §2.2, 04 §4.3.
- **Ask what the number *is* before choosing the mark.** The activity card was
  a candlestick twice; contributions are a volume, not a price. 04 §4.
- **Every chart survives `grayscale(1)`** and is checked in both themes.
- **No literal colour anywhere outside `ramp.mjs`** and the token blocks the
  design system defines.

---

## Before you push

`node scripts/contrast.mjs --fail` and `node scripts/ramp.mjs --check` both run
in CI ahead of the build, so a colour change that contradicts the documents
fails the workflow instead of shipping. Run them locally first — they are
dependency-free and take under a second.

⚠️ When the guard fails it prints both numbers, the computed and the
documented. **Fix whichever is actually wrong.** Editing the document to match
a bad colour passes the check and defeats the point of having it.

**And keep the documents current.** When something lands, update the "Current
state" table above, the `revised:` line in whichever of 03/04 you touched, and
the section that now says something different. A session that opens this repo
reads these files first — if they describe last month, that is what it will
build against.
