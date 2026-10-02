/** Source imports for the conversation-to-delivery fixture. */
import Conversation from '@deepseek-ai/dsh-organization-conversation'
import Credentials from '@deepseek-ai/dsh-credentials-local'
import { organizationConversation } from '../../desktop/src/organization-conversation.ts'
import { kit as executionKit } from './organization-execution-source-kit.ts'
export const kit = { ...executionKit, Conversation, Credentials, organizationConversation }
