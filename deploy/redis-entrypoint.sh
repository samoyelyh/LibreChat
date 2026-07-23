#!/usr/bin/env sh
set -eu

if [ -z "${REDIS_PASSWORD:-}" ]; then
  printf 'REDIS_PASSWORD is required\n' >&2
  exit 1
fi

umask 077
cat > /tmp/redis.conf <<EOF
bind 0.0.0.0
protected-mode yes
port 6379
dir /data
appendonly yes
appendfsync everysec
save 900 1
save 300 10
requirepass ${REDIS_PASSWORD}
EOF
chown redis:redis /tmp/redis.conf
chmod 0600 /tmp/redis.conf

exec docker-entrypoint.sh redis-server /tmp/redis.conf
