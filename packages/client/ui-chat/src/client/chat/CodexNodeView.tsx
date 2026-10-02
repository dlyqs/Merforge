/** Pure presentation of native observations and authoritative protocol status. */
import type { ChatNodeViewProps } from '../contract/slots.ts'
/**
 * Render raw native execution evidence without inferring usage or task acceptance.
 * @param props - native observation and Chat locale seat.
 * @returns localized outcome or native item detail.
 */
export function CodexNodeView({ node, t }: ChatNodeViewProps<'codex'>) {
  if (node.data.kind === 'item') return <details><summary>{t('codex.nativeItem')}</summary><pre>{node.data.text}</pre></details>
  const status = node.data.status
  return <><p>{t(status === 'completed' ? 'codex.completed' : status === 'interrupted' ? 'codex.interrupted'
    : status === 'failed' ? 'codex.failed' : 'codex.unknown')} · {t('codex.usageUnknown')}</p>{node.data.text !== '' && <pre>{node.data.text}</pre>}</>
}
