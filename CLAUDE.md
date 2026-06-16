# transcript-app — Claude Instructions

**Read `docs/ARCHITECTURE.md` first.** It is the living overview of how this
app works — stack, data flow, every endpoint, key modules, deprecated paths,
and known tech debt.

## Fork policy

This repository is a **fork of `jbennygold/transcript-app`** (the live app at
<https://transcript-app-blue.vercel.app>). We do **not** maintain the
application code here.

**Only modify documentation files:**

- `docs/ARCHITECTURE.md` — architecture overview (keep "Last reviewed" current)
- `docs/AUDIT-YYYY-MM-DD.md` — weekly audit findings
- `CLAUDE.md` — this file

**Do not change any source code**, including files under `src/`, `scripts/`,
`data/`, `public/`, `transcripts/`, `tailwind.config.js`, `next.config.js`,
`vercel.json`, `package.json`, `tsconfig.json`, or any other non-doc file.

## Git workflow

```bash
git add docs/ CLAUDE.md
git commit -m "docs: weekly audit YYYY-MM-DD"
git push -u origin main
```

The branch on the upstream repo is `master`; this fork uses `main`.
