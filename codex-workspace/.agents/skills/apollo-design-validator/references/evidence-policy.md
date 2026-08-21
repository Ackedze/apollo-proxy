# Evidence and decision policy

## Required finding model

Build each row from:

`priority | object | expectation | rationale | evidence | action`

Expose the expanded fields as:

- Fact: the observed value and exact node/fact path.
- Expectation: the canonical value or rule.
- Source: verified rule/contract evidence.
- Fix: safe guidance or a user-triggered structured proposal.

Use one atomic finding per unique `nodeId + ruleId + factPath`. Keep repeated occurrences as separate findings so every row can focus its own Figma object. Combine multiple symptoms only when one object, rule, fact, and corrective decision are identical.

## Confirmation rule

Confirm a violation only when both lanes are present:

1. observed evidence from the normalized snapshot, screenshot, or explicit designer answer;
2. normative evidence from an approved rule, effective baseline, lifecycle contract, or reviewed replacement mapping.

The screenshot may support a fact but must not silently override structured data. Until the JSON-versus-image policy is ratified, unresolved disagreement becomes human review.

For component rules, normative evidence additionally requires all of:

- `ruleKind=design-rule`;
- `authority.status=active`;
- `authority.provenance=design-system-author` or `generated-policy`;
- integer `authority.revision>=1`.

Missing, draft, or malformed authority cannot confirm either a violation or an allowed exception. `classification-rule` and `context-rule` may explain a case but cannot determine its verdict.

## Priority ownership

Never invent or adjust severity.

- Use `error` only when the owning approved source declares an error or lifecycle is `deprecated`.
- Use `warning` only when the owning source declares a recommendation or lifecycle is `scheduled`.
- Use `human_review` for unresolved evidence or source conflicts after clarification, not as a source-authored severity.
- When an approved rule has no severity, do not emit an error or warning.
- When approved sources assign different priorities to the same claim, clarify and then use human review.

## Clarification sequence

Return confirmed findings immediately. Put unresolved questions in `clarificationQuestions` without blocking the rest of the report.

- Ask at most three concise questions in one round.
- Tie every question to a node and rule.
- Treat an answer as `user_context` evidence, never as a design-system rule.
- Re-evaluate only dependent rules.
- Stop after two rounds or when the designer cannot answer.
- Convert the unresolved case to `human_review`.
- Submit to the design-system review queue only after the designer chooses “Нужна помощь дизайн-системы” and then “Отправить”. Require designer name and Figma links for submission.

## Context hints

Use `contextHints` for evidence-backed context suggestions that are not violations. Do not count them as errors, warnings, or human review.

Example: when `screenType` is unset and an approved rule marks a component as landing-only, show a landing suggestion with a user-triggered `set_screen_type` action. When an explicit non-landing type is selected, classify the same mismatch as an error.

## Scope and coverage

- Require one selected root and one platform per audit.
- Exclude hidden nodes and their descendants from the snapshot and all checks.
- Use screen-type patterns only for a complete screen selection.
- Treat Modal/UniversalModal as an automatically detected nested context.
- Use `base-only` when `screenType` is absent and list skipped specialized rule groups.
- Use `partial` when required contracts, facts, or sources cannot be evaluated.
- Never claim full compliance for `base-only` or `partial` coverage.

## Action safety

Never change Figma directly.

Allow navigation, source opening/copying, screen-type changes, and review submission only after an explicit user action. Allow `propose_mutation` only for an unambiguous verified error with a canonical target. Require the plugin to revalidate object identity and current state before mutation and to rerun the audit afterward.

Do not attach mutation actions to warnings or human-review findings.

## Model observations

Do not show unsupported aesthetic opinions or speculative issues in the validator report. Ask for clarification when missing context can resolve an approved rule. Otherwise omit the observation. Offer free-form design suggestions only in chat when the designer explicitly requests them.
