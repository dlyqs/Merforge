# Task graph validation

`taskGraphErrors` checks a complete tree: unique identities and required root, known phases and parents, unique existing dependencies, phase order, hierarchy cycles, and cycles including required-child completion. A unique root with valid parents and no hierarchy cycle implies connectivity. Input JSON validation belongs to each consumer.

Personal workflow and organization WorkGraph both consume this library. It imports no Session, storage, service or plugin runtime. See [organization WorkGraph](../../../../docs/organization-workgraph.md) for the organization data model.

## Model Experience

No model requests, tools, prompt text or Session events; no token or KV-cache effects.

## Known Limitations and Deferred Work

The function requires the complete definition, never a permission-filtered view. It does not authorize access or implement execution. No invariant companion is published: it owns no mutable state or independent observations.
