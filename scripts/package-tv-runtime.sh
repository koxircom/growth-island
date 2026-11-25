#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
# Build dependencies must be local, not a worktree symlink.
test ! -L node_modules
npm run build
mkdir -p .next/standalone/scripts .next/standalone/.next/cache .next/standalone/db .next/standalone/supabase
cp -a .next/static .next/standalone/.next/
cp -a public .next/standalone/
cp scripts/tv-worker.mjs scripts/tv-client.mjs scripts/home-access.mjs scripts/time-settler.mjs scripts/migrate.mjs .next/standalone/scripts/
cp db/*.sql .next/standalone/db/
cp -a supabase/. .next/standalone/supabase/
(cd .next/standalone && node --input-type=module -e "import pg from 'pg';import './scripts/tv-client.mjs';import './scripts/tv-worker.mjs';if(!pg.Pool)throw new Error('missing_pg');console.log('Standalone worker dependencies verified')")
mkdir -p output
# Only a freshly generated artifact, no .env files, secret mounts, household data or keys.
tar -C .next/standalone -czf output/growth-island-tv-runtime.tar.gz .
sha256sum output/growth-island-tv-runtime.tar.gz > output/growth-island-tv-runtime.tar.gz.sha256
