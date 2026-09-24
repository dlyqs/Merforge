# Repository scripts

`package.json` and `lefthook.yml` name the supported entry points. A
`*.spec.ts` file beside a script tests its behavior; it is not another command
to run during ordinary development.

| Family | Purpose | Keep while |
| --- | --- | --- |
| `build.ts`, `clean.ts`, `primary-runtime/` | Build and prepare the Desktop runtime and workspace artifacts. | Desktop is the application entry. |
| `run-oxlint.ts`, `verify-*.ts`, `check-*.sh` | Run static, package, dependency, and release checks. | The named check is in `package.json`, a hook, or a live test/config consumer. |
| `gen-scoped-events.ts`, `gen-workflow-guest.ts`, `gen-client-catalog.ts`, `gen-cordis-catalog.ts` | Generate committed TypeScript modules consumed by runtime packages. | The generated module is imported by product code. |
| `gen-config-catalog.ts`, `gen-tool-catalog.ts`, `gen-doc-graphs.ts`, `gen-module-graph.ts` | Refresh maintained English reference pages; the config catalog also feeds the agent-preset package list. | Those references remain part of the developer documentation. |
| `gen-persistence-catalog.ts` | Document the current Session schema and event types. | Current writer and reader declarations remain aligned. |
| `rescope-vendor.ts`, `gen-third-party-notices.ts`, `verify-package-dependencies.ts` | Maintain vendored names, notices, and workspace dependency rules. | The vendor and package layout stays in use. |
| `fixtures/`, `snapshots/`, `test-*.ts` | Supply focused test and recorded-session inputs. | Their owning tests still run. |

The repository no longer ships the old CI gate scheduler or Python SDK release
workflow. Build and test only the parts relevant to the Desktop change.

When removing another script, check imports, `package.json`, hooks, committed
generated modules, and nearby specs first. A generator can have a runtime
consumer even when its output path is under `docs/`.
