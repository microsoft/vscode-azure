# Utils for Azure for Visual Studio Code

General-purpose utilities shared across the [vscode-azure](https://github.com/microsoft/vscode-azure) repository. None of these are Azure-specific.

Includes:

- **Tree data/view layers** -- `DataItemTree`/`DataProvider` and `ViewItemTree`/`ViewProvider` for building lazily-loaded, cached VS Code tree views.
- **Wizards** -- `Wizard`, `PromptStep`, and `ExecuteStep` for multi-step prompt/execute flows with back navigation.
- **VS Code helpers** -- abstractions such as `IVsCode`, `IOutputChannel`, `EventEmitter`, `Disposable`, and filesystem helpers.
- **Action context & telemetry** -- `IActionContext`, `IActionExecutor`, and telemetry reporting.
- **Misc** -- pagination (`Page`), concurrency (`Limiter`), dependency-injection factory types, and shared type helpers.
