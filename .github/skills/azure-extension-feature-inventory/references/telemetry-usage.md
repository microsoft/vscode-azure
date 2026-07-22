# Telemetry usage links (triage aid)

Usage data is one of the strongest signals a human uses to decide **Migrate vs Drop** during the later
feature migration. This skill's job is to **hand the human a ready-to-run query and a one-click link for
each feature** — not to run the queries and not to make the call.

> **Hard rules for this phase**
> - **Emit links; do not execute.** You have no telemetry tool, and running a query per feature would be
>   expensive and slow. Generate the query + deeplink and put them in the inventory. The human runs the ones
>   they care about.
> - **Do not infer or assert usage.** Never write "this looks unused / low-usage / safe to drop." You have
>   no data. Triage decisions belong to the human (and to the migration skill's triage phase).
> - **Links are an aid, not a verdict.** The inventory stays a factual catalog.

---

## Where telemetry events come from

Azure VS Code extensions emit one telemetry event per instrumented callback via
`callWithTelemetryAndErrorHandling('<callbackId>', ...)` (and the `registerCommand*` wrappers, which call
it internally). The event lands in the shared **`RawEventsVSCodeExt`** table.

**EventName convention (verified):**

```
<extensionId>/<callbackId>          all lowercased
```

- For a **contributed command**, `callbackId` is the command id
  (e.g. `staticwebapps.clonerepo` -> `ms-azuretools.vscode-azurestaticwebapps/staticwebapps.clonerepo`).
- For **non-command instrumented callbacks** (task providers, resolvers, wizard bookkeeping, activation),
  `callbackId` is whatever string the code passes — it may not be a command id
  (e.g. `staticwebapps.providetasksforworkspacefolder`, which is a task-provider callback).

So during Phase 3 (code surfaces), capture the **telemetry callback id** for every instrumented path, not
just command ids. Any feature with a callback id can get a usage link.

**What does NOT have its own event:** pure declarative surfaces with no callback (a setting, a menu
container, a `problemMatcher`), and dead/orphan strings. Give those **no** telemetry link — note "no direct
telemetry event" instead of fabricating one.

---

## The table (`cluster('ddtelvscode').database('VSCodeExt').RawEventsVSCodeExt`)

Decision-relevant columns (full schema is larger; these are the ones the queries use):

| Column | Type | Use in usage analysis |
|--------|------|-----------------------|
| `EventName` | string | The `<extId>/<callbackId>` event id (lowercased). Primary filter. |
| `ExtensionName` | string | `ms-azuretools.vscode-<service>`. Always filter on it. |
| `ServerTimestamp` | datetime | Time window (`ago(28d)` etc.). Prefer over `ClientTimestamp`. |
| `VSCodeMachineId` | string | `dcount()` for unique users. |
| `IsInternal` | bool | **Key signal.** `IsInternal == false` isolates *external* (non-Microsoft) usage. |
| `Properties` | dynamic | `Properties.result` (`Succeeded`/`Failed`/`Canceled`), `Properties.error`, `Properties.isactivationevent`, plus per-feature custom props. |
| `Measures` | dynamic | Numeric per-feature dims (`duration`, and command-specific ones). |
| `ExtensionVersion` | string | Scope to recent versions if needed. |
| `Platform`, `GeoCountryRegionIso` | string | Optional breakdowns. |

Notes:
- `Properties.isactivationevent == 'true'` marks activation, not a deliberate invocation — usually exclude.
- `Properties.result != 'Succeeded'` catches features that fire but fail/cancel (a broken feature can look
  "used" by raw count) — worth surfacing separately.

---

## Canonical per-feature query template

Substitute `<extensionId>` and the lowercased `<callbackId>`:

```kusto
cluster('ddtelvscode').database('VSCodeExt').RawEventsVSCodeExt
| where ServerTimestamp > ago(28d)
| where ExtensionName == '<extensionId>'
| where EventName == '<extensionId>/<callbackId>'
| where tostring(Properties.isactivationevent) != 'true'
| summarize Invocations = count(),
            Users = dcount(VSCodeMachineId),
            ExternalUsers = dcountif(VSCodeMachineId, IsInternal == false),
            Failures = countif(tostring(Properties.result) !in ('Succeeded', ''))
```

- `ExternalUsers` is the headline Migrate/Drop signal.
- `Failures` flags features that are invoked but broken.
- Widen the window (`ago(90d)`) for rarely-used features before concluding anything — but that conclusion is
  the human's to make.

Optional roll-up the human can run once to rank the whole extension (cheaper than per-feature):

```kusto
cluster('ddtelvscode').database('VSCodeExt').RawEventsVSCodeExt
| where ServerTimestamp > ago(28d)
| where ExtensionName == '<extensionId>'
| where tostring(Properties.isactivationevent) != 'true'
| summarize Invocations = count(),
            ExternalUsers = dcountif(VSCodeMachineId, IsInternal == false) by EventName
| order by ExternalUsers desc
```

Offer both in the inventory: a per-feature link **and** this single roll-up link near the top.

---

## Generating the one-click Azure Data Explorer deeplink

ADX web accepts a deeplink whose `query` param is the KQL **gzip -> base64 -> URL-encoded**:

```
https://dataexplorer.azure.com/clusters/ddtelvscode/databases/VSCodeExt?query=<encoded>
```

Generate it deterministically (do **not** hand-encode). Node (portable, matches the repo toolchain):

```js
const zlib = require('zlib');
function adxLink(query) {
  const enc = encodeURIComponent(zlib.gzipSync(Buffer.from(query, 'utf8')).toString('base64'));
  return 'https://dataexplorer.azure.com/clusters/ddtelvscode/databases/VSCodeExt?query=' + enc;
}
```

PowerShell equivalent:

```powershell
function New-AdxLink([string]$q) {
  $bytes = [Text.Encoding]::UTF8.GetBytes($q)
  $ms = [IO.MemoryStream]::new()
  $gz = [IO.Compression.GzipStream]::new($ms, [IO.Compression.CompressionMode]::Compress)
  $gz.Write($bytes, 0, $bytes.Length); $gz.Close()
  $enc = [Uri]::EscapeDataString([Convert]::ToBase64String($ms.ToArray()))
  "https://dataexplorer.azure.com/clusters/ddtelvscode/databases/VSCodeExt?query=$enc"
}
```

Batch it: build the `{ callbackId -> query }` map from the inventory's captured callback ids, run one script
pass to produce all links, then splice them into the tables. Don't spawn a process per feature.

If a deeplink can't be produced for some reason, fall back to emitting the **raw query in a fenced block** so
the human can paste it — never omit the usage aid silently.

---

## How it appears in the inventory

- **Commands table:** add a `Telemetry` column whose cell links the derived EventName's query
  (`[usage](<deeplink>)`), or `-` when the command has no callback.
- **Other instrumented features** (task/debug providers, wizard entry points, resolvers): add the EventName +
  `[usage](<deeplink>)` inline in that feature's notes.
- **Top of the file:** one "usage roll-up" link (the `by EventName` query) so the human can rank everything
  in a single query before drilling in.
- **Non-instrumented surfaces** (settings, menu containers, orphan strings): explicitly `no telemetry event`.

Keep the wording neutral — a link and an EventName, never a usage claim.
