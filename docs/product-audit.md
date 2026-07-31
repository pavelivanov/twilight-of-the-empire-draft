# Product audit

## Product definition

Imperium Draft is a Telegram-native Milty draft service for Twilight Imperium
Fourth Edition.

It has three deployable responsibilities:

1. **Telegram bot** — lives in a players group, links the group to a draft,
   announces every accepted action, mentions the next player, exposes status and
   creator-only recovery commands.
2. **Telegram Mini App** — lets one player create and configure a draft, enroll
   players, start it, and lets each authenticated player select one faction, one
   five-system slice, and one table position.
3. **API and database** — owns identity verification, generation, the draft state
   machine, concurrency control, immutable history, and notification delivery.

Telegram groups and supergroups are the collaboration surface. A broadcast-only
Telegram channel is not sufficient because players must have Telegram user
identities and interact with the bot/Mini App.

## What the prototype proved

- The three-round boustrophedon order works:
  `[1…N] + [N…1] + [1…N]`.
- A player may take faction, slice, and position in any order, but exactly once.
- The reference five-system slice geometry and six-player final map geometry are
  understood and testable.
- Direct Mini App links are suitable for posting in a group.
- Signed Telegram `initData` is the correct identity boundary for the web app.
- Real tile artwork is necessary for players to judge slices and the final map.

## Why the prototype cannot be evolved safely

| Area | Prototype | Production requirement |
| --- | --- | --- |
| Tenancy | One global draft | Many groups and drafts |
| Persistence | Mutable JSON file | PostgreSQL transactions and migrations |
| Concurrency | In-process promise queue | Database-level version/locking |
| Identity | Seeded IDs and demo header | Verified Telegram users and seat claims |
| History | Mutable pick log | Append-only event stream |
| Notifications | Sent during mutation | Transactional outbox with retries |
| Generation | One preloaded pool | Seeded, constrained pool generation |
| API/UI | Coupled static server | Independently buildable Hono API and Vite TMA |
| Recovery | Last-pick mutation | Audited creator action with compensating event |
| Operations | Single process | Health checks, Docker, migrations, metrics-ready logs |

The prototype is therefore replaced, not migrated.

## Supported v1 ruleset

- Six players.
- Base Game + Prophecy of Kings catalog.
- Nine generated slices and a configurable faction pool.
- Six standard positions including Speaker.
- Standard six-player three-ring map assembly.
- Creator may regenerate while the draft is in setup; pools are immutable after
  start.

Additional player counts and fan expansions require separate map templates and
catalog validation and are deliberately outside v1.

## Draft lifecycle

```text
SETUP ── start ──> DRAFTING ── final pick ──> COMPLETE ──> ARCHIVED
  │                    │
  ├── configure table  ├── pick
  ├── claim identities └── group notifications
  └── regenerate
```

In v1, player and rules edits happen in the creation form. Once the draft row is
created, setup supports identity claims and pool regeneration. Audited pick
reversal and archival are schema-ready follow-up operations, not exposed UI
actions in this build.

Starting a draft is a freeze boundary. It persists:

- the player order;
- the faction options;
- every slice and its exact tile order;
- balance metrics and generator version;
- random seed;
- positions and complete turn sequence.

## Core invariants

A pick is accepted only when:

- draft status is `DRAFTING`;
- the signed Telegram user owns the active player seat;
- the client version equals the current draft version;
- the player does not already own an option of that kind;
- the option belongs to the draft and is unselected.

The option claim, current turn, draft version, event, and notification outbox row
are committed atomically. Duplicate requests return the already-accepted result
or a conflict; they never advance twice.

## Balanced slice generation

Generation is seeded and reproducible. Each slice contains:

- one low-tier blue system;
- one mid-tier blue system;
- one high-tier blue system;
- two red systems.

Planet optimal value spends a planet on its stronger side. Equal resource and
influence values split evenly between both sides.

Each candidate slice must satisfy:

- minimum optimal resources;
- minimum optimal influence;
- minimum and maximum optimal total;
- no repeated wormhole type;
- configurable maximum wormholes;
- no adjacent anomalies inside the slice;
- unique systems across the generated pool.

The whole pool must satisfy configured legendary and paired alpha/beta wormhole
minimums. Valid pools are scored by the variance of optimal total, resources,
influence, planet count, and tech specialties. The best valid pool found within
the attempt budget wins; failure is explicit and suggests relaxing constraints.

The design follows the established tiered approach documented by the
[TI4 Map String Generator](https://migpalser.github.io/TI4MapStringGenerator/info.html)
and retains the stronger constraint checks expected from Milty drafting.

## Security and reliability

- Telegram `initData` is verified server-side with freshness limits.
- Bot token and webhook secret never reach the browser.
- Creator permissions are checked on every setup/recovery mutation.
- Draft writes use a serializable transaction and a monotonically increasing
  `version`.
- Telegram webhook update IDs are stored for idempotency.
- Notification delivery uses an outbox with attempts, next-attempt time, and
  terminal failure state.
- API errors use stable codes; unexpected details are logged but not returned.
- Public draft responses omit internal tokens and delivery errors.

## Release gates

- Unit tests for generator determinism, constraints, turn order, and pick rules.
- Transactional integration tests against PostgreSQL.
- Telegram signature and webhook-idempotency tests.
- Mobile end-to-end test from creation through final map.
- Asset redistribution/licensing review before public deployment.
