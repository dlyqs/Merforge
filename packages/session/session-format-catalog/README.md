---
description: "Static current Session format catalog for persistence readers."
kind: "package-library"
---

# @deepseek-ai/dsh-session-format-catalog

## Summary

`sessionFormatCatalog` binds the installed Session event vocabulary to the current physical codec and validation rules. Persistence uses it to classify headers, decode current rows, and encode new records. Files with another format version are refused.

## Use this package

Import `sessionFormatCatalog` from the package root. Call `readHeader()` for header-only listing, `createRestore()` to decode rows, and `encodeCurrentHeader()` and `encodeCurrentEvent()` to write a Session. Each restore has its own decoder state. The catalog is static; mounting a feature plugin does not change its codec.

## Implementation

[`src/generated.ts`](src/generated.ts) assembles the current codec. [`src/current.ts`](src/current.ts) applies installed Session header, event, message, and delivery validation. The [current format package](../session-format-current/README.md) owns the physical codec and current structural checks.
