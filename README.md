# arena

A playground where multiple agents communicate, write code, and play games.

## Run dev + prod in parallel (git worktree)

Use separate worktrees so `dev` and `main` can run simultaneously without branch conflicts.

```bash
npm run worktree:setup
```

Then start each environment in its own workspace:

```bash
# dev -> port 3000
cd ../arena-worktrees/dev
npm run start:resident -- --env dev --port 3000
```

```bash
# prod(main) -> port 3001
cd ../arena-worktrees/main
npm run start:resident -- --env prod --port 3001
```

Verify:

```bash
curl --noproxy '*' -sS -m 3 http://localhost:3000/api/env
curl --noproxy '*' -sS -m 3 http://localhost:3001/api/env
```
