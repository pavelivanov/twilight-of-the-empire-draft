# Imperium Draft

Imperium Draft is a Telegram-connected Milty draft service for three- to six-player
Twilight Imperium Fourth Edition games.

- The Telegram Mini App creates a draft, enrolls players, generates the option
  pool, accepts one choice at a time, and assembles the final map.
- The Telegram bot connects a players group to its
  draft, announces every accepted player/creator action, and calls out the next
  player.
- The browser app links to the same Telegram identity through a one-time bot
  confirmation, exposes the complete Mini App workflow, and can show native
  activity and turn notifications while the app is open.
- The Hono API and PostgreSQL database verify identity, enforce draft rules,
  retain immutable history, and deliver bot notifications through a retryable
  outbox.

The implementation is greenfield. It does not copy the reference service's
source code. See [the product audit](docs/product-audit.md) for the supported
rules and [the architecture](docs/architecture.md) for system boundaries.

## Stack

- Web: Vite, React 19, TypeScript, Tailwind CSS 4, Shadcn Base UI
- API: Hono, TypeScript, Prisma 6
- Data: PostgreSQL 17
- Local infrastructure: Docker Compose

Node.js 22 or newer and Docker are required.

## Run locally

```bash
npm install
cp .env.example .env
npm run db:up
npm run db:migrate
npm run dev
```

Open the Vite URL printed in the terminal. In production, an ordinary browser
offers a secure Telegram bot link and keeps the resulting browser session for
30 days. Locally, `ALLOW_DEMO_AUTH=true` enables the identity switcher used to
claim seats and exercise the full draft without a configured bot.

The initial migration is committed, so a fresh checkout may use the
non-interactive deployment command instead:

```bash
npx prisma migrate deploy --schema apps/api/prisma/schema.prisma
```

## Verify

```bash
npm run typecheck
npm test
npm run build
```

The API tests use the local PostgreSQL instance and cover the complete six-player
lifecycle plus creator draft listing, seat removal, a three-player start, draft
deletion, event history, and cleanup.

To reset local draft data:

```bash
npm run db:seed
```

This removes draft, event, outbox, Telegram update/launch, and user rows from
the local database. It does not touch schema migrations.

## Deploy to Railway and Telegram

The production topology is one Railway project containing `api`, `web`, and a
managed `Postgres` service. Both apps build from the repository root because
they share the domain workspace.

First, create a bot with [@BotFather](https://t.me/BotFather), then prepare the
local secret file:

```bash
cp .env.railway.example .env.railway
openssl rand -hex 32
```

Put the bot token, username, generated webhook secret, and intended Mini App
short name in `.env.railway`. The real file is ignored by Git and Docker.

Create and configure a new Railway project:

```bash
npm run railway:setup -- --create-project --skip-env
```

The command creates the application services and PostgreSQL, configures the two
Dockerfiles, installs the Prisma migration as an API pre-deploy step, creates
public domains, and prints the resulting URLs. In BotFather, use `/newapp` for
the bot, set the printed `web` URL as the Web App URL, and choose the same short
name recorded in `.env.railway`.

For an existing Railway project, link and configure it instead:

```bash
npm run railway:setup -- --project <project-id> --environment production --skip-env
```

Deploy the complete application:

```bash
npm run deploy:railway
```

The deploy command pushes allow-listed variables, deploys and waits for both
services, checks their public endpoints, verifies the bot token, registers the
webhook and bot commands, configures the bot menu button, and confirms that
Telegram stored the expected webhook URL. Subsequent releases only need the
deploy command. To re-register Telegram without deploying, run:

```bash
npm run telegram:webhook
```

### Telegram smoke test

1. Add the bot to a group as an administrator.
2. Send `/newdraft` in the group and tap **Create draft** in the bot's reply.
3. Configure and create the draft. The API verifies that the signed Telegram
   user and bot are group administrators, consumes the one-hour link, and
   connects the group.
4. Copy the draft's Telegram invite link for the players.
5. Each player opens the Mini App invite and claims their named seat.
6. Every accepted claim, release, removal, pool regeneration, ban, pick, undo,
   and draft deletion should produce a group message.
7. Open the deployed web URL in a browser, confirm the one-time link in the bot,
   and verify that the same drafts, seat, and host permissions appear. A host can
   optionally connect either an administered group or channel from draft setup
   or **Manage draft**. Browser alerts are opt-in under **This browser**.

The Bot API does not expose a group-membership list to Mini Apps. The setup form
therefore triggers Telegram's native filtered chat picker; Telegram renders the
list and only offers groups where the creator can grant the bot administrator
access. This is still available when creating from the bot menu instead of
`/newdraft`. To connect an existing draft, add the bot to the group and send:

```text
/draft <draft-link-code>
```

`/status` reports the latest draft linked to that chat. Telegram production
authentication is mandatory; demo headers are rejected by the API.

## Repository

```text
apps/api       Hono API, Prisma schema, bot webhook, outbox worker
apps/web       React Telegram Mini App and tile artwork
packages/domain  shared schemas, catalogs, generation, turn and map rules
docs           product audit and architecture
scripts        Railway topology, deploy, variables, and Telegram setup
```

## Production cautions

- Run `prisma migrate deploy` as a release step.
- Keep the bot token and webhook secret server-side.
- Disable demo auth.
- Review the system-tile artwork's redistribution rights before a public
  release.
- This is an unofficial fan tool and is not affiliated with Fantasy Flight
  Games.
