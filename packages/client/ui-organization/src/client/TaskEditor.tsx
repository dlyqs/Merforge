/** Whole-definition editing retains task identities and relations from an authorized full read. */
import { Button, Input } from '@deepseek-ai/dsh-client-ui-primitives'
import type { OrganizationPlanDefinition, OrganizationTaskId } from '@deepseek-ai/dsh-organization'
import type { OrganizationProps } from './contract.ts'
import css from './Organization.module.css'

/** @param props - Complete draft, selected node and local mutation callbacks. @returns Text-only task editor. */
export function TaskEditor(props: Pick<OrganizationProps, 't'> & {
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
  return <form onSubmit={(event) => { event.preventDefault(); props.save() }}>
    <fieldset className={css.form} disabled={props.disabled}>
      <label className={css.field}>{t('taskGoal')}<Input required value={task.goal} onChange={(event) =>{  update({ goal: event.target.value }) }} /></label>
      <label className={css.field}>{t('taskScope')}<textarea required value={task.scope} onChange={(event) =>{  update({ scope: event.target.value }) }} /></label>
      <label className={css.field}>{t('taskAcceptance')}<textarea required value={task.acceptance.join('\n')} onChange={(event) =>{  update({ acceptance: event.target.value.split('\n') }) }} /></label>
      <label className={css.field}>{t('taskArtifacts')}<textarea value={task.artifacts.join('\n')} onChange={(event) =>{  update({ artifacts: event.target.value ? event.target.value.split('\n') : [] }) }} /></label>
      <label className={css.field}>{t('suggestedMember')}<Input value={task.suggestedMembershipId ?? ''} onChange={(event) =>{  update({ suggestedMembershipId: event.target.value ? event.target.value as NonNullable<typeof task.suggestedMembershipId> : null }) }} /></label>
      <p className={css.muted}>{t('suggestionHint')}</p>
      <Button type="submit" variant="primary">{t('saveTask')}</Button>
    </fieldset>
  </form>
}
