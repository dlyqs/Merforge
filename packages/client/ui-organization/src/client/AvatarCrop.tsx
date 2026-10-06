/** Local image decoding, crop preview and bounded PNG portrait encoding. */
import { useEffect, useRef, useState } from 'react'
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { OrganizationProps } from './contract.ts'
import css from './AccountMenu.module.css'

type Props = Pick<OrganizationProps, 't'> & { file: File; busy: boolean; onClose: () => void; onSave: (avatarUrl: string) => Promise<void> }
type Crop = { zoom: number; x: number; y: number }

function constrainCrop(image: HTMLImageElement, crop: Crop): Crop {
  const zoom = Math.max(1, Math.min(4, crop.zoom))
  const side = Math.min(image.naturalWidth, image.naturalHeight) / zoom
  const maxX = (image.naturalWidth - side) / 2, maxY = (image.naturalHeight - side) / 2
  return { zoom, x: Math.max(-maxX, Math.min(maxX, crop.x)), y: Math.max(-maxY, Math.min(maxY, crop.y)) }
}

/**
 * @param props - Selected local image and account-owned save operation.
 * @returns Circular crop preview with wheel zoom and pointer dragging.
 */
export function AvatarCrop({ file, busy, onClose, onSave, t }: Props) {
  const [image, setImage] = useState<HTMLImageElement>()
  const [failed, setFailed] = useState(false)
  const [crop, setCrop] = useState<Crop>({ zoom: 1, x: 0, y: 0 })
  const preview = useRef<HTMLDivElement>(null)
  const drag = useRef<{ pointerId: number; x: number; y: number } | null>(null)
  useEffect(() => {
    let active = true
    const url = URL.createObjectURL(file), decoded = new Image()
    decoded.onload = () => {
      if (active) { setImage(decoded); setCrop({ zoom: 1, x: 0, y: 0 }) }
    }
    decoded.onerror = () => { if (active) setFailed(true) }
    decoded.src = url
    return () => { active = false; URL.revokeObjectURL(url) }
  }, [file])
  useEffect(() => {
    const element = preview.current
    if (!element || !image || busy) return
    const wheel = (event: WheelEvent) => {
      event.preventDefault()
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? element.clientHeight : 1)
      setCrop(current => constrainCrop(image, { ...current, zoom: current.zoom * Math.exp(-delta / 300) }))
    }
    element.addEventListener('wheel', wheel, { passive: false })
    return () => { element.removeEventListener('wheel', wheel) }
  }, [image, busy])
  const side = image ? Math.min(image.naturalWidth, image.naturalHeight) / crop.zoom : 1
  const left = image ? (image.naturalWidth - side) / 2 + crop.x : 0
  const top = image ? (image.naturalHeight - side) / 2 + crop.y : 0
  const save = async () => {
    if (!image) return
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 128
    const context = canvas.getContext('2d')
    if (!context) { setFailed(true); return }
    context.drawImage(image, left, top, side, side, 0, 0, 128, 128)
    try { await onSave(canvas.toDataURL('image/png')) }
    catch (_error) { setFailed(true) }
  }
  return <Modal open onClose={() => { if (!busy) onClose() }} title={t('cropAvatar')} closeLabel={t('close')} className={css.dialog ?? ''}>
    <div className={css.content} aria-busy={busy}>
      <div ref={preview} className={css.cropPreview} data-busy={busy || !image} onPointerDown={(event) => {
        if (!image || busy || event.button !== 0 || drag.current) return
        event.preventDefault()
        event.currentTarget.setPointerCapture(event.pointerId)
        drag.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY }
      }} onPointerMove={(event) => {
        const previous = drag.current
        if (!image || busy || previous?.pointerId !== event.pointerId) return
        const dx = event.clientX - previous.x, dy = event.clientY - previous.y
        const width = event.currentTarget.getBoundingClientRect().width
        drag.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY }
        setCrop((current) => {
          const scale = Math.min(image.naturalWidth, image.naturalHeight) / current.zoom / width
          return constrainCrop(image, { ...current, x: current.x - dx * scale, y: current.y - dy * scale })
        })
      }} onPointerUp={(event) => {
        if (drag.current?.pointerId !== event.pointerId) return
        drag.current = null
        event.currentTarget.releasePointerCapture(event.pointerId)
      }} onPointerCancel={() => { drag.current = null }} onLostPointerCapture={() => { drag.current = null }}>
        {image && <img alt={t('avatarPreview')} src={image.src} draggable={false} style={{
          width: `${image.naturalWidth / side * 100}%`, height: `${image.naturalHeight / side * 100}%`,
          left: `${-left / side * 100}%`, top: `${-top / side * 100}%`,
        }} />}
      </div>
      <p className={css.cropHint}>{t('avatarCropHint')}</p>
      {failed && <p role="alert">{t('failure')}</p>}
      <Button variant="primary" disabled={!image || busy} onClick={() => { void save() }}>{t('saveAvatar')}</Button>
    </div>
  </Modal>
}
