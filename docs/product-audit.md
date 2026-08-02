# Product audit

## Product definition

Imperium Draft is a Telegram-native Milty draft service for Twilight Imperium
Fourth Edition.

It has three deployable responsibilities:

1. **Telegram bot** — lives in a players group, links that group to a draft,
   announces every accepted
   action, mentions the next player, and exposes status/recovery commands.
2. **Telegram Mini App** — lets one player create and configure a draft, enroll
   players, start it, and lets each authenticated player select one faction, one
   five-system slice, and one table position.
3. **API and database** — owns identity verification, generation, the draft state
   machine, concurrency control, immutable history, and notification delivery.

The Mini App remains the authenticated player interaction surface. A broadcast
group carries notifications, but it cannot replace signed player identity and
actions inside the Mini App. Telegram's native chat picker filters choices to
groups where the creator can grant bot administrator access. A group can also
initiate creation with `/newdraft`; its one-time Mini App link is bound only
after both creator and bot administrator status are verified server-side.

## What the prototype proved

- The three-round boustrophedon order works:
  `[1…N] + [N…1] + [1…N]`.
- A player may take faction, slice, and position in any order, but exactly once.
- The reference five-system slice geometry and six-player final map geometry are
  understood and testable.
- Direct Mini App links are suitable for posting in a players group.
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

- Three to six players.
- Base Game + Prophecy of Kings catalog.
- Nine generated slices and a configurable faction pool.
- One position per player, including Speaker.
- Smaller tables are spaced around the six-seat map preview frame; unoccupied wedges remain empty.
- Creator may regenerate while the draft is in setup; pools are immutable after
  start.

Fan expansions and tournament-specific map templates require separate catalog
validation and are deliberately outside v1.

## Draft lifecycle

```text
SETUP ─┬─ start with bans ──> BANNING ── all bans locked ──> DRAFTING
       └─ start without bans ──────────────────────────────────────────┘

DRAFTING ── final pick ──> COMPLETE ──> ARCHIVED
```

Player and rules choices begin in the creation form. Once the draft row is
created, setup supports identity claims, creator-only player removal down to
three seats, and pool regeneration. Draft deletion is exposed from the creator's
draft list. Audited pick reversal and archival remain schema-ready follow-up
operations.

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

When bans are enabled, every seated player may lock exactly one distinct faction.
Ban submissions are simultaneous: clients may submit the version observed at the
start of the ban phase, while serializable transactions and a database uniqueness
constraint prevent duplicate player bans. The final lock atomically advances the
draft to `DRAFTING`.

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
- Group launch tokens expire after one hour, are consumed atomically, and do
  not bypass signed Mini App identity or group administrator checks.
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
