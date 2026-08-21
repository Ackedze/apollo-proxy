# Decision examples

## Effective baseline error

Input: `BackgroundPlateSlot`, `Type=Secondary`, has a fill token different from the effective baseline in its component contract.

Decision:

- priority: `error`;
- fact: observed bound fill token;
- expectation: effective paint baseline for the current Level/variant;
- fix: reset the fill and apply the canonical token;
- mutation proposal: allowed only when the exact canonical target is verified and the user chooses it; encode action payload as `{ key, value }` entries.

## Wrong platform

Input: a mobile-web component is present in a desktop audit.

Decision:

- priority: `error` when an approved platform restriction resolves the component identity;
- suggest an active desktop counterpart only when a reviewed mapping exists;
- otherwise explain removal and route unknown safe alternatives to clarification/human review.

## Scheduled lifecycle

Input: the component contract has `status=scheduled`.

Decision:

- priority: `warning`;
- state that removal is planned but the component remains allowed;
- recommend an active replacement only when `remediations.json` contains a reviewed mapping.

## Deprecated lifecycle

Input: the component contract has `status=deprecated`.

Decision:

- priority: `error`;
- do not confuse it with `scheduled`;
- recommend an active replacement only when it is reviewed and verified.

## Missing contract

Input: the component key cannot be resolved to a generated contract.

Decision:

- never assume `active`;
- ask a useful clarification question when context can identify the component;
- after two unresolved rounds, return `human_review`;
- allow designer-confirmed submission to the design-system review queue.

## Landing-only component with no screen type

Input: an approved rule marks the component landing-only and `screenType=null`.

Decision:

- emit no finding;
- add a `screen-type-suggestion` context hint;
- offer the user-triggered action “Сменить” to set `landing` and rerun the audit.

If `screenType=form`, `view`, or `hub`, emit an `error`. If `screenType=landing`, emit nothing and run landing patterns.

## Partial screen selection

Input: a form fragment is selected and `screenType=form`.

Decision:

- run component and local fragment rules;
- skip rules that require the complete screen structure;
- list those rule groups in coverage diagnostics;
- do not infer that the fragment is a whole screen.

## JSON and PNG disagreement

Input: the snapshot says one value while the rendered PNG appears different.

Decision:

- preserve both observations;
- ask a targeted clarification question when useful;
- use `human_review` if the contradiction remains;
- never let vision silently override the snapshot or let the snapshot suppress an unexplained visible anomaly.

## Unsupported model opinion

Input: the model dislikes spacing or hierarchy but finds no approved rule.

Decision: omit it from the validator report. Discuss it only in chat after an explicit request for design advice.
