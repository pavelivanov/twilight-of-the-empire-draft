#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Create or configure the Railway topology for Imperium Draft.

Usage:
  npm run railway:setup -- [options]

Options:
  --project <id|name>         Link an existing Railway project
  --environment <name|id>    Environment to link (default: project's default)
  --create-project           Create and link a new project when none is linked
  --project-name <name>      New project name (default: imperium-draft)
  --workspace <id|name>      Workspace for --create-project
  --api-service <name>       API service name (default: api)
  --web-service <name>       Web service name (default: web)
  --postgres-service <name>  PostgreSQL service name (default: Postgres)
  --secrets-file <path>      Telegram secrets file (default: .env.railway)
  --skip-env                 Configure topology without pushing variables
  -h, --help                 Show this help

The setup is idempotent: existing services and domains are reused.
EOF
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "Missing required command: $1" >&2
    exit 1
  }
}

service_exists() {
  SERVICE_TO_FIND="$1" node -e '
    const fs = require("node:fs");
    const parsed = JSON.parse(fs.readFileSync(0, "utf8"));
    const services = Array.isArray(parsed) ? parsed : parsed.services ?? parsed.data ?? [];
    process.exit(services.some((service) => service?.name === process.env.SERVICE_TO_FIND || service?.id === process.env.SERVICE_TO_FIND) ? 0 : 1);
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

ensure_service() {
  local name="$1"
  local kind="$2"
  local services_json="$3"
  if service_exists "$name" <<<"$services_json"; then
    echo "[$name] Service already exists."
    return
  fi
  if [[ "$kind" == "postgres" ]]; then
    echo "[$name] Creating managed PostgreSQL service."
    railway add --database postgres --json >/dev/null
  else
    echo "[$name] Creating application service."
    railway add --service "$name" --json >/dev/null
  fi
}

ensure_domain() {
  local service="$1"
  local port="$2"
  local domains_json domain
  domains_json="$(railway domain list --service "$service" --json)"
  domain="$(domain_from_json <<<"$domains_json")"
  if [[ -z "$domain" ]]; then
    echo "[$service] Creating a public Railway domain on port $port."
    domains_json="$(railway domain --service "$service" --port "$port" --json)"
    domain="$(domain_from_json <<<"$domains_json")"
  fi
  [[ -n "$domain" ]] || { echo "[$service] Could not resolve a public domain." >&2; exit 1; }
  echo "[$service] Public URL: https://$domain"
}

PROJECT=""
ENVIRONMENT=""
CREATE_PROJECT=0
PROJECT_NAME="imperium-draft"
WORKSPACE=""
API_SERVICE="api"
WEB_SERVICE="web"
POSTGRES_SERVICE="Postgres"
SECRETS_FILE=".env.railway"
SKIP_ENV=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --project) PROJECT="${2:-}"; shift 2 ;;
    --environment) ENVIRONMENT="${2:-}"; shift 2 ;;
    --create-project) CREATE_PROJECT=1; shift ;;
    --project-name) PROJECT_NAME="${2:-}"; shift 2 ;;
    --workspace) WORKSPACE="${2:-}"; shift 2 ;;
    --api-service) API_SERVICE="${2:-}"; shift 2 ;;
    --web-service) WEB_SERVICE="${2:-}"; shift 2 ;;
    --postgres-service) POSTGRES_SERVICE="${2:-}"; shift 2 ;;
    --secrets-file) SECRETS_FILE="${2:-}"; shift 2 ;;
    --skip-env) SKIP_ENV=1; shift ;;
    -h | --help) usage; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; usage; exit 1 ;;
  esac
done

require_command railway
require_command node

if ! railway whoami --json >/dev/null 2>&1 && ! railway whoami >/dev/null 2>&1; then
  echo "Railway authentication failed. Run 'railway login' and retry." >&2
  exit 1
fi

if [[ -n "$PROJECT" ]]; then
  link_args=(--project "$PROJECT" --json)
  [[ -n "$ENVIRONMENT" ]] && link_args+=(--environment "$ENVIRONMENT")
  railway link "${link_args[@]}" >/dev/null
elif ! railway status --json >/dev/null 2>&1; then
  if [[ "$CREATE_PROJECT" -ne 1 ]]; then
    echo "No Railway project is linked." >&2
    echo "Use --project <id> or add --create-project for a new project." >&2
    exit 1
  fi
  init_args=(--name "$PROJECT_NAME" --json)
  [[ -n "$WORKSPACE" ]] && init_args+=(--workspace "$WORKSPACE")
  railway init "${init_args[@]}" >/dev/null
fi

echo "Railway project context:"
railway status --json | node -e '
  const fs = require("node:fs");
  const status = JSON.parse(fs.readFileSync(0, "utf8"));
  console.log(`  Project: ${status.name ?? status.projectName ?? status.project?.name ?? status.projectId ?? "linked"}`);
  console.log(`  Environment: ${status.environment ?? status.environmentName ?? status.environment?.name ?? "default"}`);
'

services_json="$(railway service list --json)"
ensure_service "$POSTGRES_SERVICE" postgres "$services_json"
services_json="$(railway service list --json)"
ensure_service "$API_SERVICE" app "$services_json"
services_json="$(railway service list --json)"
ensure_service "$WEB_SERVICE" app "$services_json"

echo "[$API_SERVICE] Applying Docker, migration, health, and restart configuration."
railway environment edit \
  --service-config "$API_SERVICE" build.builder DOCKERFILE \
  --service-config "$API_SERVICE" build.dockerfilePath apps/api/Dockerfile \
  --service-config "$API_SERVICE" build.watchPatterns '["apps/api/**","packages/domain/**","package.json","package-lock.json","tsconfig.base.json"]' \
  --service-config "$API_SERVICE" deploy.preDeployCommand 'npx prisma migrate deploy --schema apps/api/prisma/schema.prisma' \
  --service-config "$API_SERVICE" deploy.healthcheckPath /health \
  --service-config "$API_SERVICE" deploy.healthcheckTimeout 120 \
  --service-config "$API_SERVICE" deploy.restartPolicyType ON_FAILURE \
  --service-config "$API_SERVICE" deploy.restartPolicyMaxRetries 10 \
  --message "Configure Imperium Draft API" >/dev/null

echo "[$WEB_SERVICE] Applying Docker, health, and restart configuration."
railway environment edit \
  --service-config "$WEB_SERVICE" build.builder DOCKERFILE \
  --service-config "$WEB_SERVICE" build.dockerfilePath apps/web/Dockerfile \
  --service-config "$WEB_SERVICE" build.watchPatterns '["apps/web/**","packages/domain/**","package.json","package-lock.json","tsconfig.base.json"]' \
  --service-config "$WEB_SERVICE" deploy.healthcheckPath / \
  --service-config "$WEB_SERVICE" deploy.healthcheckTimeout 120 \
  --service-config "$WEB_SERVICE" deploy.restartPolicyType ON_FAILURE \
  --service-config "$WEB_SERVICE" deploy.restartPolicyMaxRetries 10 \
  --message "Configure Imperium Draft web" >/dev/null

ensure_domain "$API_SERVICE" 3001
ensure_domain "$WEB_SERVICE" 80

if [[ "$SKIP_ENV" -eq 0 ]]; then
  bash scripts/railway-env-push.sh \
    --secrets-file "$SECRETS_FILE" \
    --api-service "$API_SERVICE" \
    --web-service "$WEB_SERVICE" \
    --postgres-service "$POSTGRES_SERVICE"
fi

echo "Railway topology is ready. Deploy with: npm run deploy:railway"
