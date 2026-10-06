/** Local image decoding, crop preview and bounded PNG portrait encoding. */
import { useEffect, useState } from 'react'
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { OrganizationProps } from './contract.ts'
import css from './AccountMenu.module.css'

type Props = Pick<OrganizationProps, 't'> & { file: File; busy: boolean; onClose: () => void; onSave: (avatarUrl: string) => Promise<void> }

/** @param props - Selected local image and account-owned save operation. @returns Crop preview with zoom and position controls. */
export function AvatarCrop({ file, busy, onClose, onSave, t }: Props) {
  const [image, setImage] = useState<HTMLImageElement>()
  const [failed, setFailed] = useState(false)
  const [zoom, setZoom] = useState(1), [x, setX] = useState(0), [y, setY] = useState(0)
  useEffect(() => {
    let active = true
    const url = URL.createObjectURL(file), decoded = new Image()
    decoded.onload = () => { if (active) setImage(decoded) }
    decoded.onerror = () => { if (active) setFailed(true) }
    decoded.src = url
    return () => { active = false; URL.revokeObjectURL(url) }
  }, [file])
  const side = image ? Math.min(image.naturalWidth, image.naturalHeight) / zoom : 1
  const left = image ? (image.naturalWidth - side) * (x + 1) / 2 : 0
  const top = image ? (image.naturalHeight - side) * (y + 1) / 2 : 0
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
      <div className={css.cropPreview}>{image && <img alt={t('avatarPreview')} src={image.src} draggable={false} style={{
        width: image.naturalWidth * 240 / side, height: image.naturalHeight * 240 / side,
        left: -left * 240 / side, top: -top * 240 / side,
      }} />}</div>
      <label>{t('avatarZoom')}<input type="range" min="1" max="4" step="0.01" value={zoom} disabled={busy} onChange={(e) => { setZoom(Number(e.target.value)) }} /></label>
      <label>{t('avatarHorizontal')}<input type="range" min="-1" max="1" step="0.01" value={x} disabled={busy} onChange={(e) => { setX(Number(e.target.value)) }} /></label>
      <label>{t('avatarVertical')}<input type="range" min="-1" max="1" step="0.01" value={y} disabled={busy} onChange={(e) => { setY(Number(e.target.value)) }} /></label>
      {failed && <p role="alert">{t('failure')}</p>}
      <Button variant="primary" disabled={!image || busy} onClick={() => { void save() }}>{t('saveAvatar')}</Button>
    </div>
  </Modal>
}
