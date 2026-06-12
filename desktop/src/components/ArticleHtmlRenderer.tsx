import { useEffect, useMemo, useRef, useState } from 'react'
import { cn } from '@/lib/utils'

type ArticleHtmlRendererProps = {
  html: string
  className?: string
}

function hardenArticleHtml(html: string) {
  let stripped = html
    .replace(/<script[\s\S]*?<\/script>/giu, '')
    .replace(/<iframe[\s\S]*?<\/iframe>/giu, '')
    .replace(/<object[\s\S]*?<\/object>/giu, '')
    .replace(/<embed[\s\S]*?>/giu, '')
    .replace(/\*\*([^*<]{1,180})\*\*/gu, '<strong>$1</strong>')

  const appReaderCss =
    '<style>body{overflow:hidden;background:transparent!important;} body h1{display:none!important;} .wrap{max-width:940px!important;padding:0!important;} .article{background:linear-gradient(180deg,rgba(38,40,47,.98),rgba(28,30,36,.98))!important;border-color:rgba(255,255,255,.11)!important;box-shadow:none!important;} .article-section:not(.article-section--takeaway){background:transparent!important;border-width:1px 0 0!important;border-radius:0!important;padding:24px 0 0!important;margin:24px 0 0!important;} .article-section--takeaway{border-color:rgba(255,189,46,.28)!important;} .source{margin-top:0!important;}</style>'
  if (/<\/head>/iu.test(stripped)) {
    stripped = stripped.replace(/<\/head>/iu, `${appReaderCss}</head>`)
  }

  if (/<html[\s>]/iu.test(stripped)) return stripped

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <style>
    body { margin:0; padding:0; background:transparent; color:#e8e8e8; font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; }
    .wrap { max-width:940px; margin:0 auto; padding:0; }
    h1 { font-size:30px; line-height:1.25; margin:0 0 10px; color:#fff; }
    h2 { font-size:20px; line-height:1.45; margin:30px 0 12px; color:#fff; }
    h3 { font-size:16px; line-height:1.55; margin:24px 0 10px; color:#f7f7f7; }
    p, li { font-size:15px; line-height:1.9; color:#e5e7eb; }
    ul { padding-left:20px; }
    blockquote { margin:18px 0; padding:14px 18px; border-left:3px solid #ffbd2e; background:rgba(255,255,255,.055); color:#f6f6f6; }
  </style>
</head>
<body><main class="wrap">${stripped}</main></body>
</html>`
}

export function ArticleHtmlRenderer({ html, className }: ArticleHtmlRendererProps) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null)
  const timersRef = useRef<number[]>([])
  const [height, setHeight] = useState(720)
  const srcDoc = useMemo(() => hardenArticleHtml(html), [html])

  useEffect(() => {
    return () => {
      timersRef.current.forEach((timer) => window.clearTimeout(timer))
      timersRef.current = []
    }
  }, [])

  const measureHeight = () => {
    const documentElement = iframeRef.current?.contentDocument?.documentElement
    const body = iframeRef.current?.contentDocument?.body
    const nextHeight = Math.max(
      documentElement?.scrollHeight ?? 0,
      body?.scrollHeight ?? 0,
      720,
    )
    setHeight(Math.min(nextHeight + 4, 24000))
  }

  const handleLoad = () => {
    timersRef.current.forEach((timer) => window.clearTimeout(timer))
    timersRef.current = []
    measureHeight()
    timersRef.current = [
      window.setTimeout(measureHeight, 120),
      window.setTimeout(measureHeight, 480),
    ]
  }

  return (
    <iframe
      ref={iframeRef}
      title="文章 HTML 阅读稿"
      srcDoc={srcDoc}
      sandbox="allow-same-origin"
      className={cn('block w-full border-0 bg-transparent', className)}
      style={{ height }}
      onLoad={handleLoad}
    />
  )
}
