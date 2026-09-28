#!/usr/bin/env bash
# Removes the disposable Couchbase Server + Sync Gateway started by couchbase-up.sh.
docker rm -f couchbase-test sync-gateway-test >/dev/null 2>&1 || true
docker network rm scouting-test >/dev/null 2>&1 || true
echo "Removed test Couchbase containers."
