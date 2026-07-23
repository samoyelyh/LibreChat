#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "$0")/common.sh"
require_runtime

printf 'The official LibreChat CLI will prompt for email, name, username and password.\n'
printf 'Do not pass the password as a command argument.\n'
# The pinned production image starts in /app/api. Calling npm from there would
# select the backend workspace's broken relative path; invoke the upstream CLI
# file directly without passing any credential as a command argument.
compose exec api node /app/config/create-user.js
