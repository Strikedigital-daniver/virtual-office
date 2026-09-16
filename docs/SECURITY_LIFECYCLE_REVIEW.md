# Spatial authorization lifecycle — local verification

Date: 2026-09-16. This implements existing privacy/session-expiry requirements;
it does not change the authority of Recuerda Club or grant additional roles.

## Signed presence lease

The two-minute signed realtime ticket now bounds the WebSocket authorization
lease as well as individual HTTP media requests. `session.refresh` accepts a
fresh ticket only for the same user, world and access class. A class change
closes with code `4003` so a fresh connection applies the new spawn and movement
rules. The web ticket response exposes `issuedAt`/`expiresAt` for client renewal;
the server relies only on signed claims, never those client-side fields.

The Durable Object retains the expiry in the hibernating attachment and uses an
alarm to expire idle sockets. Expired connections do not receive chat fan-out or
presence broadcasts, cannot create/own media sessions, and have their published
and received media cleaned up. Media ownership is tied to the current connection
ID, preventing an old tab/session from operating as a replacement tab.

Role or grant revocation is bounded by the last issued ticket's remaining life
(at most two minutes), not instantaneous notification from Club. The Worker
does not query Supabase on movement. Replacing the temporary staff email bridge
still requires the canonical Club role contract and infrastructure validation.

## Server-owned received subscriptions

Previously only new pulls were authorized. Existing SFU subscriptions relied on
the browser voluntarily unsubscribing after moving or losing access. The Worker
now persists received session/mid ownership and rechecks subscriptions after
movement, workstation use, broadcast changes, disconnects and lease expiry.
An invalid subscription is forcibly closed at the SFU, even if its browser
ignores presence updates. Authorization is checked again after an in-flight
subscribe response, so concurrent movement cannot leave a stale pull behind.

The registry is loaded into a Durable Object map on activation; movement checks
only the subscriptions involving the moving participant. Persistent records
survive hibernation. Failed SFU closes retain their records and schedule a retry;
per-track errors are not treated as successful closure. Duplicate track
identities are rejected before forwarding requests to the SFU.

A transport outage can delay the upstream close: local tests prove retry and
record retention, not the real Cloudflare service's timing. Validate actual
force-close behavior, SDP renegotiation and reconnects in infrastructure before
production. Pre-change live SFU subscriptions have no new registry records;
the first staging rollout must reconnect all existing participants to rebuild
the registry before validating privacy.

## Chat and identity integrity

- Idempotency IDs are bound to author, channel and normalized body; reuse for
  another audience/content returns conflict before fan-out. Deleted messages
  cannot be resent through the retry path.
- Pagination uses `(created_at, id)`, including equal timestamps, and validates
  cursor values before constructing a PostgREST filter.
- Simultaneous DM creation recovers the unique winning channel; retries repair
  missing memberships after a partial creation failure.
- Club profiles are selected by `auth_user_id`, and privileged entitlement reads
  are constrained by the profile's `profile_source_id`, as documented and used
  in the repository's Club provisioning/read-only scripts.
- Display names respect the 40-character shared protocol limit.

The existing precedence remains staff > paid Club membership > Office grant.
The integration plan calls its alternative order suggested, and reversing it
would remove Temple/general access from users with both membership and an Office
grant. Combined capabilities require a product decision; no new privilege model
is invented here.

## Evidence boundary

Regression tests cover API audience protection, retry races, same-timestamp
history, DM repair, hibernation/lease expiry, refreshed tickets, absent presence,
server-forced revocation, in-flight authorization changes and failed/per-track
SFU closure. SFU responses and database clients are simulated in these tests;
no Supabase or Cloudflare account was accessed, modified or deployed to.
