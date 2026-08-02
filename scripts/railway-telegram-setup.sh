#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Register and verify the Telegram webhook for the deployed Imperium Draft bot.

Usage:
  npm run telegram:webhook -- [options]

Options:
  --secrets-file <path>    Telegram secrets file (default: .env.railway)
  --api-service <name>     API service name (default: api)
  --web-service <name>     Web service name (default: web)
  --api-url <url>          Override the public API URL
  --web-url <url>          Override the public Mini App URL
  --project <id>           Railway project ID (requires --environment)
  --environment <name|id>  Railway environment name or ID
  --skip-menu-button       Do not configure the bot's default Mini App button
  -h, --help               Show this help
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
    if [[ -n "$BOT_TOKEN_VALUE" && -n "$BOT_USERNAME_VALUE" && -n "$WEBHOOK_SECRET_VALUE" ]]; then
      return
    fi
    echo "Telegram secrets file not found: $file" >&2
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
      WEBHOOK_SECRET) WEBHOOK_SECRET_VALUE="$value" ;;
    esac
  done <"$file"
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
  local domain
  domain="$(railway_with_scope domain list --service "$service" --json | domain_from_json)"
  [[ -n "$domain" ]] || { echo "No public domain found for Railway service: $service" >&2; exit 1; }
  printf 'https://%s' "$domain"
}

telegram_response_ok() {
  local operation="$1"
  TELEGRAM_OPERATION="$operation" node -e '
    const fs = require("node:fs");
    const response = JSON.parse(fs.readFileSync(0, "utf8"));
    if (!response.ok) {
      console.error(`${process.env.TELEGRAM_OPERATION} failed: ${response.description ?? "unknown Telegram error"}`);
      process.exit(1);
    }
  '
}

SECRETS_FILE=".env.railway"
API_SERVICE="api"
WEB_SERVICE="web"
API_URL=""
WEB_URL=""
PROJECT=""
ENVIRONMENT=""
SKIP_MENU_BUTTON=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --secrets-file) SECRETS_FILE="${2:-}"; shift 2 ;;
    --api-service) API_SERVICE="${2:-}"; shift 2 ;;
    --web-service) WEB_SERVICE="${2:-}"; shift 2 ;;
    --api-url) API_URL="${2:-}"; shift 2 ;;
    --web-url) WEB_URL="${2:-}"; shift 2 ;;
    --project) PROJECT="${2:-}"; shift 2 ;;
    --environment) ENVIRONMENT="${2:-}"; shift 2 ;;
    --skip-menu-button) SKIP_MENU_BUTTON=1; shift ;;
    -h | --help) usage; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; usage; exit 1 ;;
  esac
done

if [[ -n "$PROJECT" && -z "$ENVIRONMENT" ]]; then
  echo "--project requires --environment" >&2
  exit 1
fi

require_command railway
require_command node
require_command curl

BOT_TOKEN_VALUE="${BOT_TOKEN:-}"
BOT_USERNAME_VALUE="${BOT_USERNAME:-}"
WEBHOOK_SECRET_VALUE="${WEBHOOK_SECRET:-}"
load_secrets "$SECRETS_FILE"
BOT_USERNAME_VALUE="${BOT_USERNAME_VALUE#@}"

[[ "$BOT_TOKEN_VALUE" =~ ^[0-9]+:[A-Za-z0-9_-]+$ ]] || { echo "BOT_TOKEN is missing or malformed." >&2; exit 1; }
[[ "$BOT_USERNAME_VALUE" =~ ^[A-Za-z0-9_]+$ ]] || { echo "BOT_USERNAME is missing or malformed." >&2; exit 1; }
[[ "$WEBHOOK_SECRET_VALUE" =~ ^[A-Za-z0-9_-]+$ ]] \
  && [[ "${#WEBHOOK_SECRET_VALUE}" -ge 16 ]] \
  && [[ "${#WEBHOOK_SECRET_VALUE}" -le 256 ]] || { echo "WEBHOOK_SECRET is missing or malformed." >&2; exit 1; }

RAILWAY_SCOPE_ARGS=()
[[ -n "$PROJECT" ]] && RAILWAY_SCOPE_ARGS+=(--project "$PROJECT")
[[ -n "$ENVIRONMENT" ]] && RAILWAY_SCOPE_ARGS+=(--environment "$ENVIRONMENT")

[[ -n "$API_URL" ]] || API_URL="$(service_url "$API_SERVICE")"
[[ -n "$WEB_URL" ]] || WEB_URL="$(service_url "$WEB_SERVICE")"
API_URL="${API_URL%/}"
WEB_URL="${WEB_URL%/}"
WEBHOOK_URL="$API_URL/api/telegram/webhook"
BOT_API="https://api.telegram.org/bot${BOT_TOKEN_VALUE}"

me_json="$(curl --fail-with-body --silent --show-error "$BOT_API/getMe")"
EXPECTED_BOT_USERNAME="$BOT_USERNAME_VALUE" node -e '
  const response = JSON.parse(process.argv[1]);
  if (!response.ok) throw new Error(response.description ?? "getMe failed");
  if (response.result?.username?.toLowerCase() !== process.env.EXPECTED_BOT_USERNAME.toLowerCase()) {
    throw new Error(`BOT_USERNAME does not match the token (Telegram returned @${response.result?.username ?? "unknown"})`);
  }
  console.log(`Telegram bot verified: @${response.result.username}`);
' "$me_json"

webhook_payload="$(WEBHOOK_URL="$WEBHOOK_URL" WEBHOOK_SECRET_VALUE="$WEBHOOK_SECRET_VALUE" node -e '
  process.stdout.write(JSON.stringify({
    url: process.env.WEBHOOK_URL,
    secret_token: process.env.WEBHOOK_SECRET_VALUE,
    allowed_updates: ["message"],
    drop_pending_updates: false,
  }));
')"
printf '%s' "$webhook_payload" | curl --fail-with-body --silent --show-error \
  --header 'content-type: application/json' --data-binary @- "$BOT_API/setWebhook" | telegram_response_ok setWebhook

commands_payload='{"commands":[{"command":"newdraft","description":"Create a draft for this group"},{"command":"draft","description":"Connect a draft to this group"},{"command":"status","description":"Show the connected draft status"}]}'
printf '%s' "$commands_payload" | curl --fail-with-body --silent --show-error \
  --header 'content-type: application/json' --data-binary @- "$BOT_API/setMyCommands" | telegram_response_ok setMyCommands

if [[ "$SKIP_MENU_BUTTON" -eq 0 ]]; then
  menu_payload="$(WEB_URL="$WEB_URL" node -e '
    process.stdout.write(JSON.stringify({
      menu_button: { type: "web_app", text: "Open draft", web_app: { url: process.env.WEB_URL } },
    }));
  ')"
  printf '%s' "$menu_payload" | curl --fail-with-body --silent --show-error \
    --header 'content-type: application/json' --data-binary @- "$BOT_API/setChatMenuButton" | telegram_response_ok setChatMenuButton
fi

info_json="$(curl --fail-with-body --silent --show-error "$BOT_API/getWebhookInfo")"
EXPECTED_WEBHOOK_URL="$WEBHOOK_URL" node -e '
  const response = JSON.parse(process.argv[1]);
  if (!response.ok) throw new Error(response.description ?? "getWebhookInfo failed");
  const info = response.result;
  if (info?.url !== process.env.EXPECTED_WEBHOOK_URL) throw new Error(`Telegram stored an unexpected webhook URL: ${info?.url ?? "none"}`);
  if (info?.last_error_message) throw new Error(`Telegram webhook reports: ${info.last_error_message}`);
  console.log(`Webhook verified: ${info.url}`);
  console.log(`Pending Telegram updates: ${info.pending_update_count ?? 0}`);
' "$info_json"

echo "Telegram setup is complete. Open the bot menu to create a draft and choose its notification group."
