#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Push the production variables for the Imperium Draft API and web services.

Usage:
  npm run railway:env -- [options]

Options:
  --secrets-file <path>       Telegram secrets file (default: .env.railway)
  --api-service <name>        API service name (default: api)
  --web-service <name>        Web service name (default: web)
  --postgres-service <name>   PostgreSQL service name (default: Postgres)
  --project <id>              Railway project ID (requires --environment)
  --environment <name|id>     Railway environment name or ID
  -h, --help                  Show this help

The script only reads the allow-listed keys documented in .env.railway.example.
Secrets are sent over stdin and are never printed.
EOF
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "Missing required command: $1" >&2
    exit 1
  }
}

railway_with_scope() {
  if [[ "${#RAILWAY_SCOPE_ARGS[@]}" -gt 0 ]]; then
    railway "$@" "${RAILWAY_SCOPE_ARGS[@]}"
  else
    railway "$@"
  fi
}

strip_outer_quotes() {
  local value="$1"
  if [[ "$value" == \"*\" && "$value" == *\" ]]; then
    value="${value#\"}"
    value="${value%\"}"
  elif [[ "$value" == \'*\' && "$value" == *\' ]]; then
    value="${value#\'}"
    value="${value%\'}"
  fi
  printf '%s' "$value"
}

load_secrets() {
  local file="$1"
  if [[ ! -f "$file" ]]; then
    if [[ -n "$BOT_TOKEN_VALUE" && -n "$BOT_USERNAME_VALUE" && -n "$APP_SHORT_NAME_VALUE" && -n "$WEBHOOK_SECRET_VALUE" ]]; then
      return
    fi
    echo "Telegram secrets file not found: $file" >&2
    echo "Copy .env.railway.example to .env.railway and fill in the BotFather values." >&2
    exit 1
  fi

  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line%$'\r'}"
    [[ -z "$line" || "$line" == \#* ]] && continue
    [[ "$line" == *"="* ]] || { echo "Invalid line in $file (expected KEY=VALUE)." >&2; exit 1; }
    local key="${line%%=*}"
    local value="${line#*=}"
    value="$(strip_outer_quotes "$value")"
    case "$key" in
      BOT_TOKEN) BOT_TOKEN_VALUE="$value" ;;
      BOT_USERNAME) BOT_USERNAME_VALUE="$value" ;;
      TELEGRAM_APP_SHORT_NAME) APP_SHORT_NAME_VALUE="$value" ;;
      WEBHOOK_SECRET) WEBHOOK_SECRET_VALUE="$value" ;;
      AUTH_MAX_AGE) AUTH_MAX_AGE_VALUE="$value" ;;
      *) echo "Ignoring unsupported key in $file: $key" >&2 ;;
    esac
  done <"$file"
}

push_secret() {
  local service="$1"
  local key="$2"
  local value="$3"
  printf '%s' "$value" | railway_with_scope variable set "$key" --stdin --service "$service" --skip-deploys >/dev/null
}

SECRETS_FILE=".env.railway"
API_SERVICE="api"
WEB_SERVICE="web"
POSTGRES_SERVICE="Postgres"
PROJECT=""
ENVIRONMENT=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --secrets-file) SECRETS_FILE="${2:-}"; shift 2 ;;
    --api-service) API_SERVICE="${2:-}"; shift 2 ;;
    --web-service) WEB_SERVICE="${2:-}"; shift 2 ;;
    --postgres-service) POSTGRES_SERVICE="${2:-}"; shift 2 ;;
    --project) PROJECT="${2:-}"; shift 2 ;;
    --environment) ENVIRONMENT="${2:-}"; shift 2 ;;
    -h | --help) usage; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; usage; exit 1 ;;
  esac
done

if [[ -n "$PROJECT" && -z "$ENVIRONMENT" ]]; then
  echo "--project requires --environment" >&2
  exit 1
fi

require_command railway

BOT_TOKEN_VALUE="${BOT_TOKEN:-}"
BOT_USERNAME_VALUE="${BOT_USERNAME:-}"
APP_SHORT_NAME_VALUE="${TELEGRAM_APP_SHORT_NAME:-}"
WEBHOOK_SECRET_VALUE="${WEBHOOK_SECRET:-}"
AUTH_MAX_AGE_VALUE="${AUTH_MAX_AGE:-86400}"
load_secrets "$SECRETS_FILE"

BOT_USERNAME_VALUE="${BOT_USERNAME_VALUE#@}"
[[ "$BOT_TOKEN_VALUE" =~ ^[0-9]+:[A-Za-z0-9_-]+$ ]] || { echo "BOT_TOKEN is missing or malformed." >&2; exit 1; }
[[ "$BOT_USERNAME_VALUE" =~ ^[A-Za-z0-9_]+$ ]] || { echo "BOT_USERNAME is missing or malformed." >&2; exit 1; }
[[ "$APP_SHORT_NAME_VALUE" =~ ^[A-Za-z0-9_]+$ ]] || { echo "TELEGRAM_APP_SHORT_NAME is missing or malformed." >&2; exit 1; }
[[ "$WEBHOOK_SECRET_VALUE" =~ ^[A-Za-z0-9_-]+$ ]] \
  && [[ "${#WEBHOOK_SECRET_VALUE}" -ge 16 ]] \
  && [[ "${#WEBHOOK_SECRET_VALUE}" -le 256 ]] || {
  echo "WEBHOOK_SECRET must contain 16-256 letters, numbers, underscores, or hyphens." >&2
  exit 1
}
[[ "$AUTH_MAX_AGE_VALUE" =~ ^[0-9]+$ ]] && [[ "$AUTH_MAX_AGE_VALUE" -gt 0 ]] || {
  echo "AUTH_MAX_AGE must be a positive integer." >&2
  exit 1
}

RAILWAY_SCOPE_ARGS=()
[[ -n "$PROJECT" ]] && RAILWAY_SCOPE_ARGS+=(--project "$PROJECT")
[[ -n "$ENVIRONMENT" ]] && RAILWAY_SCOPE_ARGS+=(--environment "$ENVIRONMENT")

database_url="\${{${POSTGRES_SERVICE}.DATABASE_URL}}"
web_origin="https://\${{${WEB_SERVICE}.RAILWAY_PUBLIC_DOMAIN}}"
api_url="https://\${{${API_SERVICE}.RAILWAY_PUBLIC_DOMAIN}}"

echo "[$API_SERVICE] Pushing production configuration (secret values hidden)."
railway_with_scope variable set \
  "NODE_ENV=production" \
  "DATABASE_URL=$database_url" \
  "WEB_ORIGIN=$web_origin" \
  "APP_URL=$web_origin" \
  "BOT_USERNAME=$BOT_USERNAME_VALUE" \
  "TELEGRAM_APP_SHORT_NAME=$APP_SHORT_NAME_VALUE" \
  "AUTH_MAX_AGE=$AUTH_MAX_AGE_VALUE" \
  "ALLOW_DEMO_AUTH=false" \
  --service "$API_SERVICE" --skip-deploys >/dev/null
push_secret "$API_SERVICE" BOT_TOKEN "$BOT_TOKEN_VALUE"
push_secret "$API_SERVICE" WEBHOOK_SECRET "$WEBHOOK_SECRET_VALUE"

echo "[$WEB_SERVICE] Pushing frontend build configuration."
railway_with_scope variable set \
  "PORT=8080" \
  "VITE_API_URL=$api_url" \
  "VITE_TELEGRAM_BOT_USERNAME=$BOT_USERNAME_VALUE" \
  "VITE_TELEGRAM_APP_SHORT_NAME=$APP_SHORT_NAME_VALUE" \
  --service "$WEB_SERVICE" --skip-deploys >/dev/null

echo "Railway variables are configured. Deploy both services to apply them."
