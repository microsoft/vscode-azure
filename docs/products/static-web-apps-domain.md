# Static Web Apps: domain notes

> Skeleton -- bullets are prompts to fill in. The goal is the *why*: how the service
> actually behaves, and which extension decisions are consequences of that rather
> than of our own design taste. Anything that reads as "weird" in the code should
> have its explanation here.

## 1. The mental model

- What a `Microsoft.Web/staticSites` resource actually is, and the key surprise: the
  thing you deploy to is not the resource, it is a **build** underneath it.
- Deployment is owned by CI/CD by design (GitHub Actions / Azure Pipelines), not by a
  push-from-the-IDE flow. Why that shapes every creation and deploy decision we make.
- Free vs Standard changes *feature availability*, not just quota (custom auth, SLA,
  domain counts). Where that leaks into the UI.
- How this differs from App Service, since that is the comparison most readers arrive with.

## 2. Environments (builds) -- the central oddity

- Environments come from `listStaticSiteBuilds`, not from the ARM resource listing, so
  they are **not ARM resources** and have no id of their own in a resource graph sense.
  Consequence: virtual nodes, and a synthesized `${site.id}/builds/${buildId}` for portal links.
- `buildId === 'default'` is the magic string meaning production. Everything else is a
  preview environment. Where else that string is load-bearing.
- Preview environments are created and destroyed by pull request open/close, so this
  data is volatile in a way most Azure tree data is not. What that means for caching
  and refresh.
- A preview environment's display name is `pullRequestTitle` -- i.e. **arbitrary
  user-authored text**, with no service-side constraints. The class of bugs that causes
  (see the settings document-name sanitizing, `SettingsUri`).
- `sourceBranch` arrives as `GitHubAccount:branch` for fork-based PRs, hence
  `normalizeStaticWebAppBranch`. Why the production build is exempt from that normalizing.
- Each environment carries its own `hostname`, which is why every environment is
  independently browsable and why browse is no longer a Static Web Apps-specific command.
- Ordering: production first, then label order. Why that is stable and not just cosmetic.

## 3. Application settings -- two dictionaries, and why we use the other one

- ARM exposes **two** settings pairs per site: app settings (`config/appsettings`) and
  *function* app settings. Spell out what each one actually is.
- Function app settings reject reads *and* writes with `Operation not supported: A
  function must first be deployed to use this method.` until a managed API exists.
- The standalone extension used the function pair, which is why its Application
  Settings node only appeared once an API was deployed -- a limitation of the extension,
  not of the product. Worth stating plainly so nobody "restores" the old behavior.
- Site-level and build-level endpoints are **distinct dictionaries**. Picking the wrong
  pair silently edits the wrong environment. Which call goes with which environment.
- Writes replace the whole dictionary; there is no per-key patch. What that implies for
  concurrent edits.
- The settings *owner* is the environment (a virtual node), not the ARM resource --
  unlike every other product. Link to the settings-owner widening.
- **Open question:** does a deployed managed function read `config/appsettings` at
  runtime, or only the function pair? Resolve or record as unknown.

## 4. The managed API (Functions)

- Managed functions vs bring-your-own-Functions, and which one the tree can see.
- We use a settings endpoint as a **feature probe** -- a rejection means "no API here."
  Why there is no cleaner capability check, and why that is not the same dictionary the
  settings editor uses.
- Production lists site-level functions; a preview environment lists build-level ones.
- What the user can and cannot do with a function node, and why it is read-only.

## 5. Creation and deployment routing

- Creation is azd + Bicep here, not the ARM-wizard shape the old extension used. What
  the user is actually agreeing to.
- `azure.yaml`, the `host: staticwebapp` service, and the meaning of `dist` and `project`.
- Why path resolution mirrors **Go's** `filepath` rules rather than Node's: azd is a Go
  binary on the same machine, and the two disagree for a singly-rooted `/foo` on Windows.
  Probably the single least-guessable thing in the codebase.
- Why "no service configured" and "service configured but invalid" are distinguished
  rather than collapsed into one unsupported message.
- Next.js hybrid/SSR cannot be deployed as a static artifact, and that is unrelated to
  configuration validity -- hence a separate reason code and separate wording.
- CI/CD provider conflict: we never overwrite the other provider's workflow file;
  `azd pipeline config` owns those paths. What we do instead.
- **Open question:** `MinAzdPipelineVersion` -- verify against azd release notes.

## 6. Local development: the SWA CLI

- The CLI is an npm global (`@azure/static-web-apps-cli`), installed on demand, with a
  minimum supported version. Why it is not bundled or pinned.
- What the emulator actually does: serves the app on `:4280` and proxies a Functions
  host on `:7071`, reproducing the routing/auth layer the service applies in the cloud.
  This is the reason local dev is not just "run your dev server."
- `swa-cli.config.json` and how our task generation reads it.
- Why generated tasks disappear when the CLI is not on `PATH` (the shared task helper
  pins a bare name to an absolute path and refuses to hand an unresolved name to a
  shell), and why F5 still works: the debug flow prompts to install first.
- Why the "newer CLI available" check runs when something needs the CLI, not at
  activation -- this is a multi-product extension and a config file in the workspace is
  not consent to spawn npm and hit the registry.
- Data API: `staticwebapp.database.config.json`, `--data-api-location`, and why the
  workspace root is deliberately not a candidate folder.

## 7. The three config files people confuse

- `staticwebapp.config.json` -- routes, `navigationFallback`, auth. Service-side.
- `swa-cli.config.json` -- local CLI only.
- `staticwebapp.database.config.json` -- data API.
- A sentence each on who reads them and when, because the names are nearly identical.
- Build presets: the `appLocation` / `apiLocation` / `outputLocation` triple, what each
  is relative to, and why some presets (Next.js SSR) legitimately have empty values.

## 8. Identity and naming gotchas

- `Microsoft.Web/staticSites` shares its ARM namespace with App Service, so icons and
  logical types need the extra branch. Point at the icon-filename convention.
- Where localized display strings do and do not belong (production's label is localized
  in the data layer today -- flag it if that is still true when you write this).
- Fork PRs, arbitrary titles, and separators: the inputs that reach an id or a URI.

## 9. Git and auth touchpoints

- Why we inspect the git remote at all, and what we do with GitHub vs Azure DevOps.
- Hostname matching is case-insensitive; suffix matching is separate. Why both exist.

## 10. Known gaps and deliberate omissions

- What the migration dropped on purpose (point at the feature inventory rather than
  repeating it).
- Behaviors we have not verified against the live service.
- Places where the service's own docs are silent and we are relying on observed behavior.
