#!/usr/bin/env bash
# HSC Chat — deploy-locally.sh
# Runs the full Docker stack: hsc-chat, postgres, searxng.
#
# Usage:
#   bash deploy-locally.sh
#   WEB_PORT=9090 bash deploy-locally.sh

set -euo pipefail
IFS=$'\n\t'

B=$'\033[1m'; R=$'\033[0m'
RED=$'\033[0;31m'; GRN=$'\033[0;32m'; YLW=$'\033[0;33m'
CYN=$'\033[0;36m'; LIME=$'\033[38;5;154m'; GRY=$'\033[0;90m'

log()  { printf "${GRY}[HSC]${R} %s\n" "$*"; }
ok()   { printf " ${GRN}✓${R}  %s\n" "$*"; }
warn() { printf " ${YLW}⚠${R}  %s\n" "$*"; }
err()  { printf " ${RED}✗${R}  %s\n" "$*" >&2; }
die()  { err "$*"; exit 1; }
section() { printf "\n${B}${LIME}▶ %s${R}\n" "$*"; }
hr()   { printf "${GRY}──────────────────────────────────────────────────────────${R}\n"; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WEB_PORT="${WEB_PORT:-8080}"
CHAT_START_TIMEOUT=90
STARTED=false
COMPOSE_CMD=()

print_banner() {
  printf "\n${B}${LIME}"
  printf "  ╔══════════════════════════════════════════╗\n"
  printf "  ║              HSC  CHAT  v1.0             ║\n"
  printf "  ║   Chat + voice UI (all in Docker)        ║\n"
  printf "  ╚══════════════════════════════════════════╝${R}\n\n"
}

require_docker() {
  command -v docker >/dev/null 2>&1 || die "Docker required. Install Docker Desktop: https://docker.com/products/docker-desktop"
  docker info >/dev/null 2>&1 || die "Docker is not running. Start Docker Desktop and retry."
  ok "Docker running"
}

detect_compose() {
  if docker compose version >/dev/null 2>&1; then
    COMPOSE_CMD=(docker compose)
  elif command -v docker-compose >/dev/null 2>&1; then
    COMPOSE_CMD=(docker-compose)
  else
    die "docker compose not found. Install the Docker Compose plugin."
  fi
  log "Compose: ${B}$(IFS=' '; echo "${COMPOSE_CMD[*]}")${R}"
}

port_listener_pid() {
  lsof -tiTCP:"$WEB_PORT" -sTCP:LISTEN 2>/dev/null | head -1 || true
}

port_listener_comm() {
  lsof -nP -iTCP:"$WEB_PORT" -sTCP:LISTEN 2>/dev/null | awk 'NR==2{print $1; exit}'
}

free_port() {
  section "Preparing port $WEB_PORT"

  log "Stopping previous compose stack and orphan containers..."
  (cd "$SCRIPT_DIR" && WEB_PORT="$WEB_PORT" "${COMPOSE_CMD[@]}" down --remove-orphans 2>/dev/null) || true

  local cids cid name
  cids=$(docker ps -q --filter "publish=$WEB_PORT" 2>/dev/null || true)
  for cid in $cids; do
    name=$(docker inspect --format '{{.Name}}' "$cid" 2>/dev/null | sed 's/^\///')
    warn "Stopping container ${name} on :$WEB_PORT"
    docker stop "$cid" >/dev/null 2>&1 || true
  done

  local pid comm
  pid=$(port_listener_pid)
  if [[ -z "$pid" ]]; then
    ok "Port $WEB_PORT is free"
    return 0
  fi

  comm=$(port_listener_comm)
  comm=${comm:-unknown}
  if [[ "$comm" == "node" ]] || [[ "$comm" == "com.docke" ]] || docker ps -q --filter "publish=$WEB_PORT" | grep -q .; then
    warn "Freeing host listener on :$WEB_PORT ($comm pid $pid)"
    kill "$pid" 2>/dev/null || true
    sleep 1
    pid=$(port_listener_pid)
    [[ -z "$pid" ]] && { ok "Port $WEB_PORT is free"; return 0; }
  fi

  die "Port $WEB_PORT still in use ($comm pid $pid). Stop it or run: WEB_PORT=9090 bash deploy-locally.sh"
}

wait_for_url() {
  local url=$1 timeout=$2 label=$3
  local deadline=$(( $(date +%s) + timeout )) waited=0
  log "Waiting for $label at $url ..."
  while [[ $(date +%s) -lt $deadline ]]; do
    if curl -sf "$url" >/dev/null 2>&1; then
      ok "$label ready -> $url"
      return 0
    fi
    if (( waited > 0 && waited % 8 == 0 )); then
      log "  ...still waiting (${waited}s)"
      (cd "$SCRIPT_DIR" && "${COMPOSE_CMD[@]}" logs --tail=8 hsc-chat 2>/dev/null) | while IFS= read -r line; do
        printf "   ${GRY}%s${R}\n" "$line"
      done || true
    fi
    sleep 2
    waited=$((waited + 2))
  done
  warn "$label not ready after ${timeout}s"
  return 1
}

compose_verbose() {
  local label=$1 rc
  shift
  log "$label"
  export DOCKER_BUILDKIT=1
  WEB_PORT="$WEB_PORT" "${COMPOSE_CMD[@]}" --progress plain "$@" 2>&1 | while IFS= read -r line; do
    printf "   ${GRY}%s${R}\n" "$line"
  done
  rc=${PIPESTATUS[0]}
  [[ $rc -eq 0 ]] || die "$label failed (exit $rc)"
}

start_docker() {
  section "Building and starting HSC Chat container"
  require_docker
  detect_compose
  free_port
  cd "$SCRIPT_DIR"

  log "Image steps: node:22-alpine -> npm install -> tsc -> copy public/ -> expose :8080"
  compose_verbose "Pulling SearXNG image..." pull searxng
  compose_verbose "Pulling base image..." pull hsc-chat
  compose_verbose "Building hsc-chat..." build --pull hsc-chat
  compose_verbose "Starting container..." up -d --remove-orphans hsc-chat
  STARTED=true

  log "Container logs:"
  WEB_PORT="$WEB_PORT" "${COMPOSE_CMD[@]}" logs --tail=12 hsc-chat 2>&1 | while IFS= read -r line; do
    printf "   ${GRY}%s${R}\n" "$line"
  done || true

  wait_for_url "http://localhost:$WEB_PORT/health" "$CHAT_START_TIMEOUT" "HSC Chat" || {
    warn "Full container log:"
    WEB_PORT="$WEB_PORT" "${COMPOSE_CMD[@]}" logs --tail=40 hsc-chat 2>&1 | while IFS= read -r line; do
      printf "   ${GRY}%s${R}\n" "$line"
    done
    die "Container failed to become healthy"
  }
}

open_browser() {
  local url="http://localhost:$WEB_PORT"
  case "$(uname -s)" in
    Darwin) open "$url" 2>/dev/null || true ;;
    *) xdg-open "$url" 2>/dev/null || sensible-browser "$url" 2>/dev/null || true ;;
  esac
}

print_summary() {
  printf "\n"; hr; printf "\n"
  printf "  ${B}${LIME}HSC Chat is running in Docker${R}\n\n"
  printf "  ${B}UI${R}      ->  ${CYN}http://localhost:$WEB_PORT${R}\n"
  printf "  ${B}Health${R}  ->  ${CYN}http://localhost:$WEB_PORT/health${R}\n"
  printf "\n"
  printf "  ${GRY}Stack: hsc-chat (UI + API), hsc-postgres, hsc-searxng.${R}\n"
  printf "  ${GRY}Open API Settings — paste chat + voice credentials.${R}\n"
  printf "  ${GRY}Chat history in PostgreSQL. Web search via SearXNG.${R}\n"
  printf "  ${GRY}Logs: docker compose logs -f hsc-chat${R}\n"
  printf "  ${GRY}Stop: docker compose down${R}\n"
  printf "\n"; hr
  printf "\n  ${GRY}Press ${B}Ctrl+C${R}${GRY} to stop the container.${R}\n\n"
}

cleanup() {
  [[ "$STARTED" == true ]] || return 0
  printf "\n${GRY}Stopping HSC Chat container...${R}\n"
  (cd "$SCRIPT_DIR" && WEB_PORT="$WEB_PORT" "${COMPOSE_CMD[@]}" stop hsc-chat 2>/dev/null) || true
  printf "${GRN}Done.${R}\n"
}

main() {
  print_banner
  start_docker
  open_browser
  print_summary
  trap cleanup INT TERM
  while true; do sleep 3600; done
}

main "$@"
