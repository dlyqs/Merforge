/** Installs Windows traffic lights and synchronizes the native menu language. */
import { ipcRenderer } from 'electron'
import { DESKTOP_IPC } from './ipc.ts'
import { resolveDesktopLocale } from './locale.ts'

/** Install localized Windows window controls in the persistent left navigation rail. */
export function syncWindowsAppearance(): void {
  if (process.platform !== 'win32') return
  const install = (): void => {
    const root = document.documentElement
    const host = document.createElement('div')
    host.dataset.windowsWindowControls = ''
    host.style.cssText = 'position:fixed;top:16px;left:6px;z-index:2147483647;-webkit-app-region:no-drag'
    const shadow = host.attachShadow({ mode: 'closed' })
    const style = document.createElement('style')
    style.textContent = `
      .controls { display:flex;align-items:center;gap:8.5px;-webkit-app-region:no-drag; }
      button { position:relative;display:flex;align-items:center;justify-content:center;width:13.5px;height:13.5px;border:0;border-radius:50%;padding:0;cursor:pointer;-webkit-app-region:no-drag; }
      button:active { filter:brightness(.8); }
      button:focus-visible { outline:2px solid currentColor;outline-offset:2px; }
      .close { background:#ff5f57; }
      .minimize { background:#febc2e; }
      .maximize { background:#28c840; }
      span { position:relative;width:8px;height:8px;opacity:0;pointer-events:none; }
      .controls:hover span,.controls:focus-within span { opacity:1; }
      span::before,span::after { content:'';position:absolute;left:50%;top:50%;border-radius:999px;transform:translate(-50%,-50%); }
      .close span::before,.close span::after { width:8.8px;height:1.9px;background:rgba(92,31,25,.74); }
      .close span::before { transform:translate(-50%,-50%) rotate(45deg); }
      .close span::after { transform:translate(-50%,-50%) rotate(-45deg); }
      .minimize span::before { width:8.5px;height:2px;background:rgba(119,73,12,.78); }
      .maximize span::before,.maximize span::after { background:rgba(25,91,31,.78); }
      .maximize span::before { width:8.5px;height:1.9px; }
      .maximize span::after { width:1.9px;height:8.5px; }
    `
    const controls = document.createElement('div')
    controls.className = 'controls'
    const buttons = (['close', 'minimize', 'maximize'] as const).map(action => {
      const button = document.createElement('button')
      button.type = 'button'
      button.className = action
      const icon = document.createElement('span')
      icon.setAttribute('aria-hidden', 'true')
      button.append(icon)
      button.addEventListener('click', () => { ipcRenderer.send(DESKTOP_IPC.windowControl, action) })
      controls.append(button)
      return button
    })
    shadow.append(style, controls)
    document.body.append(host)
    const send = (): void => {
      const messages = resolveDesktopLocale(root.lang).messages
      const labels = [messages.windowClose, messages.windowMinimize, messages.windowMaximize]
      buttons.forEach((button, index) => {
        button.setAttribute('aria-label', labels[index]!)
        button.title = labels[index]!
      })
      ipcRenderer.send(DESKTOP_IPC.windowsAppearance, root.lang)
    }
    const observer = new MutationObserver(send)
    observer.observe(root, { attributes: true, attributeFilter: ['lang'] })
    window.addEventListener('pagehide', () => { observer.disconnect(); host.remove() }, { once: true })
    send()
  }
  if (document.readyState === 'loading') window.addEventListener('DOMContentLoaded', install, { once: true })
  else install()
}
