#!/bin/sh
set -eu
node scripts/migrate-production.mjs
exec node backend/dist/server.js
