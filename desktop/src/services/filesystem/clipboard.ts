export async function copyTextToClipboard(text: string) {
  const content = String(text ?? '')
  if (!content) {
    throw new Error('没有可复制的内容。')
  }

  if (window.desktopAPI?.copyText) {
    try {
      await window.desktopAPI.copyText(content)
      return
    } catch {
      // Fall back to renderer-side copy when an older preload exposes a broken clipboard bridge.
    }
  }

  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(content)
    return
  }

  const textarea = document.createElement('textarea')
  textarea.value = content
  textarea.setAttribute('readonly', 'true')
  textarea.style.position = 'fixed'
  textarea.style.left = '-9999px'
  textarea.style.top = '-9999px'
  textarea.style.opacity = '0'
  document.body.appendChild(textarea)
  textarea.focus()
  textarea.select()

  const copied = document.execCommand('copy')
  document.body.removeChild(textarea)
  if (!copied) {
    throw new Error('当前环境不支持复制。')
  }
}
