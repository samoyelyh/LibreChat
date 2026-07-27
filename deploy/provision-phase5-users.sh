#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "$0")/common.sh"
require_runtime

compose exec -T ai-quota-adapter node dist/cli/provision-users.js
