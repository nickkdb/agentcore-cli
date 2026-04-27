# GitHub Dashboard

Static HTML dashboard tracking issues, PRs, and CI health across agentcore repos. Generated from GitHub API data and committed directly to this branch.

## Update

```bash
git clone -b gh-pages https://github.com/aws/agentcore-cli.git dashboard && cd dashboard
./update.sh
# Review changes, then:
git add -A && git commit -m "update dashboard" && git push
```

## Local Dev

```bash
cd dashboard
npm install
npx tsx src/generate.tsx
open site/dashboard/index.html
```

Set `maxRuns: 10` in `src/config.ts` for faster iteration (skips most CI data).

## Adding a Repo

Add to the `repos` array in `dashboard/src/config.ts`.
