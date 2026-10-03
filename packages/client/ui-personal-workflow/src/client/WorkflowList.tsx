/** Secondary task browser and settings navigation entry. */
import { useEffect, useState } from 'react'
import { Button, IconBranchOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PlanView } from '@deepseek-ai/dsh-personal-workflow/types'
import type { WorkflowListProps, WorkflowEntryProps } from './contract.ts'
import { taskWorkspaceStyles as css } from '@deepseek-ai/dsh-client-ui-primitives'

/** @param props - Shared selection and Host plan reader. @returns Scrollable task list. */
export function WorkflowList(props: WorkflowListProps) {
  const { t, actions, list } = props
  const { selected, editing, revision } = props.useStore(value => value)
  const [plans, setPlans] = useState<PlanView[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let active = true
    setLoading(true)
    setError(null)
    void list().then((value) => { if (active) setPlans(value) }, (reason: unknown) => {
      if (active) setError(reason instanceof Error ? reason.message : String(reason))
    }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [list, revision])
  return <div className={css.taskBrowser}>
    {loading && <p role="status" className={css.hint}>{t('loading')}</p>}
    {error !== null && <div><p role="alert" className={css.error}>{t('error', { message: error })}</p><Button disabled={loading || editing} onClick={actions.refresh}>{t('refresh')}</Button></div>}
    {!loading && error === null && plans.length === 0 && <div className={css.empty}><IconBranchOutlineRegular size={28} /><h3>{t('empty')}</h3><p>{t('emptyHint')}</p></div>}
    <nav className={css.planList} aria-label={t('plans')}>{plans.map((plan) => {
      const definition = plan.snapshot.definition
      return <button type="button" className={css.planItem} key={definition.taskId} aria-pressed={selected === definition.taskId}
        disabled={editing || loading} onClick={() => { actions.select(definition.taskId); props.openTasks() }}>
        <IconBranchOutlineRegular />
        <span><strong>{definition.tasks.find(item => item.id === definition.taskId)?.goal}</strong>
          <small>{t('revision', { revision: plan.snapshot.revision })} · {t(plan.snapshot.approval === null ? 'pending' : 'approved')}</small>
        </span>
      </button>
    })}</nav>
  </div>
}

/** @param props - Task navigation callback and localized copy. @returns Settings task entry. */
export function WorkflowEntry(props: WorkflowEntryProps) {
  return <Button variant="ghost" className={css.planEntry} icon={<IconBranchOutlineRegular />} onClick={() => { props.openTasks(); props.onNavigate?.() }}>{props.t('plans')}</Button>
}

/** @returns Task navigation glyph. */
export function WorkflowIcon() { return <IconBranchOutlineRegular size={21} /> }
