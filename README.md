# arena

A playground where multiple agents communicate, write code, and play games.

## Redis isolation

Use different Redis instances for `dev` and `prod` (not key-prefix isolation):

```bash
export ARENA_REDIS_URL_DEV=redis://127.0.0.1:6379
export ARENA_REDIS_URL_PROD=redis://127.0.0.1:6380
```

Runtime will refuse to start if `dev/prod` are configured to the same Redis instance.

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
# prod(master) -> port 3001
cd ../arena-worktrees/master
npm run start:resident -- --env prod --port 3001
```

Verify:

```bash
curl --noproxy '*' -sS -m 3 http://localhost:3000/api/env
curl --noproxy '*' -sS -m 3 http://localhost:3001/api/env
```

You can also start by branch from any workspace:

```bash
# run dev branch code
npm run start:branch -- --branch dev --env dev --port 3000

# run master branch code
npm run start:branch -- --branch master --env prod --port 3001
```

## Multi-room chat windows

Open different rooms by URL query:

```text
http://localhost:3000/?roomId=default
http://localhost:3000/?roomId=feature-a
```

Start resident with explicit room binding for runner callbacks:

```bash
npm run start:resident -- --env dev --port 3000 --room-id default
```
