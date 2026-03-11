# Telemetry

Every command execution is automatically wrapped with telemetry collection via `IActionExecutor.callWithTelemetryAndErrorHandling()`.

## `IActionContext`

The per-execution telemetry context, injected into commands via DI:

```typescript
interface IActionContext {
    readonly telemetry: {
        readonly id: string;                          // telemetry event name (command ID)
        readonly properties: TelemetryProperties;     // string key-value pairs
        readonly measurements: TelemetryMeasurements; // numeric measurements
        suppress?: 'always' | 'onSuccess';            // opt out of sending
    };

    readonly errorHandling: {
        suppressDisplay?: boolean;     // don't show error toast
        suppressReportIssue?: boolean; // don't show "Report Issue" button
        rethrow?: boolean;             // re-throw after recording
    };
}
```

### Built-in Properties

These are set automatically by `ActionExecutor`:

| Property | Values | Description |
|----------|--------|-------------|
| `result` | `'Succeeded'` \| `'Failed'` \| `'Canceled'` | Set based on whether the callback completed, threw, or was cancelled |
| `correlationId` | UUID | Unique ID for this execution |
| `duration` | number (seconds) | Elapsed time, set in `finally` block |

### Custom Properties

Commands add their own properties for analytics:

```typescript
public async execute(): Promise<void> {
    this.context.telemetry.properties.hello = 'world';
    this.context.telemetry.properties.resourceType = resource.type;
}
```

## `ActionExecutor`

The `callWithTelemetryAndErrorHandling` method wraps every command:

```
┌─ Create IActionContext ──────────────────────────┐
│  Record start time                               │
│  ┌─ Run callback ──────────────────────────────┐ │
│  │  Command sets custom properties/measurements│ │
│  │  Command does its work                      │ │
│  └─────────────────────────────────────────────┘ │
│  On success: result = 'Succeeded'                │
│  On CancellationError: result = 'Canceled'       │
│  On other error: result = 'Failed'               │
│  Calculate duration                              │
│  Send telemetry (unless suppressed)              │
│  If rethrow: re-throw the error                  │
│  Otherwise: return undefined                     │
└──────────────────────────────────────────────────┘
```

### AsyncLocalStorage

`ActionExecutor` uses `AsyncLocalStorage` to make the current `IActionContext` available without explicit parameter threading:

```typescript
// Access the current context from anywhere in the async call chain
const context = actionExecutor.currentContext;
```

## `ITelemetryReporter`

A thin wrapper around `@vscode/extension-telemetry`. Behavior depends on environment:

| `DEBUGTELEMETRY` env | Behavior |
|----------------------|----------|
| unset / `'0'` / `'false'` | Real telemetry via Application Insights |
| `'v'` / `'verbose'` | Logs to console (`DEBUGTELEMETRY: "eventName" Properties: {...}`) |
| any other truthy value | Silent no-op |

During tests (`VSCODE_RUNNING_TESTS=1`), telemetry is suppressed.

## Suppressing Telemetry

For noisy or uninteresting events:

```typescript
// Never send telemetry for this event
context.telemetry.suppress = 'always';

// Only send on failure (skip successful invocations)
context.telemetry.suppress = 'onSuccess';
```

## Activation Telemetry

The `activate` event includes a special measurement:

```typescript
activateContext.telemetry.measurements.loadTimeMs = perfStats.loadEndTime - perfStats.loadStartTime;
activateContext.telemetry.properties.isActivationEvent = 'true';
```

Despite the name, this is broadly used to distinguish events not directly initiated by the user.
