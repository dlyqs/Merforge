# @deepseek-ai/dsh-organization-execution

Owns local Run/Session preparation described in the [execution protocol](../../../../docs/organization-execution.md). The service definition and implementation are `OrganizationExecution`; Electron's fixed execution operation and the private Desktop Host IPC controller consume `open`. Organization SQLite remains the sole business authority.

Desktop loads the service with a dedicated `root`. An isolated Cordis context owns a persistent JSONL provider in the `organization-execution` namespace. No Agent, personal preset, tool, credential, model provider or public Remote is registered there. Personal Session and Agent admission, persistence, and consumers of `assertPersonalSessionId` reject execution IDs. Creating a personal child with an organization parent is also refused.

The atomic `organization_execution` domain reserves server/account/Run and operation identities before JSONL creation. A required `organization/execution-binding` event retains the immutable Run, original context Session, exact authorized task, explicit model selection, materials and employee messages. The original two-event `organization-context` log is unchanged. The shared authority receives only the input digest; paths, credentials and full conversations are not uploaded. Changed inputs require a new explicit execution grant and Run.

`open` accepts a strict selector and a private native recheck callback. Native authentication supplies account identity, current execution eligibility and task projection; Renderer cannot choose a Session ID or provide authority. Startup nonce, request and authorization IDs, native generation, owning window and deadlines correlate each exchange. Cancellation and disposal abort pending authorization. Persistence can repair an interrupted matching prefix; mismatched data is refused. Ready state follows flush and independent read, and delivery follows another online recheck.

Cold start verifies reserved/ready bindings, operation references and orphan logs. The `./invariant` companion compares the binding domain and separate JSONL store; Loader tests execute it and exercise persisted corruption. The service never treats a local record or receipt as current execution permission.

## Model Experience

- Model-visible behavior: explicit task and input facts are durably recorded for the future execution adapter; this phase sends no model request.
- Token usage: none. Preparing and reopening do not activate an Agent.
- KV-cache effects: none until Phase 4 supplies the guarded model consumer.

## Known Limitations and Deferred Work

All real effects remain disabled. Guarded model/tools, organization routing/outbound policy enforcement, local directory configuration, live messages, pause/resume and HumanRequest consumers belong to later phases. A prepared Run cannot be resumed automatically after server epoch replacement. Full logs remain local to the employee; shared artifacts require the later upload protocol.
