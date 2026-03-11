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
    // Perform the operation
    abstract execute(context: TContext): void | Promise<void>;

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
    async execute(context: MyContext) {
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
