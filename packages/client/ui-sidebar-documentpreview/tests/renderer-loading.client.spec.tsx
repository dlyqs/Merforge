// @vitest-environment jsdom
/** Renderer-owned loads retain displayed versions and retire work on reload, replacement, and close. */
import { useEffect, useState } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { OwnerOf } from '@deepseek-ai/dsh-client-ui-slots'
import type { DocumentPreviewDefinition } from '../src/client/document/registry.ts'
import type { DocumentContent } from '../src/client/document/contract.ts'
import { TextPreview, type TextPreviewProps } from '../src/client/TextPreview.tsx'
import { harness, TAB_ID } from './fixtures.client.ts'

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

it('lets a renderer load content, report its version, and reload through the shared toolbar', async () => {
  const h = harness()
  const custom: DocumentPreviewDefinition = {
    id: 'custom-viewer', extensions: ['md'], binaryExtensions: ['md'], title: () => 'Custom', loading: 'renderer',
  }
  const read = vi.fn<(signal: AbortSignal) => Promise<{ text: string; version: string }>>()
    .mockResolvedValueOnce({ text: 'Custom content v1', version: 'v1' })
    .mockResolvedValueOnce({ text: 'Custom content v2', version: 'v2' })
  function CustomBody({ content }: { content: DocumentContent }) {
    const [file, setFile] = useState<{ text: string; version: string; revision: number }>()
    const request = content.kind === 'renderer' ? content : undefined
    const revision = request?.revision
    const displayed = file?.revision === revision ? file : undefined
    useEffect(() => {
      if (revision === undefined) return
      const controller = new AbortController()
      void read(controller.signal).then((file) => {
        if (controller.signal.aborted) return
        setFile({ ...file, revision })
      })
      return () => { controller.abort() }
    }, [revision])
    useEffect(() => { if (displayed !== undefined) request?.loaded(displayed.version) }, [displayed, request?.loaded])
    return <p>{displayed?.text ?? 'Loading custom content'}</p>
  }
  const renderSlot: TextPreviewProps['renderSlot'] = (name: string, input: unknown) => {
    if (name !== 'sidebar.right.tab.document') return null
    const owner = input as OwnerOf<'sidebar.right.tab.document'>
    return <CustomBody content={owner.content} />
  }
  const useDocumentPreviews: TextPreviewProps['useDocumentPreviews'] = selector => selector([custom])
  const view = render(<TextPreview {...h.props()} renderSlot={renderSlot} useDocumentPreviews={useDocumentPreviews} />)
  expect(read).toHaveBeenCalledTimes(1)
  expect(await screen.findByText('Custom content v1')).toBeTruthy()
  expect(h.instance.getSnapshot().byTab[TAB_ID]?.version).toBe('v1')
  act(() => { h.instance.actions.toggledAutoRefresh(TAB_ID) })
  h.setVersion('v2')
  view.rerender(<TextPreview {...h.props()} renderSlot={renderSlot} useDocumentPreviews={useDocumentPreviews} />)
  expect(screen.getByText('changed')).toBeTruthy()
  expect(read).toHaveBeenCalledTimes(1)
  fireEvent.click(screen.getByRole('button', { name: 'reloadNow' }))
  expect(await screen.findByText('Custom content v2')).toBeTruthy()
  expect(read).toHaveBeenCalledTimes(2)
  expect(h.instance.getSnapshot().byTab[TAB_ID]?.version).toBe('v2')
  expect(screen.queryByText('changed')).toBeNull()
  expect(h.read).not.toHaveBeenCalled()
  expect(h.bytes).not.toHaveBeenCalled()
  expect(h.instance.getSnapshot().byTab[TAB_ID]?.complete).toBeUndefined()
})
