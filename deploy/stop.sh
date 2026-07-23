#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "$0")/common.sh"
require_runtime
compose down --remove-orphans
