#!/usr/bin/env bash
# Starts a disposable Couchbase Server + Sync Gateway in Docker for the
# real-database test runs (`npm run test:real`). Used by CI; works locally with Docker.
# Prints (and, in GitHub Actions, exports) the TEST_SG_* variables the tests read.
# Every step waits for readiness and fails loudly; nothing falls back to the fake.
set -euo pipefail

CB_IMAGE="${CB_IMAGE:-couchbase/server:community-7.6.2}"
SG_IMAGE="${SG_IMAGE:-couchbase/sync-gateway:3.2.1-community}"
NETWORK=scouting-test
ADMIN_USER=Administrator
ADMIN_PASS=test-password
BUCKET=scouting
SG_USER=dashboard-reader
SG_PASS=real-sg-secret-4b8e11d0
HERE="$(cd "$(dirname "$0")" && pwd)"

wait_for() { # description, command...
  local what="$1"; shift
  for _ in $(seq 1 90); do if "$@" >/dev/null 2>&1; then echo "✔ $what"; return 0; fi; sleep 2; done
  echo "✖ Timed out waiting for $what" >&2; return 1
}

docker network inspect "$NETWORK" >/dev/null 2>&1 || docker network create "$NETWORK" >/dev/null
docker rm -f couchbase-test sync-gateway-test >/dev/null 2>&1 || true

docker run -d --name couchbase-test --network "$NETWORK" -p 8091-8096:8091-8096 -p 11210:11210 "$CB_IMAGE" >/dev/null
wait_for "Couchbase Server REST API" curl -sf http://127.0.0.1:8091/ui/index.html

docker exec couchbase-test couchbase-cli cluster-init -c 127.0.0.1 \
  --cluster-username "$ADMIN_USER" --cluster-password "$ADMIN_PASS" \
  --services data,index,query --cluster-ramsize 512 --cluster-index-ramsize 256 --index-storage-setting default
docker exec couchbase-test couchbase-cli bucket-create -c 127.0.0.1 -u "$ADMIN_USER" -p "$ADMIN_PASS" \
  --bucket "$BUCKET" --bucket-type couchbase --bucket-ramsize 256 --enable-flush 1 --wait
wait_for "bucket $BUCKET" curl -sf -u "$ADMIN_USER:$ADMIN_PASS" "http://127.0.0.1:8091/pools/default/buckets/$BUCKET"

docker run -d --name sync-gateway-test --network "$NETWORK" -p 4984:4984 -p 4985:4985 \
  -v "$HERE/sync-gateway.json:/etc/sync_gateway/config.json:ro" "$SG_IMAGE" /etc/sync_gateway/config.json >/dev/null
wait_for "Sync Gateway admin API" curl -sf -u "$ADMIN_USER:$ADMIN_PASS" http://127.0.0.1:4985/

create_db() { curl -sf -u "$ADMIN_USER:$ADMIN_PASS" -X PUT "http://127.0.0.1:4985/$BUCKET/" -H 'Content-Type: application/json' -d "{\"bucket\":\"$BUCKET\",\"num_index_replicas\":0}"; }
wait_for "Sync Gateway database $BUCKET created" create_db
db_online() { curl -sf -u "$ADMIN_USER:$ADMIN_PASS" "http://127.0.0.1:4985/$BUCKET/" | grep -q '"state":"Online"'; }
wait_for "database $BUCKET online" db_online

curl -sf -u "$ADMIN_USER:$ADMIN_PASS" -X POST "http://127.0.0.1:4985/$BUCKET/_user/" -H 'Content-Type: application/json' \
  -d "{\"name\":\"$SG_USER\",\"password\":\"$SG_PASS\",\"admin_channels\":[\"*\"]}" >/dev/null
wait_for "public API accepts the test user" curl -sf -u "$SG_USER:$SG_PASS" "http://127.0.0.1:4984/$BUCKET/_changes?since=0"

vars=(TEST_SG_URL=http://127.0.0.1:4984 "TEST_SG_DATABASE=$BUCKET" "TEST_SG_USERNAME=$SG_USER" "TEST_SG_PASSWORD=$SG_PASS")
printf '%s\n' "${vars[@]}"
if [ -n "${GITHUB_ENV:-}" ]; then printf '%s\n' "${vars[@]}" >> "$GITHUB_ENV"; fi
echo "Real Couchbase + Sync Gateway ready. Stop with scripts/test-infra/couchbase-down.sh"
