# 05 — Playbook (Layer 3)

The Playbook is the source of truth for how the company performs repeatable work. This is the knowledge normally acquired by shadowing the team's best operators.

Unlike the Customer Profile (per-customer) and the Product Manual (per-product), the Playbook captures **company-specific execution knowledge**. It evolves alongside the team.

## What lives here

```
data/playbook/
├── README.md
├── customer-onboarding/
│   ├── README.md
│   ├── standard-onboarding.md
│   ├── accelerated-onboarding.md
│   └── go-live-checklist.md
├── integrations/
│   ├── new-integration-setup.md
│   ├── integration-testing.md
│   └── integration-troubleshooting.md
├── deployments/
│   ├── deploying-a-new-workflow.md
│   ├── deploying-a-major-change.md
│   └── rollback-procedure.md
├── incident-investigation/
│   ├── production-issue-triage.md
│   ├── root-cause-analysis.md
│   └── customer-incident-communication.md
├── product-gap-escalation/
│   ├── bug-reporting.md
│   ├── product-gap-writeup.md
│   └── engineering-handoff.md
├── evaluations/
│   ├── setting-up-an-eval.md
│   ├── regression-testing.md
│   └── acceptance-testing.md
└── renewal-preparation/
    ├── account-review-prep.md
    ├── outcome-metric-review.md
    └── expansion-opportunity-review.md
```

Like the Product Manual, the Playbook is **manually authored**. The classifier never writes to this layer.

## Work modes

A Playbook entry isn't useful in every conversation. To select the right entries (and the right Customer Profile fields) for a given session, Mitable categorises work into modes.

v1 ships two:

- **INVESTIGATE** — debugging, diagnosis, root cause, "why is this happening"
- **IMPLEMENT** — deploying changes, building workflows, making something happen

The FDE can pass the mode explicitly (`/mitable carver --mode investigate`) or let Mitable infer it from session context (cwd, recent transcript activity, hook signals).

## Field weights per mode

Both modes pull the same Customer Profile fields, but with different priorities. Weights are integers from 1–10; higher means earlier in the brief and more likely to survive truncation.

### INVESTIGATE

**Customer Profile**

| Field | Weight |
|---|---|
| Change Log | 7 |
| Stability Risks | 10 |
| Deployed Configuration | 10 |
| Active Workarounds | 10 |
| Decision Rationale | 7 |
| Capability Gaps | 5 |
| Outcome Metrics | 2 |
| Outstanding Commitments | 1 |
| Stakeholder Map | 1 |
| Communication Context | 1 |
| Commercial Context | 1 |

**Playbook**

| Category | Weight |
|---|---|
| Incident Investigation | 10 |
| Deployments | 7 |
| Integrations | 5 |
| Evaluations | 5 |
| Customer Onboarding | 1 |
| Product Gap Escalation | 1 |
| Renewal Preparation | 1 |

**Product** — N/A for v1 (no building blocks or pages populated yet)

### IMPLEMENT

**Customer Profile**

| Field | Weight |
|---|---|
| Change Log | 7 |
| Stability Risks | 10 |
| Deployed Configuration | 10 |
| Active Workarounds | 10 |
| Decision Rationale | 7 |
| Capability Gaps | 5 |
| Outcome Metrics | 2 |
| Outstanding Commitments | 1 |
| Stakeholder Map | 1 |
| Communication Context | 1 |
| Commercial Context | 1 |

**Playbook**

| Category | Weight |
|---|---|
| Incident Investigation | 10 |
| Deployments | 7 |
| Integrations | 5 |
| Evaluations | 5 |
| Customer Onboarding | 1 |
| Product Gap Escalation | 1 |
| Renewal Preparation | 1 |

**Product** — N/A for v1

(The two modes share the same weights in v1; the structure exists so future modes — Scoping, Renewal-Prep, Onboarding — can diverge.)

## How weights drive assembly

At `/mitable <customer>` time, the assembler ([08-context-assembly.md](08-context-assembly.md)) uses these weights to:

1. Order fields in the brief (highest weight first)
2. Decide what to drop when the brief exceeds a token budget
3. Decide how many entries per field to include (more for high-weight fields, fewer for low-weight)

The weights are not a hard filter. A field with weight 1 still appears if there's room. They're a priority ordering, not a gate.

## Future modes

Anticipated additions, defined when a clear use case arises:

- **SCOPING** — Capability Gaps and Decision Rationale dominate; Playbook leans on Product Gap Escalation
- **RENEWAL-PREP** — Outcome Metrics, Commercial Context, Stakeholder Map dominate; Playbook leans on Renewal Preparation
- **ONBOARDING** — Deployed Configuration aspirational state, Stakeholder Map; Playbook leans on Customer Onboarding

Mode definitions live in `src/assembly/work-mode.ts` and are versioned with the plugin.

## Living operating knowledge

The Playbook is not a static SOP repository. As product capabilities ship, workarounds disappear, integrations change, and better procedures emerge, Playbook entries should be updated.

The system loop ensures the *Customer Profile* stays current automatically. The Playbook and Product Manual stay current through deliberate team practice — typically an entry update tied to whoever ran the relevant procedure most recently.
