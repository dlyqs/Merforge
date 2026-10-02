# Personal Project and Bot

`ctx.personalProjects` stores Project and Bot records in the `personal_project` domain. A Project has a stable identity and optional canonical local directory. Existing Workspace records are converted into Projects using their IDs, names, directories, and Session affiliations; completed conversions remove the old directory grouping record. Bot profiles contain user-authored instructions, a model preference, and optional tool and Skill allow lists; credentials remain with the existing credentials service.

`personal/affiliation` is the authoritative Session event for the current Project and Bot. Its projection exposes the current IDs and complete transition history. Moving a Session appends an event without changing its ID, messages, or cwd. Deleting an object clears live references before removing the record; recorded name snapshots remain readable. Forked Sessions inherit the event prefix at the fork cut.

## Native Bot defaults

`BotModel.backend` is optional: old records remain API defaults, while `codex` selects native catalog validation. Defaults affect fresh conversations; editing a Bot does not switch existing native selections. Native conversations refuse Bot changes and moves to a different working directory, including cold Sessions. Deletion may remove affiliation. Bot tool/Skill allowlists apply to Harness API execution; native tools and instructions remain Codex-owned.

## Model Experience

The runtime contributes current Project and Bot instructions and recent affiliation transitions to prompt assembly. The Agent loop records the rendered system message and request header, so past requests remain reconstructable. Empty Project and Bot learning memories require no service or prompt content. The Bot tool allow list filters model-visible schemas, PTC SDK declarations, lookup, and dispatch at request time; a final execution guard also rejects forbidden calls. The Bot Skill allow list filters the model catalog, loader, explicit user invocation, and Session skill listing. Bot model preferences are validated when saved and resolved again at the next request; an unavailable route fails the request.

## Known Limitations and Deferred Work

Project and Bot learning memory, cross-conversation tasks, and sharing are deferred. A Project's optional directory selects the cwd for newly created Sessions; moving an existing Session never expands its filesystem authority. Legacy Session migration defers a record whose writer is unavailable and retries it on a later startup before deleting its old grouping record.

No invariant companion is published because Project and Bot records are validated by their storage domain, and Session affiliation is derived from the same event log rather than an independent runtime observation.
