## TODO
- Vastly more logging to the output channel (especially debug/trace)
  - Also use `@azure/logger` to log to the output channel for SDK calls
- Setting for node skipping behavior
- Setting+commands for grouping behavior

## Issues
- Figure out why the token expired and wasn't refreshing
- Should the activity view use a stable/deterministic ID, like we have in `AzureNodeId`?

## Code hygiene
- JSDocs everywhere
- Address all the TODOs in source
- Cleanup non-ASCII characters and the odd region markers that Copilot is creating
- CODEOWNERS, but not yet to avoid email overload

## Near future
- Get rid of non-REST (old-style) `@azure` packages
- Product icon set for Azure resources

## Testing
- Get code coverage back up to max
- Test to verify high code coverage?
- Test that enforces bundle size not growing out of control
- Tests that enforce the view layer stays speedy quick (prefill the data cache?)

## Before handoff
- Activity view
  - Code deployment tracking (i.e. `azd deploy`)
  - Generic action tracking (delete resource, etc.)
- Deployment story (single and app)
  - Generally, app deployment can be just `azd up`...probably use AZD extension in some capacity? Or absorb it into this one?
  - Single resource
    - Draft a Bicep file? Use AVM?
    - Open an editor for the Bicep with very good completions support / tab stops, to make editing many things easy?
    - Wizard + Bicep file editor?

## High level things to iron out
- Partner story
  - How they contribute
  - Who owns code long-term
  - Rules and how we enforce them
- Migration story
  - UX for migration from old extensions
  - UX for deprecation of old extensions
  - Side-by-side? Side-by-side of the views? etc.
  - Settings migration?

## Ideas
- Deep link support? Deep links to tree items etc.
- Build with Turbo? `bmw/turbo` branch has a start on that
