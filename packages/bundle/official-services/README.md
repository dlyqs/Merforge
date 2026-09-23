---
description: "Official DeepSeek account, feedback, telemetry, and brand rows for legacy dsh profiles."
kind: "package-bundle"
---

# @deepseek-ai/dsh-official-services

English | [中文](README.zh.md)

## Summary

Legacy public profiles load this layer to offer DeepSeek Platform sign-in, official branding, feedback, and Session telemetry. The Desktop profile omits it and uses API keys without Platform identity. The layer is a profile patch, not a module to import.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

New public `web`, `headless`, `sdk`, and `acp` profiles include this bundle after their shared runtime layers. A custom profile that needs official services can append `@deepseek-ai/dsh-official-services` to `dsh.profile.bundles`. Removing it also removes Platform authentication and official feedback and telemetry rows. API-key model requests remain available through the base layer.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The [bundle patch](cordis.patch.yml) inserts the official rows over the shared base and Web layers. Its manifest owns the dependencies needed to resolve those rows. Desktop does not list this bundle, so its packaged Host closure excludes the official service implementations. Later profile patches can override these rows by id.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Shared base bundle](../base/README.md) — model, tools, and persistence without official services.
- [Web bundle](../web-app/README.md) — Host transport and Client roster.

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through each inserted row's package, which owns that row's model-facing behavior.

#### KV Cache effect

The bundle adds no request prefix of its own; inserted packages own any cache effect.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Explicit bundle lists stay unchanged** — profiles with an older bundle list must add this layer to continue using official account or feedback features.

### Dev Note

<a id="dev-note"></a>

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
