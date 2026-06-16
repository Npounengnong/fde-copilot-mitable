# 09 — Data Model

The implementation contract for storage. Everything in [07-scan-and-store.md](07-scan-and-store.md) §2 is formalized here.

## Storage location

All Mitable data lives under `~/.mitable/`:

```
~/.mitable/
├── events.sqlite          # event log (this document)
├── watermarks.json        # per-channel and per-meeting watermarks
├── channel-map.json       # Slack channel ↔ customer mapping
├── granola-map.json       # Granola meeting/calendar ↔ customer mapping
├── product/               # Layer 2 source files (manually authored)
├── playbook/              # Layer 3 source files (manually authored)
└── customers/<customer_id>/
    └── raw/               # raw fetched payloads for replay/debug
        ├── slack/
        ├── granola/
        └── sessions/
```

Path is configurable via `MITABLE_HOME` for tests; default is `~/.mitable`.

## Event log

SQLite. One table is sufficient for v1.

```sql
CREATE TABLE events (
  id                TEXT PRIMARY KEY,            -- ULID
  customer_id       TEXT NOT NULL,
  profile_field     TEXT NOT NULL,               -- one of the 11 fields
  content           TEXT NOT NULL,               -- distilled assertion

  operation         TEXT NOT NULL,               -- 'add' | 'supersede' | 'remove'

  source_type       TEXT NOT NULL,               -- 'slack' | 'granola' | 'claude_session' | 'fde_manual'
  source_ref        TEXT NOT NULL,               -- e.g. 'C0123456:1718123456.000100'
  source_url        TEXT,                        -- clickable link back to source

  evidence_text     TEXT NOT NULL,               -- verbatim quote; required (or '' for fde_manual)
  confidence        REAL NOT NULL,               -- 0.0–1.0
  origin_ts         INTEGER NOT NULL,            -- when the underlying signal happened (unix ms)
  provenance        TEXT NOT NULL,               -- 'measured' | 'customer_reported' | 'fde_reported' | 'inferred'

  superseded_by     TEXT,                        -- id of the event that replaced this one
  valid_until       INTEGER,                     -- timestamp when this entry was superseded
  last_confirmed_at INTEGER,                     -- updated on exact-dup re-confirmation

  created_at        INTEGER NOT NULL             -- when the row was written (unix ms)
);

CREATE INDEX events_customer_field_idx ON events(customer_id, profile_field);
CREATE INDEX events_current_idx ON events(customer_id, profile_field)
  WHERE valid_until IS NULL;
CREATE INDEX events_created_at_idx ON events(created_at);
CREATE INDEX events_origin_ts_idx ON events(origin_ts);
```

### Invariants

- **Append-only.** No `UPDATE` of `content` or `evidence_text`. Corrections are new rows with `operation='supersede'` plus an `UPDATE` on the old row to set `valid_until` and `superseded_by`.
- **No deletes.** Ever.
- **Evidence required.** Rows with `source_type != 'fde_manual'` must have a non-empty `evidence_text`. Enforced at the writer layer.
- **Confidence gate.** Rows with `confidence < 0.7` are rejected at the writer layer, not stored.
- **Idempotent writes.** Two-stage dedup ([07-scan-and-store.md](07-scan-and-store.md) §2.2) runs before insert.

### Materialized profile view

```sql
SELECT *
FROM events
WHERE customer_id = :customer_id
  AND valid_until IS NULL
  AND operation != 'remove'
ORDER BY profile_field, origin_ts DESC;
```

### Point-in-time query

```sql
SELECT *
FROM events
WHERE customer_id = :customer_id
  AND created_at <= :as_of
  AND (valid_until IS NULL OR valid_until > :as_of)
  AND operation != 'remove'
ORDER BY profile_field, origin_ts DESC;
```

This is how renewal comparisons work: "what did the profile say 60 days ago?"

## Embeddings

Embeddings power Stage 2 of dedup. Stored in a separate table to keep the main events table compact and to allow re-embedding without rewriting events.

```sql
CREATE TABLE event_embeddings (
  event_id   TEXT PRIMARY KEY REFERENCES events(id),
  model      TEXT NOT NULL,        -- which embedding model produced this vector
  vector     BLOB NOT NULL,        -- packed float32 array
  created_at INTEGER NOT NULL
);
```

Choice of embedding model is an implementation detail in `src/store/dedup.ts`.

## Pending merges

Async merge queue (§2.5 of scan-and-store) backing table.

```sql
CREATE TABLE pending_merges (
  id_a       TEXT NOT NULL REFERENCES events(id),  -- enforce id_a < id_b
  id_b       TEXT NOT NULL REFERENCES events(id),
  cosine     REAL NOT NULL,
  detected_at INTEGER NOT NULL,
  resolved_at INTEGER,
  resolution TEXT,                                 -- 'merged' | 'superseded' | 'kept_both'
  PRIMARY KEY (id_a, id_b),
  CHECK (id_a < id_b)
);
```

## Watermarks

JSON file for simplicity (small, infrequent updates, easy to inspect).

```json
{
  "slack": {
    "C0123456": { "channel_watermark": "1718123456.000100", "last_sweep": 1718123500 },
    "C0123456:1718000000.000050": { "thread_watermark": "1718123450.000080", "last_sweep": 1718123500 }
  },
  "granola": {
    "meeting:abc123": { "watermark_ts": 1718123450000, "last_sweep": 1718123500 }
  }
}
```

**Advance-only rule:** writers must use `max(existing, new)` when updating a watermark, never blind overwrite.

## Channel and meeting maps

```json
// channel-map.json
{
  "C0123456": { "customer_id": "carver", "channel_name": "#carver-support", "active": true },
  "C0789ABC": { "customer_id": "carver", "channel_name": "#fde-carver-internal", "active": true }
}
```

```json
// granola-map.json
{
  "meeting:abc123": { "customer_id": "carver", "title": "Carver weekly sync", "active": true },
  "calendar:abcdef": { "customer_id": "carver", "active": true, "type": "calendar_event" }
}
```

The command center is the canonical editor for both. The `src/web/server.ts` API reads and writes these directly.

## Customers

Customer identity is the `customer_id` string. v1 keeps a minimal registry:

```sql
CREATE TABLE customers (
  customer_id    TEXT PRIMARY KEY,                -- 'carver'
  display_name   TEXT NOT NULL,                   -- 'Carver'
  one_liner      TEXT,
  created_at     INTEGER NOT NULL
);
```

Customers are created the first time a channel or meeting is mapped to them.

## Migrations

v1 is the initial schema. Migration files live under `src/store/migrations/` keyed by version number. On `init`, the writer runs any unapplied migrations against `~/.mitable/events.sqlite`.

## Backup and portability

Because all state lives under `~/.mitable/`, backup is `cp -R ~/.mitable ~/.mitable.bak`. The event log is the source of truth — the materialized view and watermarks can be rebuilt from it if necessary.

For multi-machine FDEs: multi-host sync is out of scope for v1 (see [10-non-goals.md](10-non-goals.md)).
