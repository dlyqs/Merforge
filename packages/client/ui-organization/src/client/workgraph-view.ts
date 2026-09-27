/** Presentation of authorized task pages; hidden ancestors are never synthesized. */
import type { OrganizationTaskView } from '@deepseek-ai/dsh-organization'
import { zh, type OrganizationKey } from './locales.ts'

/**
 * Map native failures to product copy without displaying server text.
 * @param error - Native failure.
 * @returns Localized failure key.
 */
export function workgraphError(error: unknown): OrganizationKey {
  const message = error instanceof Error ? error.message : ''
  return (Object.keys(zh) as OrganizationKey[]).find(key => message === key || message.endsWith(`: ${key}`)) ?? 'failure'
}
/**
 * Order one page using only its authorized parent relationships.
 * @param items - One authorized page.
 * @returns Parent-first rows with depth limited to visible parents on this page.
 */
export function taskRows(items: OrganizationTaskView[]): { task: OrganizationTaskView; depth: number }[] {
  const output: { task: OrganizationTaskView; depth: number }[] = []
  const visit = (task: OrganizationTaskView, depth: number) => {
    output.push({ task, depth })
    for (const child of items.filter(item => item.planId === task.planId && item.parentTaskId === task.id)) visit(child, depth + 1)
  }
  const roots = items.filter(item => !items.some(parent => parent.planId === item.planId && parent.id === item.parentTaskId))
  for (const task of roots) visit(task, 0)
  return output
}
