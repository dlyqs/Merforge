# Session format status

## Current writer

`SESSION_FORMAT_VERSION` in [core Session types](../packages/core/session/src/types.ts) identifies the format written by this checkout. The [persistence catalog](persistence-catalog.md) and [machine schema](persistence-schema.json) describe its declared header and events.

The Desktop application creates and reopens Sessions written in the current format. A file with a different format version is refused. Existing Session generations are never rewritten or deleted automatically.

When changing the current format, update the writer, reader, catalog, and affected consumers together.

Goal and plan mode are no longer supported. Logs containing their required `goal/change` or `plan/mode` events are refused by the unknown-event check; existing generations are left intact.

Personal task plans use the separate `personal_workflow` domain version 1. The required `personal-workflow/snapshot` Session event records an exact plan definition and review state. Readers without that event refuse the log; this adds no Session envelope change and does not bump `SESSION_FORMAT_VERSION`.
