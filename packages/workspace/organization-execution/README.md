# @deepseek-ai/dsh-organization-execution

Owns local Run/Session preparation and a restricted internal execution interval described in the [execution protocol](../../../../docs/organization-execution.md). The service definition and implementation are `OrganizationExecution`; Electron's fixed execution operation and the private Desktop Host IPC controller consume `open`. Organization SQLite remains the sole business authority.

Desktop loads the service with a dedicated `root`. An isolated Cordis context owns a persistent JSONL provider in the `organization-execution` namespace. Preparation registers no Agent or tool. The internal `execute` method builds a separate temporary Agent/Session registry using the standard loop, tool registry and filesystem implementation. It registers only its application-owned model adapter and selected `read_file` / `write_file` consumers. Personal presets, prompts, memories, background jobs, terminals and subprocess providers are absent. Personal Session and Agent admission, persistence, and consumers of `assertPersonalSessionId` reject execution IDs. Creating a personal child with an organization parent is also refused.

The atomic `organization_execution` domain reserves server/account/Run and operation identities before JSONL creation. A required `organization/execution-binding` event retains the immutable Run, original context Session, exact authorized task, explicit model selection, materials and employee messages. The original two-event `organization-context` log is unchanged. The shared authority receives only the input digest; paths, credentials and full conversations are not uploaded. Changed inputs require a new explicit execution grant and Run.

`open` accepts a strict selector and a private native recheck callback. Native authentication supplies account identity, current execution eligibility and task projection; Renderer cannot choose a Session ID or provide authority. Startup nonce, request and authorization IDs, native generation, owning window and deadlines correlate each exchange. Cancellation and disposal abort pending authorization. Persistence can repair an interrupted matching prefix; mismatched data is refused. Ready state follows flush and independent read, and delivery follows another online recheck.

Cold start verifies reserved/ready/executing/stopped bindings, operation references, orphan logs and the ordering and Run ownership of durable action evidence. An interrupted or stopped binding refuses another execution until explicit reconciliation is implemented. The `./invariant` companion compares the binding domain and separate JSONL store; Loader tests execute it and exercise persisted corruption. The service never treats a local record or receipt as current execution permission.

## Internal execution consumer

`executionLimits` is an optional validated Config field containing `maxActions`, `maxSteps`, `maxDurationMs`, `maxBytes` and `recheckMs`. Omission disables `execute`; the shipped Desktop composition still omits it. Execution also requires explicit local `inputs.execution` directory and action/step/duration limits, covered by the original configuration digest. Old prepared inputs cannot gain execution permission. The application resolves the adapter; Renderer has no callback or adapter parameter.

`action-guard.ts` reserves a new charged permission per actual model attempt, including retries. It serializes actions, flushes local `reserved` and `issued` evidence, rechecks native identity, lease, exact revision, capability and permit expiry before dispatch, and writes observed settlement before reporting it. Lost acknowledgements halt new work; unknown effects are never replayed. The model adapter's known failure result is recorded separately from an unknown transport or consumer outcome. A completed Run is not an employee submission or task acceptance.

`resources.ts` admits only regular UTF-8 files within the canonical selected directory, rejects traversal, links and Windows alternate path forms, and rechecks the target before the filesystem call. Process-local directory locks reject overlapping roots and are held through cancellation drain. These trusted consumers do not defend against an adversarial OS owner swapping filesystem ancestors concurrently. No model-controlled code or shell executes; shell capability is refused because the existing process sandboxes do not promise restricted reads and network access.

`runtime.ts` mounts the real loop and persistence in a private context, records original task/materials/messages through the normal durable input path, enforces step/action/time/byte limits, checks online authority during in-flight work, and awaits adapter and log teardown. Model output is currently buffered within the byte ceiling before delivery. The required `organization/execution-action` event remains local. The persistence catalog recognizes it; older readers refuse it.

## Model Experience

- Model-visible behavior: preparation sends no request. Internal execution logs the exact task and explicit employee inputs before sending them; selected file tools expose only relative paths and bounded content.
- Token usage: preparation uses none. Each actual execution request or retry requires its own charged permission; step, duration and output-byte ceilings bound the interval.
- KV-cache effects: the isolated Run retains its own logged model history; it never reuses a personal Session or private Bot context.

## Known Limitations and Deferred Work

Desktop IPC still exposes preparation only. The internal executor has real-loop/SQLite/filesystem tests, but native command-channel lifetime, deployment model/outbound policy and the start/stop UI are not yet wired; Phase 4 is incomplete and product execution remains disabled. The existing native general-purpose mutation path changes connection generation, so it cannot be reused directly for each live execution permit. Durable HumanRequest, explicit recovery, organization artifacts and formal submissions are not implemented. A prepared Run cannot resume automatically after server epoch replacement. Full logs remain local to the employee.
