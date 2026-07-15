# Azure VS Code Extensions: Monorepo Migration Plan

## Phased rollout plan

We will transition users gradually to the monorepo-based "Azure" extension, reusing the gradual-migration playbook from the earlier Docker / Container Tools migrations rather than doing a hard cutover.

- Phase 0 (internal): Release an MVP of the "Azure" extension to the internal marketplace.
- Phase 1 (beta): Release the "Azure" extension as a standalone extension with no changes to existing extensions. It disables itself if it detects the Azure Resources extension installed alongside it.
- Phase 2 (opt-in): The Azure Resources extension disables itself if it detects the "Azure" extension alongside it. Users can pick which experience they want. (Target: after feature-complete.)
- Phase 3 (GA): Azure Resources becomes an extension-pack "stub" that points to the new "Azure" extension. The per-service Azure client extensions become deprecated.
- Phase 4 (cleanup): Deprecate the Azure Resources extension.
