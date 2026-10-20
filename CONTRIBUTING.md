# Contributing

Thank you for your interest in Azure for Visual Studio Code. Contributions from anyone are welcome -- bug reports, ideas, documentation, bug fixes, and new features.

## Ideas, feature requests, and bugs

We are open to all ideas and we want to get rid of bugs! Use the Issues section to report a new issue, share an idea, or contribute to existing threads.

## Documentation

If something in the [README](README.md), the [docs/](docs/) folder, or the extension's published documentation is unclear or wrong, open an issue or submit a PR with the correction. Documentation fixes are welcome contributions.

## Getting started

* Clone the repository and open it in VS Code.
* Install the recommended extensions: [ESLint](https://marketplace.visualstudio.com/items?itemName=dbaeumer.vscode-eslint), [TypeScript 7](https://marketplace.visualstudio.com/items?itemName=typescriptteam.native-preview), and [esbuild Problem Matchers](https://marketplace.visualstudio.com/items?itemName=connor4312.esbuild-problem-matchers).
* Run `pnpm install`, then build with `Tasks: Run Build Task`, and press <kbd>F5</kbd> to debug.
* See [docs/build-and-dev.md](docs/build-and-dev.md) for build, watch, and lint details.

## Before you start

* For anything beyond a small fix, open an issue first (or comment on an existing one) so we can agree on the approach before you invest time. Use the issue templates for bugs and feature requests.
* Keep pull requests focused. One logical change per PR makes review faster.

## Requirements for every pull request

### Follow repository conventions

Code must follow the conventions documented in [docs/](docs/), in particular:

* [docs/conventions.md](docs/conventions.md) -- naming, imports, localization, logging, comments
* [docs/architecture.md](docs/architecture.md) and [docs/dependency-injection.md](docs/dependency-injection.md)
* [docs/commands.md](docs/commands.md), [docs/tree-views.md](docs/tree-views.md), [docs/wizard.md](docs/wizard.md), [docs/settings.md](docs/settings.md), [docs/telemetry.md](docs/telemetry.md), [docs/azure-clients.md](docs/azure-clients.md)

`pnpm run lint`, `pnpm run build`, and `pnpm run test` must all pass.

### Tests

High test coverage is required. New and changed behavior must be covered by tests.

* Tests must be **fast and deterministic**. No real network calls, timers, or reliance on ordering, machine state, or the clock.
* Tests that genuinely cannot be fast (for example, ones that launch VS Code or exercise real tooling) must be registered as long-running tests, and should still be as fast as possible.
* Use the shared test helpers and fixtures instead of hand-rolling mocks.

See [docs/testing.md](docs/testing.md) for the full guidance, including what not to test.

### User experience

* Follow the [VS Code UX Guidelines](https://code.visualstudio.com/api/ux-guidelines/overview), including the pages on the [Activity Bar](https://code.visualstudio.com/api/ux-guidelines/activity-bar), [Sidebars](https://code.visualstudio.com/api/ux-guidelines/sidebars), [Views](https://code.visualstudio.com/api/ux-guidelines/views), [Command Palette](https://code.visualstudio.com/api/ux-guidelines/command-palette), [Notifications](https://code.visualstudio.com/api/ux-guidelines/notifications), [Quick Picks](https://code.visualstudio.com/api/ux-guidelines/quick-picks), [Settings](https://code.visualstudio.com/api/ux-guidelines/settings), and [Walkthroughs](https://code.visualstudio.com/api/ux-guidelines/walkthroughs).
* Follow this repository's own UX conventions (context menu grouping, tree item presentation, wizard behavior, and so on) described in [docs/conventions.md](docs/conventions.md), [docs/tree-views.md](docs/tree-views.md), and [docs/wizard.md](docs/wizard.md).
* All user-facing strings must be localized, and features must be accessible (keyboard navigation, screen reader labels, theme-aware icons).

### Performance and bundle size

* Do not degrade performance, especially **activation time**. Keep work out of `activate()`; defer and lazy-load anything that is not needed immediately.
* Do not bloat the bundle. Any increase in bundle size must be well justified in the PR description. Prefer existing dependencies and platform APIs over adding new packages, and avoid pulling in large libraries for small needs.

### Security and privacy

* Never commit secrets, tokens, or personal data, and never log them. Logging and telemetry must not include PII.
* Do not commit raw telemetry query results.
* Report security vulnerabilities privately as described in [SECURITY.md](SECURITY.md), not in public issues.

## Major contributions

Major contributions -- new services, new resource types, new tree views, or other substantial features -- come with a long-term commitment:

* **The contributor agrees to own the code long-term**, including triaging and fixing issues, keeping it working as dependencies and APIs change, and reviewing related PRs.
* If a feature's issues go unaddressed, we may deprecate or remove it.
* **Add a `CODEOWNERS` entry** in [.github/CODEOWNERS](.github/CODEOWNERS) for the code you contribute, so reviews are routed to you and ownership is recorded. Keep the entry up to date if ownership changes.
* Please discuss major work in an issue first, and expect it to be reviewed against the product, performance, and maintenance impact.

## Pull request process

1. Fork the repository and create a branch.
2. Make your change, with tests and any needed documentation updates in `docs/` and the relevant `README.md`/`CHANGELOG.md`.
3. Run `pnpm run lint`, `pnpm run build`, and `pnpm run test`.
4. Open a pull request and complete the pull request template, describing what changed and why. For UI changes include screenshots or a short recording; for bundle-size increases include the justification.
5. Respond to review feedback. PRs that go stale without a response may be closed.

## Legal

Before we can accept your pull request you will need to agree to a Contributor License Agreement (CLA) declaring that you have the right to, and actually do, grant us the rights to use your contribution. Submit your pull request and the CLA bot will label it and tell you what, if anything, you need to sign. You only need to do this once across all Microsoft repositories; see https://cla.opensource.microsoft.com.

## Code of Conduct

This project has adopted the [Microsoft Open Source Code of Conduct](https://opensource.microsoft.com/codeofconduct/). See the [Code of Conduct FAQ](https://opensource.microsoft.com/codeofconduct/faq/) or contact [opencode@microsoft.com](mailto:opencode@microsoft.com) with questions.
