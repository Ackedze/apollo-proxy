# AGENTS.md — repository discipline

## Apollo knowledge source synchronization

- Treat `ds-ai-hub/products/ab/**` as an input to the Apollo knowledge package. When a task changes
  consumer-visible AB knowledge there, update and verify the package in this repository in the same
  workstream.
- Keep source changes and proxy changes in separate branches and pull requests. Link both PRs in
  their descriptions; do not copy uncommitted files between repositories.
- Before requesting review, run a reproducible dry-run against clean source checkouts and record the
  exact `ds-ai-hub` and `design-system_ab` commits plus the resulting `contentVersion`.
- Publish or advance the stable channel only after the source PR is merged. The package manifest must
  point to the exact merged `ds-ai-hub` commit. If a source change is outside the package projection,
  record `not applicable` and the reason instead of publishing an unchanged package.

