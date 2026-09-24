# Use the Desktop app

English | [中文](index.zh.md)

Open the installed Merforge desktop app. A new installation has no selected workspace until you add one.

## Configure a model

Open **Settings → Models**, enter a [DeepSeek API key](https://platform.deepseek.com/), and save it. The model route becomes usable immediately.

The [model configuration guide](./providers.md) covers other providers and custom OpenAI-compatible endpoints.

## Choose a workspace

Click **Choose workspace**, add a project directory, and select it. The session composer remains unavailable until a workspace is selected.

## Run a task

Start a session and send:

> Summarize this repository and identify its main packages.

The agent can read and edit workspace files, run commands, delegate work, and maintain a plan. The Desktop UI asks before operations that require approval under the active permission policy.

## Continue

- [Configure models](./providers.md)
- [Develop a plugin](../develop/basic/index.md)
