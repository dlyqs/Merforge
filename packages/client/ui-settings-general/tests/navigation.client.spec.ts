/** Settings shell navigation and return ownership are independent of business writes. */
import { Context } from '@deepseek-ai/cordis'
import { expect, it } from 'vitest'
import { SettingsNavigationService } from '../src/client/navigation.ts'
it('returns to the originating settings section and clears a model target on ordinary navigation', async () => {
  const ctx = new Context()
  const navigation = new SettingsNavigationService(ctx)
  navigation.open('personal')
  navigation.open('models', 'codex')
  expect(navigation.view.getSnapshot()).toEqual({ open: true, section: 'models', target: 'codex', returnSection: 'personal' })
  navigation.close()
  expect(navigation.view.getSnapshot()).toEqual({ open: true, section: 'personal' })
  navigation.open('models', 'api')
  navigation.open('general')
  expect(navigation.view.getSnapshot()).toEqual({ open: true, section: 'general' })
  navigation.close()
  expect(navigation.view.getSnapshot()).toEqual({ open: false })
  await ctx.fiber.dispose()
  expect(ctx.get('settingsNavigation')).toBeUndefined()
})
