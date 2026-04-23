# TODO

Most active work is tracked in [GitHub issues](https://github.com/microsoft/vscode-azure/issues). This file holds items that aren't yet ready to become issues.

## Issues
- Figure out why the token expired and wasn't refreshing
- Should the activity view use a stable/deterministic ID, like we have in `AzureNodeId`?

### Functions Bicep Issues
- No services are in azure.yaml which makes `azd deploy` unworkable. Need to add them, get the name, and set it in the wizard.

## Ideas
- Deep link support? Deep links to tree items etc.
- Build with Turbo? `bmw/turbo` branch has a start on that
