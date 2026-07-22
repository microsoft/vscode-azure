# Partners and APIs in the monorepo

Notes on how partner extensions fit into the monorepo and what happens to the public API. This comes out of the planning discussion for the monorepo migration.

## Partners

There aren't many partner extensions today, so the migration is manageable. The plan is to sort out our own extensions before we ask any partner team to move.

The rough order of operations:

1. Migrate one of our own extensions into the monorepo first.
2. Write down what we did as reusable skills and instructions.
3. Use those skills to migrate the rest of our extensions.
4. Bring partners over once the path is proven.

A few things that should make partner onboarding easier:

- We've already put a lot of work into the Copilot code-review guidance, and better reviews should help partner teams move faster once they start.
- Before a partner migrates, we want a skill that inventories their extension's features and spells out how each one changes in the monorepo.
- Each partner team needs an agreement with us about who owns maintenance after the move.

## APIs

We want to keep the public API small. The preference is a command-based model rather than a broad API surface.

Right now the only obvious thing anyone consumes is "reveal tree item", and it's worth asking whether that even needs a dedicated API. Before we commit to anything, we should go through the existing Azure Resources API and decide what is actually worth keeping.

Tree data providers are not expected to stick around.

Authentication is still open. We know it's doable, but it needs a real plan before we start. `VsCodeExtensionCredential` goes a long way toward resolving the auth problems.
