---
description: "Physical codec and validation for the current Session version."
kind: "package-library"
---

# @deepseek-ai/dsh-session-format-current

This package decodes and encodes current Session JSONL records. It validates headers, event relationships, messages, catalog facts, and tool-result content before a persistence handle exposes the restored history. It contains no historical conversion steps.

The [format catalog](../session-format-catalog/README.md) combines this codec with the installed event vocabulary. The [JSONL backend](../session-persistence-jsonl/README.md) owns compression and durable files.
