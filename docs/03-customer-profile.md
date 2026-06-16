# 03 — Customer Profile (Layer 1)

The Customer Profile is the source of truth for what is true about a specific customer. One profile per customer. Eleven fields. Every piece of customer knowledge belongs in exactly one field.

This document defines the contract for each field: what it tracks, what shape an entry takes, and how it shows up in context briefs.

## The eleven fields

### Technical Reality

1. **Deployed Configuration** — the intentional production state (workflows, integrations, tools, customer-specific config)
2. **Active Workarounds** — temporary solutions currently running in production
3. **Stability Risks** — known areas of fragility, failure conditions, operational risks
4. **Change Log** — recent intentional changes; the strongest signal when investigating new issues
5. **Decision Rationale** — the reasoning behind important decisions (trade-offs, constraints)
6. **Capability Gaps** — product limitations affecting this customer (limitation, workaround, business impact)

### Business Outcomes

7. **Outcome Metrics** — whether the product is delivering value (current, baseline, target, trend)

### People & Commitments

8. **Outstanding Commitments** — promises made (commitment, owner, due date)
9. **Stakeholder Map** — champions, decision makers, skeptics, daily users
10. **Communication Context** — preferred terminology, communication preferences, sensitive topics
11. **Commercial Context** — contract info, renewal timing, expansion opportunities, strategic importance

## Entry shape

Every entry is a row in the event log (see [09-data-model.md](09-data-model.md)). The agent-facing fields per entry:

```
{
  profile_field,        // one of the eleven above
  content,              // distilled, self-contained assertion
  source_type,          // "slack" | "granola" | "claude_session" | "fde_manual"
  source_ref,           // permalink-equivalent identifier
  evidence_text,        // verbatim quote from the source — required for extracted entries
  confidence,           // 0.0–1.0
  origin_ts,            // when the underlying signal happened
  provenance,           // see below
  created_at
}
```

## Provenance tags

Every entry carries a provenance tag. It's surfaced in the command center and inline in context briefs. Critical for renewal conversations where the source of a metric matters.

| Tag | Meaning |
|---|---|
| `measured` | System observed this directly (e.g., tool output from a Claude session) |
| `customer_reported` | Customer stated it (extracted from Granola or Slack) |
| `fde_reported` | FDE told the system directly |
| `inferred` | Derived from multiple signals; lowest trust |

## Per-field policy on contradictions

When a new extraction contradicts an existing entry, resolution is automatic. No FDE review.

| Field | On contradiction |
|---|---|
| Deployed Configuration | Supersede. Keep history. |
| Active Workarounds | Supersede if new entry signals "removed" / "fixed" at ≥ 0.85 cosine. Otherwise append. |
| Change Log | Append-only. Contradiction is not possible. |
| Decision Rationale | Append. Link to prior entry as "reconsidered" in metadata. |
| Stability Risks | Supersede if new entry signals the risk was resolved. |
| Capability Gaps | Supersede if new entry signals the gap was fixed. Otherwise append. |
| Outcome Metrics | Time series. Always append. |
| Outstanding Commitments | State machine. Auto-transition `open → fulfilled` when a resolution signal matches the commitment. |
| Stakeholder Map | Append. Supersede only if role is explicitly changed ("X is now head of Y"). |
| Communication Context | Supersede. Latest style guidance wins. |
| Commercial Context | Supersede. Full history retained. |

Full mechanics in [07-scan-and-store.md](07-scan-and-store.md) §2.4.

## What does not belong here

The Customer Profile is per-customer. It is not:

- The Product Manual (shared product knowledge — see [04-product-manual.md](04-product-manual.md))
- The Playbook (shared operating knowledge — see [05-playbook.md](05-playbook.md))
- The agent's working memory within a session

If an entry could apply to any customer, it belongs in one of the other two layers, not here.

## Worked example

See [examples/carver/](examples/carver/) for a fully populated Customer Profile across all eleven fields.
