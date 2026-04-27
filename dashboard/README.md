# GitHub Dashboard

Config-driven static dashboard for tracking issues, PRs, and CI health across multiple repos.

## Security

The dashboard only renders publicly available GitHub data (issue/PR titles, numbers, labels, CI pass/fail counts, usernames). An authenticated `gh` token is required for rate limits and GraphQL access, but the output HTML contains no auth-gated information. The one API field that differs between authenticated and unauthenticated responses (`author_association`) is intentionally excluded from the output.

## Local Preview

```bash
cd .github/dashboard
npm install
npx tsx src/generate.tsx
open site/dashboard/index.html
```

For faster iteration, set `maxRuns: 10` in the CI section of `src/config.ts` — full CI fetch takes ~90s.

## Adding a Repo

Add the repo to the `repos` array in `src/config.ts`. The same pages (Issues, PRs, CI) are generated for every repo.

## Type Check

```bash
npx tsc --noEmit
```
