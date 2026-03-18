## TODO
- Vastly more logging to the output channel (especially debug/trace)
  - Also use `@azure/logger` to log to the output channel for SDK calls
- Telemetry on all the things (especially tree operations)
- Setting for node skipping behavior
- Setting+commands for grouping behavior
- Setting for default page size
- Sovereign cloud support via using `Environment` returned by subscription provider

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
- ALL the test coverage
  - Validate high coverage? Maybe with a minimum too?
- Test that enforces bundle size not growing out of control
- Tests that enforce the view layer stays speedy quick (prefill the data cache?)
- Could we use a hardcoded Azure location list, along with a test case that makes sure we keep it up-to-date with real Azure? Would save a lot of location list step time.
- Ability to mock and/or inject the Azure clients

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
