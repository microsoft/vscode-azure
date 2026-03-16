- JSDocs everywhere
- Address all the TODOs in source
- ALL the test coverage
- Vastly more logging to the output channel (especially debug/trace)
  - Also use `@azure/logger` to log to the output channel for SDK calls
- Telemetry on all the things (especially tree operations)
- Figure out why the token expired and wasn't refreshing
- Setting for node skipping behavior
- Setting for grouping behavior
- Cleanup non-ASCII characters and the odd region markers that Copilot is creating
- Tests that enforce bundle size not growing out of control
- Tests that enforce the view layer stays speedy quick (prefill the data cache?)
- Get rid of non-REST (old) `@azure` packages
- Could we use a hardcoded Azure location list, along with a test case that makes sure we keep it up-to-date with real Azure? Would save a lot of location list step time.
- Ability to mock and/or inject the Azure clients
- Should the activity view use a stable/deterministic ID, like we have in `AzureNodeId`?
- CODEOWNERS, but not yet to avoid email overload

Before handoff:
- Activity View
  - Code deployment tracking (i.e. `azd deploy`)
  - Generic action tracking (delete resource, etc.)
- Deployment story (single and app)
  - Generally app deployment can be just `azd up`...probably use AZD extension in some capacity? Or absorb it into this one?
  - Single resource--can we draft a Bicep file? Use AVM? Open an editor for the Bicep with very good completions support / tab stops, to make editing many things easy?

High level things to iron out:
- Partner story
  - How they contribute
  - Who owns code long-term
  - Rules and how we enforce them
- Migration story
  - User experience for migration from old extensions
  - User experience for deprecation of old extensions
  - Side-by-side? Side-by-side of the views? etc.
