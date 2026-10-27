# AVM-First Bicep Provisioning

Use this decision process for every creation or deployment feature adapted to azd + Bicep. The
inventory supplies the source provisioning topology and required inputs/outputs; this phase chooses
the target infrastructure implementation.

## 1. Establish the required topology and interface

Before selecting a module, read the inventory's provisioning record and list:

- the primary ARM resource type;
- every supporting resource that must be provisioned;
- deployment scope and parent/child relationships;
- required wizard inputs, defaults, tags, outputs, and post-create behavior.

If the inventory lacks this information, augment it from the pinned source extension before
continuing. Do not infer the topology from the primary resource type or from an AVM module's name.

Do not select a module from its name alone. The selected module must cover the complete topology and
expose every input and output the retained feature needs.

## 2. Search AVM before authoring Bicep

Search the current
[Azure Verified Modules repository](https://github.com/Azure/bicep-registry-modules/tree/main/avm)
by ARM resource type and product name. Inspect the candidate module's source and documentation, not
just the directory listing.

Search `avm/ptn` for a multi-resource topology and `avm/res` for a single-resource topology. Confirm
that the candidate is published in the public Bicep registry; a repository directory without a
usable published version does not satisfy the reuse requirement.

Choose the module category from the topology:

| Provisioning topology | Required AVM choice |
|---|---|
| One Azure resource, with no supporting resources | A resource module under `avm/res` is acceptable when it exposes all required parameters and outputs |
| The primary resource requires supporting resources (for example, a Function App plus an App Service plan) | A pattern module under `avm/ptn` is required; do not substitute one or more resource modules |

For the mapping record, capture:

- AVM repository path;
- pinned public registry reference and version;
- required parameter/output mapping;
- why it covers the complete topology;
- any gap that makes the candidate unsuitable.

Use a versioned `br/public:avm/...:<version>` reference. Do not use an unversioned or floating module
reference.

## 3. Fallback when no suitable AVM module exists

Author exactly two Bicep entry points:

1. A reusable local module that owns the complete resource topology.
2. A thin consumer `main.bicep` that creates any deployment-scope container (for example, a resource
   group), invokes the local module, and passes azd parameters through.

The generated project must preserve the module boundary, for example:

```text
infra/
  main.bicep
  modules/
    <module-name>/
      main.bicep
```

Bundle both under one directory in `extensions/vscode-azure/resources/templates/`.
[`GenerateBicepStep`](../../../../extensions/vscode-azure/src/azd/wizard/GenerateBicepStep.ts)
copies the complete selected directory into `infra/`, preserving relative module paths.
Add the directory name to `BicepTemplateName` and use `IGenerateBicepStepFactory` to select it.

Design the local module as an AVM candidate:

- use the current AVM Bicep specifications and the closest accepted `avm/res` or `avm/ptn` module as
  the structural precedent;
- keep subscription/resource-group setup and azd placeholders in the consumer, not in the reusable
  module;
- give every public parameter and output a clear description and stable type;
- expose the full interface the consumer needs without workspace- or extension-specific assumptions;
- keep parameter and output names suitable for a future registry contract, so replacing the local
  path with `br/public:avm/...` does not require redesigning the consumer.

This fallback is not permission to create an arbitrary multi-file Bicep project. It is one
AVM-shaped module plus one consumer.

## 4. Validate the selected path

- Build the consumer with the repository's existing Bicep validation command; this must also resolve
  and compile its remote or local module.
- Verify every retained wizard input is passed to a module parameter and every required post-create
  value comes from a declared output.
- Verify the generated Fresh project contains all required files and that Post-clone/Bootstrapped
  scenarios still skip generation when `infra/main.bicep` already exists.
