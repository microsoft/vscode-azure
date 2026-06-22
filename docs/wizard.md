# Wizard Framework

The wizard framework (`packages/utils/src/wizard/`) supports multi-step workflows with separate prompt and execute phases, back navigation, and dynamic step injection.

## Overview

A wizard runs in two phases:

1. **Prompt phase** — Steps run in order, each gathering input and returning a partial context. Back navigation is supported.
2. **Execute phase** — After all prompts complete, execute steps run using the fully-populated context.

```typescript
const wizard = new Wizard(baseContext, promptSteps, executeSteps);
const finalContext = await wizard.run();
```

## `PromptStep<TContext>`

Each prompt step gathers one piece of information and returns a partial context to merge:

```typescript
export abstract class PromptStep<TContext> {
    // Gather input, return partial context to merge
    abstract prompt(context: Readonly<TContext>): ProviderResult<Partial<TContext>>;

    // Return false to skip this step (default: true)
    shouldPrompt(context: Readonly<TContext>): boolean | Promise<boolean>;

    // Insert additional prompt steps after this one
    getSubPromptSteps(context: Readonly<TContext>): PromptStep<TContext>[];
}
```

### Back Navigation

Throw `GoBackError` from a prompt step to navigate back to the previous step:
- The previous step's context contribution is discarded
- Any dynamically added child steps are removed
- The previous step is re-prompted

Going back past the first step throws `CancellationError` (aborts the wizard).

## `ExecuteStep<TContext>`

Execute steps run after all prompts complete:

```typescript
export abstract class ExecuteStep<TContext> {
    // Perform the operation (context is read-only; execute steps must not modify it)
    abstract execute(context: Readonly<TContext>): void | Promise<void>;

    // Return false to skip (default: true)
    shouldExecute(context: Readonly<TContext>): boolean | Promise<boolean>;

    // Insert additional execute steps after this one
    getSubExecuteSteps(context: Readonly<TContext>): readonly ExecuteStep<TContext>[];
}
```

## Context Accumulation

The wizard builds context by **shallowly** merging each prompt step's return value:

```
baseContext → step1 result → step2 result → ... → final context
```

A new context object is created at each step (never mutates the base context). Nested objects may still be shared references.

## Dynamic Steps

Both prompt and execute steps can dynamically inject sub-steps:

- `PromptStep.getSubPromptSteps()` — called after `prompt()` succeeds; child steps are inserted immediately after the current step
- `ExecuteStep.getSubExecuteSteps()` — called after `execute()` succeeds; child steps are inserted immediately after the current step

When the user navigates back past a prompt step that added children, those children are recursively removed.

## Example

```typescript
class SelectResourceStep extends PromptStep<MyContext> {
    async prompt(context: Readonly<MyContext>) {
        const resource = await showQuickPick(resources);
        return { selectedResource: resource };
    }

    getSubPromptSteps(context: Readonly<MyContext>) {
        // Add a confirmation step only for production resources
        if (context.selectedResource?.isProduction) {
            return [new ConfirmProductionStep()];
        }
        return [];
    }
}

class DeployStep extends ExecuteStep<MyContext> {
    async execute(context: Readonly<MyContext>) {
        await deploy(context.selectedResource);
    }
}

const wizard = new Wizard(
    { selectedResource: undefined },
    [new SelectResourceStep()],
    [new DeployStep()]
);
const result = await wizard.run();
```

## Reusable Azure Pick Steps

`packages/azutils/src/wizard/` provides reusable prompt steps that extend `RecursivePickStep` for drilling through the Azure resource tree:

| Step | Drills Through | Sets on Context |
|------|---------------|-----------------|
| `ChooseSubscriptionStep` | Account > Tenant > Subscription | `subscription` |
| `ChooseResourceGroupStep` | Account > Tenant > Subscription > Resource Group | `subscription`, `resourceGroup` |
| `ChooseResourceStep<T>` | Full tree, filtering by `logicalType` | `resource` (single) or `resources` (multi-pick) |
| `ChooseLocationStep` | Flat list from ARM API | `location` |

Each step defines a context interface (e.g. `ChooseSubscriptionContext`) that the caller's wizard context must extend. Steps omit `classify` (and sometimes `tree`) from their constructor options since they provide these internally.

`RecursivePickStep` accepts a `recursiveClass` parameter so subclasses can ensure recursion creates instances of the correct type, preserving the overridden `prompt()` logic at every drill level.

Convenience wrappers (`subscriptionExperience`, `resourceGroupExperience`, `resourceExperience`) run a single-step wizard and return the picked object directly, for use outside of larger wizard flows.

## Resource Creation Wizards

The extension uses the wizard framework for azd-backed resource creation flows (e.g. Function App). These wizards combine shared prompt steps (folder selection, subscription/location pickers, project naming) with resource-specific steps and execute steps that generate IaC and run `azd provision`. See [Resource Creation](resource-creation.md) for the full step sequence, scenario matrix, and guide for adding new resource types.

### Resolving steps from the container

The generic `new SomeStep()` examples above apply to dependency-free steps. In the extension, wizard steps that need DI services (`ICodeContext`, `IAzdService`, providers, etc.) are `@injectable()` and declare those services with `@inject(<token>)` on their constructor. The assembling command does **not** thread those services through -- it injects `Container`, grabs a bound `get` handle, and resolves each step:

```typescript
public async execute(job: AzdJob): Promise<void> {
    const get = this.container.get.bind(this.container);

    const promptSteps = [
        get(SelectIacFolderStep),
        get(HydratableChooseSubscriptionStep),
        // ...
    ];
    const executeSteps = [
        get(IGenerateBicepStepFactory)<MyContext>('functionApp.bicep', ['azdServiceName']),
        // ...
    ];
    const wizard = new Wizard(this.output, { /* initial */ }, promptSteps, executeSteps);
    await wizard.run();
}
```

Steps are constructed by the per-execution child container, which has `autobind` enabled (see [Dependency Injection](dependency-injection.md)) -- so an `@injectable` step resolves with no explicit binding. `IActionContext` resolves to the execution-scoped instance; the rest of a step's dependencies resolve from the root container.

`GenerateBicepStep` is the exception: it needs both an injected `ICodeContext` **and** caller-supplied config (template name, parameter keys). That mix is handled with a **factory binding** rather than autobind -- `IGenerateBicepStepFactory` is bound with `toFactory` (in `extension.ts`), captures `ICodeContext`, and takes the per-command config as call arguments, returning a fully-constructed step. This keeps the step's config fields `readonly` and avoids any half-configured instance. See [Dependency Injection](dependency-injection.md) for the factory pattern.
