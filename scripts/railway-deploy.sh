#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Deploy Imperium Draft to Railway, verify both services, and register Telegram.

Usage:
  npm run deploy:railway -- [options]

Options:
  --services <csv>           Services to deploy (default: api,web)
  --api-service <name>       API service name (default: api)
  --web-service <name>       Web service name (default: web)
  --postgres-service <name>  PostgreSQL service name (default: Postgres)
  --secrets-file <path>      Telegram secrets file (default: .env.railway)
  --message <text>           Railway deployment message
  --timeout <seconds>        Maximum wait per service (default: 900)
  --poll-interval <seconds>  Seconds between status checks (default: 5)
  --health-timeout <seconds> Maximum wait per health check (default: 120)
  --project <id>             Railway project ID (requires --environment)
  --environment <name|id>    Railway environment name or ID
  --skip-env                 Do not push Railway variables before deploying
  --skip-health-check        Do not check public endpoints after deployment
  --skip-webhook             Do not register and verify the Telegram webhook
  -h, --help                 Show this help

Run `npm run railway:setup` once before the first deployment.
EOF
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "Missing required command: $1" >&2
    exit 1
  }
}

is_positive_integer() {
  [[ "$1" =~ ^[0-9]+$ ]] && [[ "$1" -gt 0 ]]
}

is_failure_status() {
  case "$1" in
    FAILED | CRASHED | REMOVED | CANCELED | CANCELLED | ABORTED | SKIPPED) return 0 ;;
    *) return 1 ;;
  esac
}

railway_with_scope() {
  if [[ "${#RAILWAY_SCOPE_ARGS[@]}" -gt 0 ]]; then
    railway "$@" "${RAILWAY_SCOPE_ARGS[@]}"
  else
    railway "$@"
  fi
}

latest_deployment() {
  railway_with_scope deployment list --service "$1" --limit 1 --json | node -e '
    const fs = require("node:fs");
    const parsed = JSON.parse(fs.readFileSync(0, "utf8"));
    const deployments = Array.isArray(parsed) ? parsed : parsed.deployments ?? parsed.data ?? [];
    const deployment = deployments[0];
    const clean = (value) => String(value ?? "").replaceAll("\t", " ");
    process.stdout.write(`${clean(deployment?.id)}\t${clean(deployment?.status)}\t${clean(deployment?.createdAt)}`);
  '
}

domain_from_json() {
  node -e '
    const fs = require("node:fs");
    const parsed = JSON.parse(fs.readFileSync(0, "utf8"));
    const seen = new Set();
    function visit(value, key = "") {
      if (value == null || seen.has(value)) return undefined;
      if (typeof value === "string") {
        if (/domain|host|fqdn/i.test(key) && value.includes(".")) return value.replace(/^https?:\/\//, "").replace(/\/$/, "");
        return undefined;
      }
      if (typeof value !== "object") return undefined;
      seen.add(value);
      for (const [childKey, child] of Object.entries(value)) {
        const found = visit(child, childKey);
        if (found) return found;
      }
      return undefined;
    }
    process.stdout.write(visit(parsed) ?? "");
  '
}

service_url() {
  local service="$1"
  local path="$2"
  local domain
  domain="$(railway_with_scope domain list --service "$service" --json | domain_from_json)"
  [[ -n "$domain" ]] || { echo "No public domain found for Railway service: $service" >&2; exit 1; }
  printf 'https://%s%s' "$domain" "$path"
}

print_failure_logs() {
  local service="$1"
  local deployment_id="$2"
  echo "[$service] Build logs for $deployment_id:" >&2
  railway_with_scope logs "$deployment_id" --service "$service" --build --lines 150 || true
  echo "[$service] Deployment logs for $deployment_id:" >&2
  railway_with_scope logs "$deployment_id" --service "$service" --deployment --lines 150 || true
}

wait_for_deployment() {
  local service="$1"
  local baseline_id="$2"
  local deadline=$((SECONDS + DEPLOY_TIMEOUT_SECONDS))
  local deployment_id=""
  local previous_status=""

  while ((SECONDS < deadline)); do
    local info latest_id latest_status created_at
    info="$(latest_deployment "$service")"
    IFS=$'\t' read -r latest_id latest_status created_at <<<"$info"
    if [[ -z "$latest_id" || ( -z "$deployment_id" && "$latest_id" == "$baseline_id" ) ]]; then
      sleep "$POLL_INTERVAL_SECONDS"
      continue
    fi
    if [[ -z "$deployment_id" ]]; then
      deployment_id="$latest_id"
      echo "[$service] Tracking $deployment_id (created $created_at)"
    elif [[ "$latest_id" != "$deployment_id" ]]; then
      echo "[$service] A newer deployment appeared ($latest_id); tracking it instead."
      deployment_id="$latest_id"
    fi
    if [[ "$latest_status" != "$previous_status" ]]; then
      echo "[$service] Status: $latest_status"
      previous_status="$latest_status"
    fi
    if [[ "$latest_status" == "SUCCESS" ]]; then
      LAST_DEPLOYMENT_ID="$deployment_id"
      return 0
    fi
    if is_failure_status "$latest_status"; then
      echo "[$service] Deployment ended with $latest_status." >&2
      print_failure_logs "$service" "$deployment_id"
      return 1
    fi
    sleep "$POLL_INTERVAL_SECONDS"
  done

  echo "[$service] Timed out after ${DEPLOY_TIMEOUT_SECONDS}s." >&2
  [[ -n "$deployment_id" ]] && print_failure_logs "$service" "$deployment_id"
  return 1
}

wait_for_health() {
  local service="$1"
  local url="$2"
  local deadline=$((SECONDS + HEALTH_TIMEOUT_SECONDS))
  echo "[$service] Checking $url"
  while ((SECONDS < deadline)); do
    if curl --fail --silent --show-error --max-time 10 "$url" >/dev/null 2>&1; then
      echo "[$service] Health check passed."
      return 0
    fi
    sleep 2
  done
  echo "[$service] Health check failed after ${HEALTH_TIMEOUT_SECONDS}s: $url" >&2
  return 1
}

SERVICES_CSV=""
API_SERVICE="api"
WEB_SERVICE="web"
POSTGRES_SERVICE="Postgres"
SECRETS_FILE=".env.railway"
MESSAGE=""
DEPLOY_TIMEOUT_SECONDS=900
POLL_INTERVAL_SECONDS=5
HEALTH_TIMEOUT_SECONDS=120
PROJECT=""
ENVIRONMENT=""
SKIP_ENV=0
SKIP_HEALTH_CHECK=0
SKIP_WEBHOOK=0
LAST_DEPLOYMENT_ID=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --services) SERVICES_CSV="${2:-}"; shift 2 ;;
    --api-service) API_SERVICE="${2:-}"; shift 2 ;;
    --web-service) WEB_SERVICE="${2:-}"; shift 2 ;;
    --postgres-service) POSTGRES_SERVICE="${2:-}"; shift 2 ;;
    --secrets-file) SECRETS_FILE="${2:-}"; shift 2 ;;
    --message) MESSAGE="${2:-}"; shift 2 ;;
    --timeout) DEPLOY_TIMEOUT_SECONDS="${2:-}"; shift 2 ;;
    --poll-interval) POLL_INTERVAL_SECONDS="${2:-}"; shift 2 ;;
    --health-timeout) HEALTH_TIMEOUT_SECONDS="${2:-}"; shift 2 ;;
    --project) PROJECT="${2:-}"; shift 2 ;;
    --environment) ENVIRONMENT="${2:-}"; shift 2 ;;
    --skip-env) SKIP_ENV=1; shift ;;
    --skip-health-check) SKIP_HEALTH_CHECK=1; shift ;;
    --skip-webhook) SKIP_WEBHOOK=1; shift ;;
    -h | --help) usage; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; usage; exit 1 ;;
  esac
done

[[ -n "$SERVICES_CSV" ]] || SERVICES_CSV="$API_SERVICE,$WEB_SERVICE"
[[ -n "$SERVICES_CSV" ]] || { echo "--services cannot be empty" >&2; exit 1; }
is_positive_integer "$DEPLOY_TIMEOUT_SECONDS" || { echo "--timeout must be a positive integer" >&2; exit 1; }
is_positive_integer "$POLL_INTERVAL_SECONDS" || { echo "--poll-interval must be a positive integer" >&2; exit 1; }
is_positive_integer "$HEALTH_TIMEOUT_SECONDS" || { echo "--health-timeout must be a positive integer" >&2; exit 1; }
if [[ -n "$PROJECT" && -z "$ENVIRONMENT" ]]; then
  echo "--project requires --environment" >&2
  exit 1
fi

require_command railway
require_command node
require_command curl

RAILWAY_SCOPE_ARGS=()
[[ -n "$PROJECT" ]] && RAILWAY_SCOPE_ARGS+=(--project "$PROJECT")
[[ -n "$ENVIRONMENT" ]] && RAILWAY_SCOPE_ARGS+=(--environment "$ENVIRONMENT")

SERVICES=()
IFS=',' read -r -a raw_services <<<"$SERVICES_CSV"
for raw_service in "${raw_services[@]}"; do
  service="${raw_service//[[:space:]]/}"
  [[ -n "$service" ]] && SERVICES+=("$service")
done
[[ "${#SERVICES[@]}" -gt 0 ]] || { echo "No services were selected." >&2; exit 1; }

if [[ -z "$MESSAGE" ]]; then
  revision="$(git rev-parse --short HEAD 2>/dev/null || printf 'working-tree')"
  MESSAGE="Deploy Imperium Draft $revision at $(date -u +"%Y-%m-%dT%H:%M:%SZ")"
fi

available_services="$(railway_with_scope service list --json)"
for service in "${SERVICES[@]}"; do
  SERVICE_TO_FIND="$service" node -e '
    const fs = require("node:fs");
    const parsed = JSON.parse(fs.readFileSync(0, "utf8"));
    const services = Array.isArray(parsed) ? parsed : parsed.services ?? parsed.data ?? [];
    if (!services.some((item) => item?.name === process.env.SERVICE_TO_FIND || item?.id === process.env.SERVICE_TO_FIND)) {
      console.error(`Railway service not found: ${process.env.SERVICE_TO_FIND}. Run npm run railway:setup first.`);
      process.exit(1);
    }
  ' <<<"$available_services"
done

echo "Railway deployment"
echo "Services: ${SERVICES[*]}"
echo "Message:  $MESSAGE"

scope_args=()
[[ -n "$PROJECT" ]] && scope_args+=(--project "$PROJECT")
[[ -n "$ENVIRONMENT" ]] && scope_args+=(--environment "$ENVIRONMENT")

if [[ "$SKIP_ENV" -eq 0 ]]; then
  env_command=(bash scripts/railway-env-push.sh \
    --secrets-file "$SECRETS_FILE" \
    --api-service "$API_SERVICE" \
    --web-service "$WEB_SERVICE" \
    --postgres-service "$POSTGRES_SERVICE")
  [[ "${#scope_args[@]}" -gt 0 ]] && env_command+=("${scope_args[@]}")
  "${env_command[@]}"
fi

DEPLOYED_SERVICES=()
for service in "${SERVICES[@]}"; do
  baseline="$(latest_deployment "$service")"
  IFS=$'\t' read -r baseline_id _ _ <<<"$baseline"
  echo "[$service] Uploading the shared monorepo source."
  railway_with_scope up --service "$service" --detach --yes --message "$MESSAGE"
  wait_for_deployment "$service" "$baseline_id"
  echo "[$service] Deployment succeeded ($LAST_DEPLOYMENT_ID)."
  DEPLOYED_SERVICES+=("$service")
done

if [[ "$SKIP_HEALTH_CHECK" -eq 0 ]]; then
  for service in "${DEPLOYED_SERVICES[@]}"; do
    if [[ "$service" == "$API_SERVICE" ]]; then
      wait_for_health "$service" "$(service_url "$service" /health)"
    elif [[ "$service" == "$WEB_SERVICE" ]]; then
      wait_for_health "$service" "$(service_url "$service" /)"
    fi
  done
fi

if [[ "$SKIP_WEBHOOK" -eq 0 ]]; then
  webhook_command=(bash scripts/railway-telegram-setup.sh \
    --secrets-file "$SECRETS_FILE" \
    --api-service "$API_SERVICE" \
    --web-service "$WEB_SERVICE")
  [[ "${#scope_args[@]}" -gt 0 ]] && webhook_command+=("${scope_args[@]}")
  "${webhook_command[@]}"
fi

echo "Imperium Draft is deployed and ready for Telegram testing."
