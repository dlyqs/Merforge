/** Whole-definition editing retains task identities and relations from an authorized full read. */
import { Button, Input } from '@deepseek-ai/dsh-client-ui-primitives'
import type { OrganizationPlanDefinition, OrganizationTaskId } from '@deepseek-ai/dsh-organization'
import type { ConnectionSnapshot } from '@deepseek-ai/dsh-organization-connection/types'
import { MemberSelect } from './MemberSelect.tsx'
import type { OrganizationProps } from './contract.ts'
import css from './Organization.module.css'

/** @param props - Complete draft, selected node and local mutation callbacks. @returns Text-only task editor. */
export function TaskEditor(props: Pick<OrganizationProps, 't'> & {
  connection: ConnectionSnapshot
  definition: OrganizationPlanDefinition
  taskId: OrganizationTaskId
  disabled: boolean
  change: (definition: OrganizationPlanDefinition) => void
  save: () => void
}) {
  const { definition, taskId, t } = props
  const task = definition.tasks.find(item => item.id === taskId)
  if (!task) throw new Error('organization: selected draft task is missing')
  const update = (patch: Partial<typeof task>) =>{  props.change({ ...definition,
    tasks: definition.tasks.map(item => item.id === taskId ? { ...item, ...patch } : item) }) }
  const valid = !!task.goal.trim() && !!task.scope.trim() && task.acceptance.some(text => text.trim())
  return <form onSubmit={(event) => { event.preventDefault(); if (valid && !props.disabled) props.save() }}>
    <fieldset className={css.form} disabled={props.disabled}>
      <label className={css.field}>{t('taskGoal')}<Input autoFocus required placeholder={t('taskGoalPlaceholder')} value={task.goal} onChange={(event) =>{  update({ goal: event.target.value }) }} /></label>
      <label className={css.field}>{t('taskScope')}<textarea required placeholder={t('taskScopePlaceholder')} value={task.scope} onChange={(event) =>{  update({ scope: event.target.value }) }} /></label>
      <label className={css.field}>{t('taskAcceptance')}<textarea required placeholder={t('taskAcceptancePlaceholder')} value={task.acceptance.join('\n')} onChange={(event) =>{  update({ acceptance: event.target.value.split('\n') }) }} /></label>
      <details className={css.advanced} open={task.artifacts.length > 0 || task.suggestedMembershipId !== null ? true : undefined}>
        <summary>{t('optionalTaskFields')}</summary><div className={css.form}>
          <label className={css.field}>{t('taskArtifacts')}<textarea value={task.artifacts.join('\n')} onChange={(event) => { update({ artifacts: event.target.value ? event.target.value.split('\n') : [] }) }} /></label>
          <MemberSelect t={t} connection={props.connection} labelKey="suggestedMember" value={task.suggestedMembershipId ?? ''}
            change={(value) => {
              update({ suggestedMembershipId: value ? value as NonNullable<typeof task.suggestedMembershipId> : null })
            }} />
          <p className={css.muted}>{t('suggestionHint')}</p>
        </div>
      </details>
      <Button type="submit" variant="primary" disabled={!valid}>{t('saveTask')}</Button>
    </fieldset>
  </form>
}
