# Azure VS Code Extensions: Monorepo Migration Plan

> Status: Draft / planning. This document captures the phased rollout plan and partner migration strategy for consolidating the Azure VS Code extensions into this monorepo (the "Azure" mono extension).

## Phased rollout plan

We will transition users gradually to the monorepo-based "Azure" extension, reusing the gradual-migration playbook from the earlier Docker / Container Tools migrations rather than doing a hard cutover.

- Phase 0 (internal): Release the "Azure" extension to the internal marketplace.
- Phase 1 (beta): Release "Azure" as a standalone extension with no changes to existing extensions. It disables itself if it detects the Azure Resources extension installed alongside it.
- Phase 2 (opt-in): The Azure Resources extension disables itself if it detects the "Azure" extension alongside it. Users can pick which experience they want. (Target: at or after feature-complete.)
- Phase 3 (GA): Azure Resources becomes an extension-pack "stub" that points to the new "Azure" extension. The per-service Azure client extensions become deprecated.
- Phase 4 (cleanup): Deprecate the Azure Resources extension.

## Partner migration strategy

- The number of partner extensions is currently manageable.
- Do internal migrations first, then reuse the resulting skills/automation to simplify partner adoption.
- Migrate one of our own extensions first to prove out the path and to create reusable migration skills / instructions, then use those skills for subsequent internal migrations before bringing partners onto the platform.
- Significant effort has already gone into improving Copilot code-review guidance; better AI-assisted reviews should help partners iterate faster.
- Establish a partner contract with each team to decide ongoing maintenance ownership.
- Build a skill to inventory a partner extension's features and explain how each will change in the monorepo.
