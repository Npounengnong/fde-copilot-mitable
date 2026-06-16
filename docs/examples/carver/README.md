# Worked Example — Carver

A fictional B2B SMB lender (Carver, Sydney) using Lorikeet on Intercom. FDE: Dylan. This account exercises all eleven Customer Profile fields.

## Where the data lives

The Carver profile is in `../../../refs/carver-customer-profile/`. That directory was the source of truth used to validate the schemas in `../../03-customer-profile.md` and the brief format in `../../06-interaction-model.md`.

We point at it instead of duplicating to keep one canonical copy.

## File map

| Profile field (in 03-customer-profile.md) | Source file |
|---|---|
| Deployed Configuration | [01-deployed-configuration.txt](../../../refs/carver-customer-profile/01-deployed-configuration.txt) |
| Active Workarounds | [02-active-workarounds.txt](../../../refs/carver-customer-profile/02-active-workarounds.txt) |
| Stability Risks | [03-stability-risks.txt](../../../refs/carver-customer-profile/03-stability-risks.txt) |
| Change Log | [04-change-log.txt](../../../refs/carver-customer-profile/04-change-log.txt) |
| Decision Rationale | [05-decision-rationale.txt](../../../refs/carver-customer-profile/05-decision-rationale.txt) |
| Capability Gaps | [06-capability-gaps.txt](../../../refs/carver-customer-profile/06-capability-gaps.txt) |
| Outcome Metrics | [07-outcome-metrics.txt](../../../refs/carver-customer-profile/07-outcome-metrics.txt) |
| Outstanding Commitments | [08-outstanding-commitments.txt](../../../refs/carver-customer-profile/08-outstanding-commitments.txt) |
| Stakeholder Map | [09-stakeholder-map.txt](../../../refs/carver-customer-profile/09-stakeholder-map.txt) |
| Communication Context | [10-communication-context.txt](../../../refs/carver-customer-profile/10-communication-context.txt) |
| Commercial Context | [11-commercial-context.txt](../../../refs/carver-customer-profile/11-commercial-context.txt) |

## What this example demonstrates

- **All eleven fields populated** — useful as the seed fixture for the brief assembler
- **A worked stability risk** (SR-001: Zapier doc-status lag) tied to a worked workaround (WA-001) tied to a worked Capability Gap (CG-001: LoanPro API)
- **A worked outstanding commitment** (OC-001: enterprise routing) currently in violation — useful as a test case for the brief surfacing it prominently
- **Communication context with sharp edges** — Marcus's "don't oversell, don't CC the COO, lead with data" — exercises the Communication Context field as a real input to agent behavior, not boilerplate

## Use as a fixture

The implementation milestone for the assembler ([08-context-assembly.md](../../08-context-assembly.md)) seeds the event log from this directory and asserts the rendered brief contains the right entries with the right weights.

```
mitable init
mitable seed-fixture refs/carver-customer-profile
mitable brief carver --mode investigate
```

Expected output: a brief whose top three sections are Stability Risks, Deployed Configuration, and Active Workarounds — matching the INVESTIGATE weights in [05-playbook.md](../../05-playbook.md).
