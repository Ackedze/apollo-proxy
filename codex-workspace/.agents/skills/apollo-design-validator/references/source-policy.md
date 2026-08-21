# Source policy

## Source roles

Use the source that owns the kind of claim being evaluated.

| Claim | Canonical source |
| --- | --- |
| Actual layout state | Normalized Figma snapshot |
| Supporting visual observation | Selection PNG |
| Component baseline and token expectation | Effective baseline in the component contract |
| Component lifecycle | `contract.status` |
| Reviewed component replacement | `JSONS/apollo/remediations.json` |
| Component usage constraint | Approved structured contract or unambiguous approved text rule |
| Screen pattern | Approved textual pattern/cookbook rule |
| Implementation example | Figma example or preset; never normative by itself |

Do not rank unrelated sources against one another. Use the snapshot for the fact and the owning design-system source for the expectation.

## Approved text gate

Use a textual rule as normative only when all conditions hold:

- its file is present in the knowledge-package allowlist;
- the rule has a stable `ruleId`;
- the rule status is `approved`;
- the rule declares applicable platforms;
- the rule declares applicable screen types when it is screen-specific;
- the rule declares `error` or `warning` severity;
- the statement is unambiguous for the observed fact.

Treat drafts, arbitrary Markdown, undocumented conventions, and files without approval metadata as supporting context only.

## Structured component-rule gate

Use a component `rules.json` entry as normative only when it is an active `design-rule` with trusted provenance and a positive integer authority revision. Document-level `ready` status does not promote an untyped rule. Draft or missing rule authority remains context and requires human review unless an independently approved textual pattern rule resolves the same fact.

## Component lifecycle

Resolve the observed published component or variant key through `componentContractIndex.json`, load its generated contract, and read `contract.status`.

- `active`: emit no lifecycle finding.
- `scheduled`: emit a confirmed warning.
- `deprecated`: emit a confirmed error.
- missing key, package, or contract: do not assume `active`; clarify and then use human review.

Read replacement advice only from the reviewed `components` mapping in `JSONS/apollo/remediations.json`. Verify that the target contract exists and is `active`. If no reviewed mapping exists, report the lifecycle state without inventing a replacement.

## Pattern precedence

Treat approved textual pattern rules and cookbooks as normative. Treat machine-readable pattern rules as executable projections that must retain the same `ruleId` and source path. Treat presets and Figma examples as non-normative.

If the approved text and its machine projection disagree, do not choose one silently. Ask a targeted clarification question and escalate to human review if the conflict remains.

## Conflicts

When two approved sources that own the same claim disagree:

1. Record both in `consultedSources`.
2. Ask a targeted clarification question when a designer can supply missing context.
3. Escalate to human review after two unresolved rounds.
4. Never average, guess, or prefer the newer-looking file without explicit revision policy.

When the current published Figma component appears to disagree with the repository effective baseline, use human review so the design-system team can reconcile the component and its contract.

## Trace requirements

Put a file in `usedSources` only when it affected applicability, expectation, priority, remediation, context hint, or a finding. Put opened but unused files in `consultedSources`.

For every entry preserve:

- source repository;
- relative path without `..`;
- revision and checksum when available;
- role and purpose;
- related rule IDs;
- related finding IDs.
