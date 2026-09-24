# Bilingual documentation

Active Agent Notes and the root policy documents remain paired in English and Simplified Chinese. `docs/` pages and READMEs use English only. This page defines the remaining pairing contract; [translation-rules.md](translation-rules.md) and [terminology.md](terminology.md) support the paired records. The extended [.agents/skills/dsh-translate-docs](../../.agents/skills/dsh-translate-docs/SKILL.md) workflow is available only through explicit user invocation.

## The pairing contract

- **Both languages carry equal authority.** A document may be authored and reviewed in either language first — a Chinese-first Agent Note is as legitimate as an English-first one — and the counterpart is translated from it. Neither file outranks the other; what binds them is that they must say the same thing.
- **A pair is three sibling files.** The English `foo.md`, the Chinese `foo.zh.md`, and a consistency record `foo.i18n.yaml`, all in the same directory. No locale directories, no separate translation repo, no interleaved bilingual files. Pairs merge whole: a PR never lands one language without the other two files.
- **The consistency record.** `foo.i18n.yaml` holds the full git blob hash of each side as of the last time the two were confirmed to say the same thing:

  ```yaml
  foo.md: 3f786850e387550fdab836ed7e6dc881de23001b
  foo.zh.md: 89e6c98d92887913cadf06b2adb97f26cde4849b
  ```

  Blob hashes, not commit hashes, so the record is computable for files edited in the same PR (`git hash-object foo.md`) and consistency is a pure content comparison. `--write` stores those snapshots in the local Git object database before recording them, including uncommitted working-tree contents, and pins every distinct stored blob under a content-addressed `refs/dsh/translation-pairing/snapshots/` ref so garbage collection cannot invalidate a recorded recovery pointer. The recorded hashes recover the exact last-confirmed text of either side, so an out-of-sync pair is updated by patching the counterpart minimally against the edited side's diff — never by re-translating whole files. Routine work makes that patch directly; when the user explicitly invokes the extended workflow, `pnpm run gen-translation-brief <pair>` can instead assemble the update at the narrowest safely aligned granularity and `--apply` can splice a code-fence-only change after structural validation. After bringing the pair back in line, `pnpm run verify-translation-pairing --write <pair>` re-records both hashes; that yaml diff is the reviewable act of confirming consistency, which is why `--write` requires naming the pairs you confirmed (`--write --all` is the explicit corpus-wide form).

  When two branches contain valid confirmations of the same pair, the installed `dsh-translation-pairing` Git merge driver composes a new record only if Git's default text merge succeeds for both recorded owner-blob triplets and the merged pair retains its required switchers and structural signature. The Chinese file must retain its English backlink; an authored English source must retain its Chinese link, while a listed generated English source is exempt. Any structure the driver cannot verify remains an ordinary conflict; `pnpm run resolve-translation-pairing-conflicts` applies the same fail-closed operation to a merge that has already stopped, stages every safe pairing record, and exits unsuccessfully when other pairing conflicts remain. The [automatic pairing merges Agent Note](../../.agents/notes/implemented/process/2026-08-08-automatic-translation-pairing-merges.md) owns the mechanism and alternatives.
- **Language switcher.** The Chinese file always links back immediately after its H1 heading with `[English](foo.md) | 中文`. An authored English file reciprocates there with `English | [中文](foo.zh.md)`; a listed generated English source omits that line so it remains byte-identical to generator output.
- **Structure mirrors the counterpart.** Heading depths and order, list kinds, ordered-list starts, list item counts, table row and column counts, semantic link targets with exact query/fragment suffixes, and verbatim code blocks match one to one across the pair. When a relative document link targets the active bilingual corpus, the English side uses its `.md` path and the Chinese side uses its `.zh.md` path. A missing counterpart in that corpus is a pair-completeness error rather than a fallback; targets outside the active corpus keep the authored path. See [translation-rules.md](translation-rules.md) for the full preservation rules. Existing Markdown gates apply to `.zh.md` files unchanged (`verify-md-wrap`, `verify-md-links`).

## The gate: verify-translation-pairing

`pnpm run verify-translation-pairing` (part of `doc-sync`, which contributors run locally for documentation changes and CI runs exhaustively) enforces the contract mechanically:

1. Every active Agent Note and root policy document in scope has a complete pair.
2. Every pair artifact that exists at all is complete and consistent: all three files present, each side's current blob hash equals the recorded one (editing either side without re-confirming the pair goes red), the Chinese side and every authored English source carry their language switchers (listed generated English sources are exempt), every ordinary relative document link uses its source side's target locale, and the structural signatures match in order — heading depths, verbatim code blocks (info string and content), table row and column counts, list kinds, ordered-list starts, item counts, and semantic link targets with exact query/fragment suffixes apart from the switcher.
3. Files listed as `excluded` have no `.zh.md` and no `.i18n.yaml` at all. Frozen Agent Notes under `.agents/notes/archived/` are outside this evolving gate; their dedicated verifier requires and seals the complete existing triplet instead.

Source-oriented code gates consume an exact `.zh.md` fence sequence as a derivative of its unsuffixed sibling instead of compiling or manifesting the same code twice. The sequence must match in length, order, fence kind, and byte-exact body; otherwise both copies remain independently checked and the pairing gate reports the structural mismatch.

`pnpm run verify-translation-pairing --list` prints the current pairing state of every document in scope — missing, out-of-sync, or ok. It never fails; `missing` and `out-of-sync` rows identify violations that the normal check rejects.

`pnpm run verify-translation-pairing <pair...>` checks just the named pairs — any of a pair's three files (or its bare stem) names it — so an update loop verifies its own pair in seconds instead of re-scanning the corpus. The no-argument corpus-wide form is what `doc-sync` and CI run; a scoped green never substitutes for it at PR level.

The practical rule this gate creates: **when a PR edits either side of a paired document, the same PR updates the counterpart directly in one terminology-guided pass and re-records the pair with `--write <pair>`**, exactly like the repo's existing doc-sync rule for code and READMEs. A PR that leaves a pair out of sync goes red in CI.

The gate's limit, stated plainly: **a green gate means the pair was confirmed consistent at these exact contents, not that the confirmation was sound.** It checks hashes and Markdown structure; it cannot judge whether the two sides say the same thing, or whether the wording is accurate, well-termed, and natural — that is the reviewer's half of the contract, per [translation-rules.md](translation-rules.md). A re-recorded pair with a sloppy counterpart passes the gate; it must not pass review.

## Scope and exclusions

**Scope**: the root `CONTRIBUTING.md`, `BRAND_GUIDELINES.md`, and `SAFETY.md` documents, plus active documents under `.agents/notes/**`. `docs/` pages and READMEs are English-only. Frozen `.agents/notes/archived/` triplets are preserved by their dedicated verifier and remain outside the evolving pairing check.

Generated references and graphs under `docs/` have one English source. Their freshness checks remain independent of Agent Note pairing.

Agent Note pairs preserve matching structure and link identity; links to removed Chinese `docs/` and README paths remain in unchanged historical note text. They are not live destinations.

English-only `docs/` and README sources have no language switcher. Paired Agent Notes and root policy documents retain their counterpart links.

**Excluded from active pairing:**

- `docs/AGENTS.md`, `.agents/notes/**/AGENTS.md`, and their `CLAUDE.md` instruction symlinks — agent instructions maintained in English.
- `docs/i18n/terminology.md` and [style-samples.md](style-samples.md) — both are bilingual by construction.
- [translation-prompt.md](translation-prompt.md) — the automated pipeline's prompt template; its body is machine-consumed verbatim, so a paired translation would change pipeline behavior.
- [review-ownership/README.md](../../.github/review-ownership/README.md) — repository-internal approval policy maintained in English only.
- `.agents/notes/archived/` — frozen historical triplets. [`verify-archived-agent-notes`](../../scripts/verify-archived-agent-notes.ts) validates their completeness and content seals; translation maintenance must never rewrite them.

**Pairing requirement**: every current or future Agent Note or root policy document in scope must merge as a complete bilingual pair. [scripts/translation-pairing.manifest.json](../../scripts/translation-pairing.manifest.json) contains explicit exclusions.

## Division of labor

Routine counterparts are updated directly by the working agent in one pass after it loads [terminology.md](terminology.md); it does not invoke a translation skill, generate a briefing, run a separate translation-review pass, or delegate to a subagent. The extended [dsh-translate-docs](../../.agents/skills/dsh-translate-docs/SKILL.md) workflow retains those heavier mechanisms for explicit user invocation. The gate checks pair completeness, recorded hashes, the Chinese backlink and authored-source switcher (with the documented generated-source exception), and its documented structural signature. Review still owns translation quality, terminology, and structural requirements that the signature does not encode. The prompt contract is executable: [scripts/translation-prompt.ts](../../scripts/translation-prompt.ts) renders the committed template (terminology injected; the template carries its own calibrated rules) into either direction and parses the three-section response, while `verify-translation-prompt` exercises both render directions and the checked-in example in `doc-sync`.
