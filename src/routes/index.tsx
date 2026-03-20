import { createFileRoute } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { renderConversationToMarkdown } from '../lib/render'
import type { NormalizedConversation } from '../lib/types'
import {
  useEffect,
  startTransition,
  useDeferredValue,
  useRef,
  useState,
} from 'react'

type ConvertInput = {
  url: string
}

type Toast = {
  id: number
  kind: 'error' | 'warning'
  message: string
}

const convertShare = createServerFn({ method: 'POST' })
  .inputValidator((data: ConvertInput) => ({
    url: data.url.trim(),
  }))
  .handler(async ({ data }) => {
    const { convertShareUrlToMarkdown } = await import('../lib/convert')
    const exportedAt = new Date()

    const result = await convertShareUrlToMarkdown(data.url, { exportedAt })

    return {
      conversation: result.conversation,
      exportedAt: exportedAt.toISOString(),
      warnings: result.warnings,
    }
  })

export const Route = createFileRoute('/')({
  component: Home,
})

function Home() {
  const [url, setUrl] = useState('')
  const [conversation, setConversation] = useState<NormalizedConversation | null>(null)
  const [exportedAt, setExportedAt] = useState<string | null>(null)
  const [warnings, setWarnings] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [isPending, setIsPending] = useState(false)
  const [includeSystemMessages, setIncludeSystemMessages] = useState(false)
  const [outputMode, setOutputMode] = useState<'markdown' | 'preview'>('markdown')
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'error'>('idle')
  const [toasts, setToasts] = useState<Toast[]>([])
  const outputSectionRef = useRef<HTMLElement | null>(null)
  const outputBodyRef = useRef<HTMLElement | null>(null)
  const nextToastIdRef = useRef(0)
  const toastTimeoutsRef = useRef(new Map<number, number>())
  const previousFeedbackRef = useRef<{
    error: string | null
    warnings: string[]
  }>({
    error: null,
    warnings: [],
  })

  const markdown =
    conversation && exportedAt
      ? renderConversationToMarkdown(conversation, {
          exportedAt: new Date(exportedAt),
          includeSystemMessages,
        })
      : ''
  const deferredMarkdown = useDeferredValue(markdown)
  const hasResult = deferredMarkdown.length > 0
  const isRenderedPreview = outputMode === 'preview'
  const lineCount = hasResult ? deferredMarkdown.split('\n').length : 0
  const characterCount = hasResult ? deferredMarkdown.length : 0
  const warningCount = warnings.length
  const copyLabel =
    copyState === 'copied'
      ? 'Copied'
      : copyState === 'error'
        ? 'Copy failed'
        : 'Copy Markdown'
  const previewLabel = isRenderedPreview ? 'Show Markdown' : 'Show Preview'

  function removeToast(id: number) {
    const timeoutId = toastTimeoutsRef.current.get(id)

    if (timeoutId !== undefined) {
      window.clearTimeout(timeoutId)
      toastTimeoutsRef.current.delete(id)
    }

    setToasts((current) => current.filter((toast) => toast.id !== id))
  }

  function clearToasts() {
    toastTimeoutsRef.current.forEach((timeoutId) => {
      window.clearTimeout(timeoutId)
    })
    toastTimeoutsRef.current.clear()
    setToasts([])
  }

  function pushToast(kind: Toast['kind'], message: string) {
    const id = nextToastIdRef.current + 1
    nextToastIdRef.current = id

    setToasts((current) => [...current, { id, kind, message }])

    const timeoutId = window.setTimeout(() => {
      removeToast(id)
    }, kind === 'error' ? 7000 : 5600)

    toastTimeoutsRef.current.set(id, timeoutId)
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setIsPending(true)
    setConversation(null)
    setExportedAt(null)
    setError(null)
    setOutputMode('markdown')
    setWarnings([])
    setCopyState('idle')
    clearToasts()

    startTransition(() => {
      convertShare({
        data: {
          url,
        },
      })
        .then((result) => {
          setConversation(result.conversation)
          setExportedAt(result.exportedAt)
          setOutputMode('markdown')
          setWarnings(result.warnings)
        })
        .catch((cause) => {
          const message =
            cause instanceof Error ? cause.message : 'Conversion failed'

          setConversation(null)
          setExportedAt(null)
          setError(message)
          setOutputMode('markdown')
        })
        .finally(() => {
          setIsPending(false)
        })
    })
  }

  async function handleCopy() {
    if (!deferredMarkdown) {
      return
    }

    try {
      await navigator.clipboard.writeText(deferredMarkdown)
      setCopyState('copied')
      window.setTimeout(() => setCopyState('idle'), 1600)
    } catch {
      setCopyState('error')
    }
  }

  function handlePreview() {
    setOutputMode((currentMode) =>
      currentMode === 'preview' ? 'markdown' : 'preview',
    )

    outputSectionRef.current?.scrollIntoView({
      behavior: 'smooth',
      block: 'nearest',
    })

    window.requestAnimationFrame(() => {
      outputBodyRef.current?.scrollTo({
        top: 0,
        behavior: 'smooth',
      })

      outputBodyRef.current?.focus()
    })
  }

  useEffect(() => {
    const previousFeedback = previousFeedbackRef.current

    if (error && error !== previousFeedback.error) {
      pushToast('error', error)
    }

    const previousWarnings = new Set(previousFeedback.warnings)

    warnings.forEach((warning) => {
      if (!previousWarnings.has(warning)) {
        pushToast('warning', warning)
      }
    })

    previousFeedbackRef.current = {
      error,
      warnings,
    }
  }, [error, warnings])

  useEffect(() => {
    return () => {
      toastTimeoutsRef.current.forEach((timeoutId) => {
        window.clearTimeout(timeoutId)
      })
      toastTimeoutsRef.current.clear()
    }
  }, [])

  useEffect(() => {
    if (!hasResult) {
      return
    }

    outputSectionRef.current?.scrollIntoView({
      behavior: 'smooth',
      block: 'start',
    })
  }, [hasResult])

  return (
    <main className="app-shell">
      {toasts.length > 0 ? (
        <div aria-live="polite" className="toast-viewport">
          {toasts.map((toast) => (
            <div
              className={`toast toast-${toast.kind}`}
              key={toast.id}
              role={toast.kind === 'error' ? 'alert' : 'status'}
            >
              <div className="toast-copy">
                <p className="toast-label">
                  {toast.kind === 'error' ? 'Error' : 'Warning'}
                </p>
                <p className="toast-message">{toast.message}</p>
              </div>

              <button
                aria-label={`Dismiss ${toast.kind}`}
                className="toast-close"
                type="button"
                onClick={() => removeToast(toast.id)}
              >
                <span aria-hidden="true">+</span>
              </button>
            </div>
          ))}
        </div>
      ) : null}

      <div className="app-frame">
        <header className="app-header">
          <div className="brand-lockup">
            <img
              src="/logo-mark.svg"
              alt="chatdump logo"
              className="brand-mark"
            />
            <div className="brand-copy">
              <p className="brand-name">chatdump</p>
            </div>
          </div>
        </header>

        <div className="workspace">
          <section
            className={`panel panel-source${hasResult ? ' panel-source-compact' : ''}`}
          >
            <div className="panel-intro">
              <h1>Turn a public ChatGPT share into Markdown.</h1>
              <p className="lead">
                Paste a supported share link to generate a clean transcript
                you can review and copy.
              </p>
            </div>

            <form className="converter-form" onSubmit={handleSubmit}>
              <label className="field">
                <span className="field-label">Public share URL</span>
                <div className="input-shell">
                  <svg aria-hidden="true" className="input-icon" viewBox="0 0 24 24">
                    <path d="M14 5h5v5" />
                    <path d="M10 14 19 5" />
                    <path d="M19 13v4a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h4" />
                  </svg>
                  <input
                    autoComplete="off"
                    className="input"
                    name="url"
                    placeholder="https://chatgpt.com/share/..."
                    required
                    type="url"
                    value={url}
                    onChange={(event) => setUrl(event.target.value)}
                  />
                </div>
                <p className="field-hint">
                  Supports `chatgpt.com/share/...` and
                  `chat.openai.com/share/...`.
                </p>
              </label>

              <div className="form-footer">
                <label className="inline-toggle inline-toggle-home">
                  <input
                    checked={includeSystemMessages}
                    className="inline-toggle-input"
                    type="checkbox"
                    onChange={(event) =>
                      setIncludeSystemMessages(event.target.checked)
                    }
                  />
                  <span aria-hidden="true" className="inline-toggle-control" />
                  <span className="inline-toggle-copy">
                    <span className="inline-toggle-label">
                      Include system roles
                    </span>
                    <span className="inline-toggle-note">
                      Off by default for cleaner exports.
                    </span>
                  </span>
                </label>

                <div className="form-actions">
                  <button className="primary" disabled={isPending} type="submit">
                    <span>
                      {isPending ? 'Generating export...' : 'Generate Markdown'}
                    </span>
                    <svg
                      aria-hidden="true"
                      className="primary-icon"
                      viewBox="0 0 24 24"
                    >
                      <path d="M7 12h10" />
                      <path d="M13 6l6 6-6 6" />
                    </svg>
                  </button>
                </div>
              </div>
            </form>

            {isPending ? (
              <div className="progress-track" aria-label="Processing share link">
                <div className="progress-fill" />
              </div>
            ) : null}
          </section>

          {hasResult ? (
            <section className="panel panel-output" ref={outputSectionRef}>
              <div className="output-header">
                <div className="output-copy-group">
                  <p className="section-label">Output</p>
                  <h2>Markdown export ready</h2>
                  <p className="output-copy">
                    Review the generated transcript, then copy the Markdown
                    directly into your workflow.
                  </p>
                </div>

                <div className="output-actions">
                  <div className="meta-row" aria-label="Export metadata">
                    {lineCount > 0 ? (
                      <span className="meta-pill">{lineCount} lines</span>
                    ) : null}
                    {characterCount > 0 ? (
                      <span className="meta-pill">{characterCount} chars</span>
                    ) : null}
                    {warningCount > 0 ? (
                      <span className="meta-pill meta-pill-warning">
                        {warningCount} warning{warningCount > 1 ? 's' : ''}
                      </span>
                    ) : null}
                  </div>

                  <div className="output-action-row">
                    <button
                      aria-pressed={isRenderedPreview}
                      className="secondary"
                      type="button"
                      onClick={handlePreview}
                    >
                      <svg aria-hidden="true" viewBox="0 0 24 24">
                        <path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6Z" />
                        <circle cx="12" cy="12" r="3" />
                      </svg>
                      <span>{previewLabel}</span>
                    </button>

                    <button
                      className="secondary"
                      type="button"
                      onClick={handleCopy}
                    >
                      <svg aria-hidden="true" viewBox="0 0 24 24">
                        <path d="M9 9h10v12H9z" />
                        <path d="M5 3h10v4H9v10H5z" />
                      </svg>
                      <span>{copyLabel}</span>
                    </button>
                  </div>
                </div>
              </div>

              {isRenderedPreview ? (
                <article
                  className="markdown-preview output-surface"
                  ref={(node) => {
                    outputBodyRef.current = node
                  }}
                  tabIndex={0}
                >
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    components={{
                      a: ({ node: _node, ...props }) => (
                        <a {...props} rel="noreferrer" target="_blank" />
                      ),
                    }}
                  >
                    {deferredMarkdown}
                  </ReactMarkdown>
                </article>
              ) : (
                <pre
                  className="output-surface preview"
                  ref={(node) => {
                    outputBodyRef.current = node
                  }}
                  tabIndex={0}
                >
                  {deferredMarkdown}
                </pre>
              )}
            </section>
          ) : null}
        </div>
      </div>
    </main>
  )
}
