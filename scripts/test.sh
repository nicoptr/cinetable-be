set -euo pipefail
set -a; . ./.env.test; set +a
npx prisma migrate reset --force --skip-seed
npx tsc
node --test --test-concurrency=1 dist/test/
