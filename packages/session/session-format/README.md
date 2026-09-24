---
description: "Current Session format values, physical dispatch, and JSON helpers."
kind: "package-library"
---

# @deepseek-ai/dsh-session-format

## Summary

This library validates JSON values and restores the current Session format from physical rows. It rejects files with another format version. Persistence owns compression, file selection, and durability.

## Use this package

`createSessionFormatCatalog()` accepts the current codec, encoder, and header and artifact validators. `readHeader()` classifies a physical header without loading events. `createRestore()` decodes rows and returns a validated current artifact when `finish()` succeeds.

## Implementation

| File | Role |
|---|---|
| [`src/catalog.ts`](src/catalog.ts) | Current-version header and row dispatch |
| [`src/json.ts`](src/json.ts) | Lossless JSON values and coordinate checks |
| [`src/filename.ts`](src/filename.ts) | Canonical versioned Session filenames |

See the [current format package](../session-format-current/README.md) and [JSONL persistence](../session-persistence-jsonl/README.md).
