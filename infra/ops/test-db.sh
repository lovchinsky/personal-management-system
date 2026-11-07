#!/usr/bin/env bash
# An ephemeral Postgres for the integration test lane.
#
# Separate from the stack on purpose. The tests clean tables between runs, so they must not have
# access to the main `app_db`. The `data` network stays `internal: true`, as declared: a port
# cannot be published from it, and there is no need to break that boundary for the tests.
#
# The password is not a secret, so it is kept in the repository: the container runs on loopback,
# holds no data and is removed together with its volume. The image is the same as in the stack,
# so the server version is identical and a second pull is not needed.
set -euo pipefail

NAME=personal-management-system-test-db
IMAGE=pgvector/pgvector:0.8.2-pg17
PORT=55432

case "${1:-up}" in
  up)
    if [[ -n "$(docker ps -q -f "name=^${NAME}$")" ]]; then
      echo "${NAME} already running on 127.0.0.1:${PORT}."
      exit 0
    fi

    docker rm -f -v "$NAME" >/dev/null 2>&1 || true
    docker run -d --rm \
      --name "$NAME" \
      -e POSTGRES_USER=app \
      -e POSTGRES_PASSWORD=app \
      -e POSTGRES_DB=app_test \
      -p "127.0.0.1:${PORT}:5432" \
      --health-cmd "pg_isready -U app -d app_test" \
      --health-interval 2s \
      --health-timeout 3s \
      --health-retries 15 \
      "$IMAGE" >/dev/null

    printf 'waiting for %s' "$NAME"
    for _ in $(seq 1 30); do
      if [[ "$(docker inspect -f '{{.State.Health.Status}}' "$NAME" 2>/dev/null)" == healthy ]]; then
        echo " — ready on 127.0.0.1:${PORT}."
        exit 0
      fi
      printf '.'
      sleep 1
    done

    echo " — timed out." >&2
    docker logs --tail 20 "$NAME" >&2
    exit 1
    ;;

  down)
    docker rm -f -v "$NAME" >/dev/null 2>&1 || true
    echo "${NAME} removed."
    ;;

  *)
    echo "Usage: $0 {up|down}" >&2
    exit 2
    ;;
esac
