# Telemetry usage (collect + analyze)

Real usage is one of the strongest signals a human uses to decide **Migrate vs Drop** during the later
feature migration. This skill's job is to **collect actual usage for every feature in a single query, attach
it to the inventory, and offer an advisory suggestion** per feature — and to answer the user's targeted
follow-up questions by running scoped queries (or handing back a one-click link).

> **Posture**
> - **Collect, don't guess.** When telemetry is reachable (see auth below), run the one generic query and use
>   the numbers. Only when telemetry is *not* reachable do you fall back to emitting links for the human.
> - **Prefer Azure MCP.** Use the Azure MCP server's `kusto` tool with the `kusto_query` command when it is
>   available. It does not remove the corporate VPN requirement. If Azure MCP or that command is unavailable,
>   use the direct `az` token + ADX REST procedure below.
> - **Suggest, don't decree.** A usage-based suggestion (`lean Migrate` / `candidate Drop` / `needs a human`)
>   is a recommendation with its numbers, window, and confidence attached. The **final Migrate/Drop call stays
>   with the human** (and the migration skill's triage gate). Never silently turn a low count into a verdict.
> - **Respect the guardrails.** Suppression, cancellation, internal-only usage, small samples, and
>   renamed/derived event names all distort a naive read. The guardrails below are mandatory before any
>   suggestion.
> - **Never commit raw telemetry results.** The counts, result-state tables, and exported rows are
>   session/scratch only. A committed artifact (`INVENTORY.md`, `TRIAGE.md`) may record the **decision and a
>   qualitative rationale** ("dropped: low external usage per telemetry") but **not** the raw numbers or result
>   tables. KQL text and ADX deeplinks are queries, not data, and may be committed. See "Committing" below.

---

## Where telemetry events come from

Azure VS Code extensions emit one telemetry event per instrumented callback via
`callWithTelemetryAndErrorHandling('<callbackId>', ...)` (and the `registerCommand*` wrappers, which call it
internally). Every event lands in the shared **`RawEventsVSCodeExt`** table.

**EventName convention (verified):**

```
<extensionId>/<callbackId>          all lowercased
```

- For a **contributed command**, `callbackId` is the command id
  (e.g. `staticwebapps.clonerepo` -> `ms-azuretools.vscode-azurestaticwebapps/staticwebapps.clonerepo`).
- For **non-command instrumented callbacks** (task providers, resolvers, wizard bookkeeping, activation),
  `callbackId` is whatever string the code passes — it may not be a command id
  (e.g. `staticwebapps.providetasksforworkspacefolder`, a task-provider callback).

**What does NOT have its own event:** pure declarative surfaces with no callback (a setting, a menu container,
a `problemMatcher`), and dead/orphan strings. These get **no** usage row — record "no direct telemetry event"
rather than fabricating one.

---

## The table: `cluster('ddtelvscode').database('VSCodeExt').RawEventsVSCodeExt`

`RawEventsVSCodeExt` is a **shared, multi-extension table** — every VS Code extension (and Copilot itself)
writes to it, so it has many columns irrelevant to a single extension. **Always** filter by `ExtensionName`.

Decision-relevant columns (the ones the queries below use):

| Column | Type | Use in usage analysis |
|--------|------|-----------------------|
| `EventName` | string | The `<extId>/<callbackId>` event id (lowercased). Primary per-feature key. |
| `ExtensionName` | string | `ms-azuretools.vscode-<service>`. **Always filter on it first.** |
| `ServerTimestamp` | datetime | Time window (`ago(90d)` etc.). Prefer over `ClientTimestamp`. |
| `VSCodeMachineId` | string | `dcount()` for unique users (machines). |
| `IsInternal` | bool | **Key signal.** `IsInternal == false` isolates *external* (non-Microsoft) usage. |
| `Properties` | dynamic | `Properties['result']` (`Succeeded`/`Failed`/`Canceled`), `Properties['error']`, `Properties['isactivationevent']`, plus per-feature custom props. |
| `Measures` | dynamic | Numeric per-feature dims (`duration`, command-specific ones). |
| `ExtensionVersion` | string | Break down adoption by version, or scope to recent versions. |
| `Platform`, `GeoCountryRegionIso`, `GeoCity` | string | Optional breakdowns for targeted questions. |
| `VSCodeVersion` | string | Break down by VS Code version if needed. |

`Properties` and `Measures` are `dynamic` — index into them with bracket notation and coerce
(`tostring(Properties['result'])`, `toreal(Measures['duration'])`).

Full column list (from `RawEventsVSCodeExt | getschema`, for reference when answering ad-hoc questions —
most are Copilot/LSP fields, not used here):

```
ABExpAssignmentContext, Attributes, AvgChunkSize, ClientTimestamp, Command, ConversationId,
CopilotTrackingId, DataHandlingTags, DevDeviceId, Duration, DurationMS, EventName, ExtensionName,
ExtensionVersion, GeoCity, GeoCountryRegionIso, IntentId, IsEntireFile, IsInternal, Isbyok,
LanguageServerVersion, Measures, Method, Model, NovaProperties, NumRequests, Outcome, Participant,
Platform, PlatformVersion, PromptTokenCount, Properties, RequestId, ResponseTokenCount, ResponseType,
Rounds, SKU, SQMMachineId, SchemaVersion, ServerTimestamp, Source, SurvivalRateFourgram, Tags,
TimeDelayms, TimeToComplete, TimeToFirstToken, TokenCount, ToolCounts, ToolGroupState, ToolName,
TotalNewDiagnostics, Turn, VSCodeMachineId, VSCodeSessionId, VSCodeVersion, WorkloadTags
```

**Result tri-state — keep the three separate.** `Properties['result']` is `Succeeded` | `Failed` |
`Canceled`:
- `Succeeded` — ran to completion.
- `Failed` — errored. A feature that is invoked but mostly *fails* is a **fix** signal, not a Drop signal —
  people wanted it.
- `Canceled` — the **user** backed out (dismissed the wizard/quick pick). This is *not* a failure. A high
  cancellation share means people open the feature but don't follow through — often "just exploring." Surface
  it on its own; never fold it into failures.

---

## The one generic query (run once, covers every feature)

Instead of a query per feature, run **this single query once** to get a per-`EventName` usage table for the
whole extension. Substitute `<extensionId>`; widen `window` for rarely-used features.

```kusto
let ext = '<extensionId>';
let window = 90d;
cluster('ddtelvscode').database('VSCodeExt').RawEventsVSCodeExt
| where ServerTimestamp > ago(window)
| where ExtensionName == ext
| where tostring(Properties['isactivationevent']) != 'true'
| summarize
    Invocations   = count(),
    ExternalUsers = dcountif(VSCodeMachineId, IsInternal == false),
    InternalUsers = dcountif(VSCodeMachineId, IsInternal == true),
    Succeeded     = countif(tostring(Properties['result']) == 'Succeeded'),
    Failed        = countif(tostring(Properties['result']) == 'Failed'),
    Canceled      = countif(tostring(Properties['result']) == 'Canceled'),
    LastSeen      = format_datetime(max(ServerTimestamp), 'yyyy-MM-dd')
    by EventName
| order by ExternalUsers desc
```

- One row per **emitted** EventName — this result set is the **authoritative list of what the extension
  actually emits** (see the derived-name guardrail below).
- `ExternalUsers` is the headline Migrate/Drop signal.
- `InternalUsers` isolates dev/test-only surfaces (external ~0, internal > 0 -> likely Drop for the product).
- Excludes activation pings so counts reflect deliberate invocations.

---

## Auth + execute (how to actually run it)

The `ddtelvscode` cluster trusts the **Microsoft corporate tenant**. Getting this wrong is the #1 failure.

**0. Precheck: corporate VPN.** The cluster is only reachable on the corporate network/VPN. **Confirm the
user is connected to the VPN before doing anything else in this phase** — without it, token acquisition or the
query call fails (timeout / connection refused), wasting a round of tokens and time on a doomed attempt. Ask
explicitly if unsure. If they aren't (or can't) connect, skip straight to the deeplink fallback rather than
retrying the query.

**1. Prefer the Azure MCP server's `kusto` tool.** Invoke its `kusto_query` command with:

| Parameter | Value |
|-----------|-------|
| `cluster-uri` | `https://ddtelvscode.kusto.windows.net` |
| `database` | `VSCodeExt` |
| `query` | The KQL from this procedure |
| `tenant` | `72f988bf-86f1-41af-91ab-2d7cd011db47` |

The Azure MCP path still requires the corporate VPN. Treat a missing Azure MCP server, missing `kusto` tool,
or missing `kusto_query` command as "MCP unavailable" and continue with the direct approach below; do not
treat MCP availability as telemetry availability.

**2. Direct fallback: get a token for the cluster, from the corp tenant explicitly:**

```powershell
$tenant = '72f988bf-86f1-41af-91ab-2d7cd011db47'   # microsoft.com
$token = az account get-access-token `
  --resource 'https://ddtelvscode.kusto.windows.net' `
  --tenant $tenant --query accessToken -o tsv
```

> **Gotcha (verified):** a *default* `az` token — issued from a personal/MSDN or other home tenant — has the
> right audience (`https://ddtelvscode.kusto.windows.net`) and `scp=user_impersonation` but still returns
> **HTTP 401**, with `WWW-Authenticate` pointing at `login.microsoftonline.com/common`. **Always pass
> `--tenant 72f988bf-...`.** Decode the token and confirm `tid` is the corp tenant and `upn` is your
> `@microsoft.com` before blaming the query.

**3. Direct fallback: POST the KQL to the REST endpoint** (v1 is the simplest to parse; `db` names the
database):

```powershell
$body = @{ db = 'VSCodeExt'; csl = $query } | ConvertTo-Json
$r = Invoke-RestMethod -Uri 'https://ddtelvscode.kusto.windows.net/v1/rest/query' `
  -Method Post -Headers @{ Authorization = "Bearer $token" } `
  -ContentType 'application/json' -Body $body
$t = $r.Tables[0]          # v1: Tables[0] = PrimaryResult (Columns + Rows)
$cols = $t.Columns.ColumnName
$t.Rows | ForEach-Object { $row = $_; ($cols | ForEach-Object { "$_=$($row[[array]::IndexOf($cols,$_)])" }) -join '  ' }
```

Execution notes:
- Azure MCP is the preferred query transport, but the query text, cluster, database, VPN requirement, result
  interpretation, and raw-data handling rules are identical for both transports.
- **Token acquisition and the query must run in the same shell invocation** — env vars don't persist between
  this runtime's separate command calls. Acquire `$token` and POST in one call (or re-acquire each call).
- The KQL body may keep the fully-qualified `cluster('ddtelvscode').database('VSCodeExt').RawEventsVSCodeExt`
  prefix (matches the deeplinks) or, since `db` is set, use the bare `RawEventsVSCodeExt` — both work.
- The `v2/rest/query` endpoint returns a multi-frame response; prefer `v1` unless you need v2 features.
- `az` CLI must be present and logged in. If it isn't, or the corp-tenant token can't be obtained (no access),
  **do not block** — fall back to emitting deeplinks (below) so the human can run them.

---

## Map results back to features

The query is keyed by **emitted** `EventName`. Join it to the inventory:

1. For each instrumented feature, you already captured its `<callbackId>` in Phase 3; derive
   `EventName = '<extensionId>/<callbackId>'` (lowercased).
2. Look that EventName up in the result set and attach `ExternalUsers / Succeeded / Failed / Canceled /
   LastSeen`.
3. **Reconcile misses (guardrail — do not skip):** if a feature's derived EventName is **absent** from the
   results, that is **not** proof of "unused." It usually means one of:
   - the callback emits under a **customized event name** (scan the results for a near-match and re-map), or
   - telemetry is **suppressed** for that callback (see below), or
   - it genuinely has no usage in the window.
   Record it as **"no data (verify: renamed? suppressed?)"**, never as "unused."
4. Leftover result rows with **no** matching inventory feature (e.g. `call-tas-error`, `info`,
   `resolveresource`) are framework/plumbing events — note them, don't attribute them to a user feature.

---

## Turn data into a suggestion (advisory)

Rank features by `ExternalUsers` within *this* extension (absolute counts vary wildly by product, so compare
relative to the extension's own distribution). Then apply these defaults — each is a **recommendation with the
numbers attached**, not a decision:

| Observation | Advisory suggestion | Why |
|-------------|--------------------|-----|
| High `ExternalUsers` (top of the distribution), recent `LastSeen` | **lean Migrate** | Clearly in real-world use |
| Near-zero `ExternalUsers` over a wide window, **not suppressed**, name confirmed in results | **candidate Drop / Defer** — flag for human | No evidence of external adoption |
| External ~0 but `InternalUsers` > 0 | **candidate Drop** (dev/test surface) | Used only inside Microsoft |
| High `Failed` share | **Migrate + fix** (not Drop) | People invoke it; it's broken, not unwanted |
| High `Canceled` share | **needs a human** — friction/exploration | Opened-then-dismissed; low follow-through |
| Derived name absent from results | **no data — verify renamed/suppressed** | Absence != unused (guardrail) |

Guardrails that must gate every suggestion:
- **Suppression.** `vscode-azext-utils` callbacks may set `suppressIfSuccessful` (no event on success — only
  failures/cancellations emit) or `suppressAll` (no event at all). A suppressed feature reads as near-zero
  even when heavily used. If Phase 3 flagged suppression for a feature, mark it **non-adoption signal** and do
  **not** suggest Drop on the count.
- **Emitted-name authority.** The generic query's result set is the source of truth for what's emitted;
  reconcile every derived name against it (step 3 above) before trusting a zero.
- **Small samples / short windows.** Widen to `180d`/`365d` before suggesting Drop on a rarely-used feature.
- **Canceled != Failed != unused.** Keep the three distinct in the suggestion rationale.
- Always show the **window** and the **counts** next to the suggestion; a bare verdict is not allowed.

---

## Targeted / ad-hoc questions

When the user asks a specific usage question, translate it to scoped KQL, **run it** (same auth as above), and
report the numbers — or hand back a deeplink if telemetry isn't reachable. Common shapes:

| The user asks... | Scope the generic query with... |
|------------------|--------------------------------|
| "How many people used **X** in the last 7 days?" | `where EventName == '<extId>/<x>'`, `window = 7d`, `dcountif(VSCodeMachineId, IsInternal == false)` |
| "What's the **failure/cancel rate** of the create wizard?" | filter to that EventName; `Succeeded/Failed/Canceled` + ratios |
| "Is usage **trending down**? which version?" | `summarize ExternalUsers = dcountif(...) by bin(ServerTimestamp, 7d)` or `by ExtensionVersion` |
| "Break down by **platform / region**?" | `by Platform` / `by GeoCountryRegionIso` |
| "Which features are **most used** overall?" | the generic query as-is (already ranked) |
| "Show the raw **error messages**?" | `where EventName == ... and Properties['result'] == 'Failed' | summarize count() by tostring(Properties['error'])` |

Report the concrete numbers, the window, and any guardrail caveat (suppression, small N). Offer the matching
one-click deeplink alongside so the user can re-run or share it.

---

## One-click Azure Data Explorer deeplink (handoff + no-access fallback)

Still emit deeplinks: for the roll-up (top of the inventory), for handoff to people without CLI access, and as
the fallback when telemetry can't be reached. The `query` param is the KQL **gzip -> base64 -> URL-encoded**:

```
https://dataexplorer.azure.com/clusters/ddtelvscode/databases/VSCodeExt?query=<encoded>
```

Generate it deterministically (do **not** hand-encode). Node (matches the repo toolchain):

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

If a deeplink can't be produced, emit the **raw query in a fenced block** so the human can paste it — never
drop the usage aid silently.

---

## How it appears in the inventory (working copy)

While you and the human are working the inventory in-session, attach the real numbers — that's the point of
collecting them:

- **Usage summary (top of file):** the generic-query result as a ranked table (EventName, ExternalUsers,
  Succeeded/Failed/Canceled, LastSeen) + the roll-up deeplink. State the **cluster, window, and collection
  date**; if telemetry was unreachable, say so and show links instead of numbers.
- **Commands table `Telemetry` cell:** the feature's numbers + advisory suggestion (e.g.
  `E:375 · ok724/fail1/cancel89 · lean Migrate`) and a drill-in `[usage](<deeplink>)` link; `-` if no callback.
- **Other instrumented features** (task/debug providers, wizard entry points, resolvers): same numbers +
  suggestion inline in that feature's notes.
- **Non-instrumented surfaces** (settings, menu containers, orphan strings): explicitly `no telemetry event`.
- Every suggestion carries its **window + counts + confidence**; the Migrate/Drop verdict is left to the human.

## Committing (raw telemetry must not land in the repo)

Raw telemetry output — the counts, the result-state tables, exported rows — is **session/scratch only and
must never be committed**. When the inventory (or the migration's `TRIAGE.md`) is placed in a tracked folder
(`docs/migrations/<service>/`), **redact the raw numbers first**:

- **Keep in the committed file:** the disposition, the advisory **suggestion**, a **qualitative** rationale
  ("low external adoption per telemetry", "high cancel rate", "no data — likely suppressed"), and the KQL /
  ADX **deeplink** (a query, not data — fine to commit so anyone can re-run it).
- **Strip from the committed file:** the ExternalUsers / Succeeded / Failed / Canceled counts, the ranked
  Usage Summary numbers, last-seen dates tied to counts, and any pasted result rows/CSV/JSON.
- If the human wants the numbers preserved, keep them in an **uncommitted** session artifact (the session
  files dir), not in the tracked `docs/migrations/<service>/` copy.

This mirrors the repo-wide rule in `.github/copilot-instructions.md`.
