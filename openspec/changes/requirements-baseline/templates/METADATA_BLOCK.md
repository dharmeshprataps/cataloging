# Metadata block — required on every material artifact

House standard (inherited from `repair-studio-sim`). Paste at the top of every
artifact under `openspec/changes/requirements-baseline/`.

```markdown
| Field | Value |
|---|---|
| **ID** | `XXX-####` |
| **Title** | |
| **Owner** | Dharmesh Pratap Singh (operator) |
| **Status** | DRAFT / UNDER REVIEW / APPROVED / ACTIVE / SUPERSEDED / ARCHIVED |
| **Created** | YYYY-MM-DD |
| **Last modified** | YYYY-MM-DD |
| **Spec** | `spec.md` vX.Y |
| **Source classification** | OBSERVED / SIMULATED / EXTERNAL-VERIFIED / MIXED |
| **Confidence** | VERIFIED / HIGH / MODERATE / LOW / HYPOTHESIS / UNKNOWN |
| **Supersedes** | |
| **Superseded by** | |
| **Dependencies** | |
```

## Claim classes

Every substantive claim in a spec artifact must be classable as one of:

| Class | Meaning |
|---|---|
| `OBSERVED EVIDENCE` | Read directly from the code or a test in this repository. |
| `EXTERNAL-VERIFIED` | Confirmed against vendor documentation or a specification outside this repo. |
| `REASONED INFERENCE` | Derived by argument from observed facts; not directly verified. |
| `HYPOTHESIS` | Believed but untested. **Must be falsifiable, and must name how.** |
| `OPINION` | A preference or judgement. Not evidence. |
| `CONTRADICTED` | Known to be false, or a prior claim now disproven. |
| `SUPERSEDED` | Replaced by a later artifact. |

The distinction that matters most: **`OBSERVED EVIDENCE` describes what the code
does today. `spec.md` must not present a desire as an observation.**

## ID scheme

| Prefix | Meaning |
|---|---|
| `DEC` | Decision record |
| `F` | Finding — known deviation or open problem (see `findings/`) |
| `ADR` | Architecture decision (reserved; use `DEC`) |
| `INC` | Incident (reserved) |
| `F` | Finding — known deviation or open problem |

Requirement IDs inside `spec.md` use `<AREA>-<NNN>` — see
[`requirements.md`](../requirements.md). Requirement IDs
are **permanent**: never renumbered, never reused, never deleted. A withdrawn
requirement is marked `superseded`, not removed.
