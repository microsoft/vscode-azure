- JSDocs everywhere
- ALL the test coverage
- Create a good mock setup for VSCode (`vscode.window` and config especially)
- Wizard framework?
- Deployment story via Bicep templates (Bicep extension?)
- Deployment story via AZD
- Vastly more logging to the output channel (especially debug/trace)
- Telemetry on all the things (especially tree operations)
- Reverse tree walk--find by ID, reveal, etc. Does VSCode need us to *load* every parent, or is it enough to just know the parent's ID?
    - What about when we aren't grouped by RG, and so the (virtual) parent of a resource isn't always just a slice of the first part of the ID?
    - Can we avoid `findByID` altogether or as much as possible?
- Figure out why the token expired and wasn't refreshing
- Setting for node skipping behavior
- Setting for grouping behavior
- Pagination of lists or at least a user-adjustable max item limit

Before handoff:
- Context value array and example commands
- Quick pick walk
- Deployment story (single and app)
