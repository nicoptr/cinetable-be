#!/usr/bin/env bash
set -euo pipefail
set -a; . ./.env.test; set +a
[[ "$DATABASE_URL" == *_test* ]] || { echo "DATABASE_URL non è un database di test"; exit 1; }
npx prisma migrate reset --force --skip-seed
npx tsc
node --test --test-concurrency=1 dist/test/
