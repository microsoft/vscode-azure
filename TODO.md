- JSDocs everywhere
- Address all the TODOs in source
- ALL the test coverage
- Create a good mock setup for VSCode (`vscode.window` and config especially)
- Vastly more logging to the output channel (especially debug/trace)
- Telemetry on all the things (especially tree operations)
- Figure out why the token expired and wasn't refreshing
- Setting for node skipping behavior
- Setting for grouping behavior
- Cleanup non-ASCII characters and the odd region markers that Copilot is creating
- Tests that enforce bundle size not growing out of control
- Tests that enforce the view layer stays speedy quick (prefill the data cache?)
- Get rid of non-REST (old) `@azure` packages

Before handoff:
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
