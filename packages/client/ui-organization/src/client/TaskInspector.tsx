/** Task workflow sections shared by the project canvas and conversation canvas. */
import type { ReactNode } from 'react'
import { Button, TaskDetail } from '@deepseek-ai/dsh-client-ui-primitives'
import type { OrganizationTaskView, OrganizationAssignmentId } from '@deepseek-ai/dsh-organization'
import type { OrganizationProjectId } from '@deepseek-ai/dsh-organization/types'
import type { OrganizationProps } from './contract.ts'
import { AssignmentPanel } from './AssignmentPanel.tsx'
import { TaskExecutionStatus } from './TaskExecutionStatus.tsx'
import { ExecutionPanel } from './ExecutionPanel.tsx'
import { IntegrationPanel } from './IntegrationPanel.tsx'
import css from './TaskInspector.module.css'

/**
 * @param props - Authorized task, caller-owned overview and explicit dismissal.
 * @returns Persistent task header and independently navigable workflow sections.
 */
export function TaskInspector(props: OrganizationProps & {
  task: OrganizationTaskView
  projectId: OrganizationProjectId
  current: boolean
  assignmentId?: OrganizationAssignmentId
  overview: ReactNode
  assignmentTools?: ReactNode
  requests?: ReactNode
  onClose: () => void
  onExecute?: () => void
  executeDisabled?: boolean
  onAssignmentRevision?: (revision: number | undefined) => void
}) {
  const { t, task } = props
  return <TaskDetail taskId={task.id} title={task.goal} onClose={props.onClose}
    metadata={[task.phaseTitle, t(task.required ? 'requiredTask' : 'optionalTask'), t('taskVersion', { revision: task.revision })].filter(Boolean).join(' · ')}
    labels={{ taskDetail: t('taskDetail'), hideDetails: t('hideDetails') }} sections={[
      { id: 'overview', label: t('taskOverview'), content: <div className={css.pane}>{props.overview}</div> },
      { id: 'assignment', label: t('taskPreparationTab'), content: <div className={css.pane}>
        <AssignmentPanel {...props} />
        {props.assignmentTools}
      </div> },
      { id: 'execution', label: t('taskExecutionTab'), content: <div className={css.pane}>
        <TaskExecutionStatus {...props} />
        <p className={css.hint}>{t('taskExecutionRouteHint')}</p>
        {props.onExecute && <div className={css.actions}><Button variant="primary" disabled={props.executeDisabled} onClick={props.onExecute}>{t('executeInConversation')}</Button></div>}
        {props.requests}
        <details className={css.advanced}><summary>{t('taskAdvancedExecution')}</summary><ExecutionPanel {...props} section="execution" /></details>
      </div> },
      { id: 'delivery', label: t('taskDeliveryTab'), content: <div className={css.pane}>
        <ExecutionPanel {...props} section="delivery" />
      </div> },
      { id: 'integration', label: t('taskIntegrationTab'), content: <div className={css.pane}>
        <IntegrationPanel {...props} />
      </div> },
    ]} />
}
