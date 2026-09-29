# Session format status

## Current writer

`SESSION_FORMAT_VERSION` in [core Session types](../packages/core/session/src/types.ts) identifies the format written by this checkout. The [persistence catalog](persistence-catalog.md) and [machine schema](persistence-schema.json) describe its declared header and events.

The Desktop application creates and reopens Sessions written in the current format. A file with a different format version is refused. Existing Session generations are never rewritten or deleted automatically.

When changing the current format, update the writer, reader, catalog, and affected consumers together.

Goal and plan mode are no longer supported. Logs containing their required `goal/change` or `plan/mode` events are refused by the unknown-event check; existing generations are left intact.

Personal task plans use the separate `personal_workflow` domain version 1. The required `personal-workflow/snapshot` Session event records an exact plan definition and review state. `personal-workflow/mode` records the explicit user mode revision, and `personal-workflow/assessment` records goal routing. The managed method uses the logged `personal-workflow-method` user-message source; selected-task context and authorized continuation use `personal-workflow-execution` and `personal-workflow-continue`. The plan aggregate optionally includes validated execution runs, action receipts, evidence, workspace observations and handoffs; older aggregates without execution fields still load. Readers without that event refuse the log; this adds no Session envelope change and does not bump `SESSION_FORMAT_VERSION`.

Organization execution uses the independent `organization-execution:` JSONL namespace and `organization_execution` domain version 1. Its required `organization/execution-binding` event retains local owner/Run/original-context linkage, exact task, model selection and allowed materials/messages. The reader's known-event list and writer are updated together; older readers refuse the required event. The original `organization-context:` two-event format is unchanged. Personal creation, fork ancestry and persistence refuse both reserved namespaces. This introduces no Session envelope change.

组织执行的内部消费者新增必需的 `organization/execution-action` 事件，保存动作许可及 reserved/issued/settled 本机证据；不识别该事件的旧 reader 拒绝日志。`organization/execution-binding` 可包含显式本机目录和动作/步数/时长上限；旧准备输入仍不能启动执行。逻辑 Session 格式版本不变。Desktop 原生执行入口已开放。Phase 5 的动作事件可附带仅本机的文件路径/字节数/预期哈希，人工答复在显式继续时进入普通 user/message；独立域与 Session envelope 版本不变。组织 SQLite 单调升级至 v8，新增持久运行人工请求，支持 v7 存储与备份迁移。
