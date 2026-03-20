import { createFileRoute } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useDeferredValue, useEffect, useRef, useState, startTransition } from 'react'
import { Button } from '../components/ui/button'
import { cn } from '../lib/cn'

type ConvertInput = {
  url: string
}

type Toast = {
  id: number
  kind: 'error' | 'warning'
  message: string
}

type PersistedHomeState = {
  markdown: string
  outputMode: 'markdown' | 'preview'
  url: string
  warnings: string[]
}

const monoCapsClass = 'font-mono uppercase tracking-[0.14em]'
const persistedHomeStateKey = 'chatdump.home-state.v1'

function readPersistedHomeState(): PersistedHomeState | null {
  if (typeof window === 'undefined') {
    return null
  }

  try {
    const rawState = window.sessionStorage.getItem(persistedHomeStateKey)

    if (!rawState) {
      return null
    }

    const parsedState = JSON.parse(rawState)

    if (typeof parsedState !== 'object' || parsedState === null) {
      window.sessionStorage.removeItem(persistedHomeStateKey)
      return null
    }

    const outputMode =
      parsedState.outputMode === 'preview' ? 'preview' : 'markdown'
    const url = typeof parsedState.url === 'string' ? parsedState.url : ''
    const markdown =
      typeof parsedState.markdown === 'string' ? parsedState.markdown : ''
    const warnings = Array.isArray(parsedState.warnings)
      ? parsedState.warnings.filter(
          (warning: unknown): warning is string => typeof warning === 'string',
        )
      : []

    if (!url && !markdown && warnings.length === 0 && outputMode === 'markdown') {
      return null
    }

    return {
      url,
      markdown,
      warnings,
      outputMode,
    }
  } catch {
    window.sessionStorage.removeItem(persistedHomeStateKey)
    return null
  }
}

function writePersistedHomeState(state: PersistedHomeState) {
  if (typeof window === 'undefined') {
    return
  }

  window.sessionStorage.setItem(persistedHomeStateKey, JSON.stringify(state))
}

function clearPersistedHomeState() {
  if (typeof window === 'undefined') {
    return
  }

  window.sessionStorage.removeItem(persistedHomeStateKey)
}

const convertShare = createServerFn({ method: 'POST' })
  .inputValidator((data: ConvertInput) => ({
    url: data.url.trim(),
  }))
  .handler(async ({ data }) => {
    const [
      { convertShareUrlToMarkdown },
      { getOrCreateCachedShareMarkdown },
      { validateShareUrl },
    ] = await Promise.all([
      import('../lib/convert'),
      import('../lib/share-cache'),
      import('../lib/url'),
    ])
    const normalizedUrl = validateShareUrl(data.url).toString()

    return await getOrCreateCachedShareMarkdown(normalizedUrl, async () => {
      const exportedAt = new Date()
      const result = await convertShareUrlToMarkdown(normalizedUrl, {
        exportedAt,
      })

      return {
        markdown: result.markdown,
        warnings: result.warnings,
      }
    })
  })

export const Route = createFileRoute('/')({
  component: Home,
})

function Home() {
  const [url, setUrl] = useState('')
  const [markdown, setMarkdown] = useState('')
  const [warnings, setWarnings] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [isPending, setIsPending] = useState(false)
  const [outputMode, setOutputMode] = useState<'markdown' | 'preview'>('markdown')
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'error'>('idle')
  const [toasts, setToasts] = useState<Toast[]>([])
  const [hasHydratedState, setHasHydratedState] = useState(false)
  const urlInputRef = useRef<HTMLInputElement | null>(null)
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
    setError(null)
    setCopyState('idle')
    clearToasts()

    startTransition(() => {
      convertShare({
        data: {
          url,
        },
      })
        .then((result) => {
          setMarkdown(result.markdown)
          setOutputMode('markdown')
          setWarnings(result.warnings)
        })
        .catch((cause) => {
          const message =
            cause instanceof Error ? cause.message : 'Conversion failed'

          setError(message)
        })
        .finally(() => {
          setIsPending(false)
        })
    })
  }

  function handleEditUrl() {
    setMarkdown('')
    setWarnings([])
    setError(null)
    setOutputMode('markdown')
    setCopyState('idle')
    clearToasts()
    previousFeedbackRef.current = {
      error: null,
      warnings: [],
    }

    window.requestAnimationFrame(() => {
      urlInputRef.current?.focus()
      urlInputRef.current?.select()
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
    const persistedState = readPersistedHomeState()

    if (persistedState) {
      setUrl(persistedState.url)
      setMarkdown(persistedState.markdown)
      setWarnings(persistedState.warnings)
      setOutputMode(persistedState.outputMode)
      previousFeedbackRef.current = {
        error: null,
        warnings: persistedState.warnings,
      }
    }

    setHasHydratedState(true)
  }, [])

  useEffect(() => {
    if (!hasHydratedState) {
      return
    }

    if (!url && !markdown && warnings.length === 0 && outputMode === 'markdown') {
      clearPersistedHomeState()
      return
    }

    try {
      writePersistedHomeState({
        url,
        markdown,
        warnings,
        outputMode,
      })
    } catch {
      // Ignore storage failures and keep the in-memory state intact.
    }
  }, [hasHydratedState, markdown, outputMode, url, warnings])

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
    <main className="app-frame">
      {toasts.length > 0 ? (
        <div
          aria-live="polite"
          className="pointer-events-none fixed top-5 right-5 z-30 grid w-[min(24rem,calc(100vw-2rem))] gap-3 max-[720px]:top-4 max-[720px]:right-4 max-[720px]:w-[calc(100vw-2rem)]"
        >
          {toasts.map((toast) => (
            <div
              className={cn(
                'pointer-events-auto grid grid-cols-[minmax(0,1fr)_auto] items-start gap-[0.85rem] rounded-[1.1rem] border p-[0.95rem] pr-[0.95rem] pl-4 shadow-soft backdrop-blur-[20px]',
                toast.kind === 'error'
                  ? 'border-[rgba(142,57,44,0.18)] bg-[linear-gradient(180deg,rgba(255,240,236,0.94),rgba(255,246,242,0.9))]'
                  : 'border-[rgba(156,118,45,0.18)] bg-[linear-gradient(180deg,rgba(255,245,228,0.94),rgba(255,249,240,0.88))]',
              )}
              key={toast.id}
              role={toast.kind === 'error' ? 'alert' : 'status'}
            >
              <div className="grid gap-[0.3rem]">
                <p
                  className={cn(
                    monoCapsClass,
                    'font-mono text-[0.72rem]',
                    toast.kind === 'error'
                      ? 'text-danger-ink'
                      : 'text-warning-ink',
                  )}
                >
                  {toast.kind === 'error' ? 'Error' : 'Warning'}
                </p>
                <p className="leading-[1.6] text-ink">{toast.message}</p>
              </div>

              <button
                aria-label={`Dismiss ${toast.kind}`}
                className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-line bg-white/46 text-ink-soft transition-[transform,background,border-color] duration-[180ms] ease-out hover:-translate-y-px hover:border-line-strong hover:bg-white/68"
                type="button"
                onClick={() => removeToast(toast.id)}
              >
                <span aria-hidden="true" className="inline-block rotate-45 text-base leading-none">
                  +
                </span>
              </button>
            </div>
          ))}
        </div>
      ) : null}

      <div className="mx-auto grid max-w-[1380px] gap-4 max-[720px]:gap-3">
        <header className="flex items-center justify-between gap-4 px-1 pt-1 max-[720px]:px-0">
          <div className="flex items-center gap-[0.9rem]">
            <span className="grid h-12 w-12 place-items-center rounded-2xl border border-[rgba(32,24,17,0.08)] bg-[linear-gradient(135deg,rgba(188,132,66,0.16),rgba(49,67,58,0.08)),rgba(255,255,255,0.56)] shadow-[inset_0_1px_0_rgba(255,255,255,0.45),0_14px_28px_rgba(62,43,23,0.08)]">
              <img
                src="/logo-mark.svg"
                alt="chatdump logo"
                className="h-8 w-8 object-contain"
              />
            </span>
            <div className="grid gap-[0.24rem]">
              <p className={cn(monoCapsClass, 'text-[0.72rem] text-ink-soft')}>
                chatdump
              </p>
            </div>
          </div>
        </header>

        <div className="grid gap-4">
          {!hasResult ? (
            <section
              className="panel-shell grid content-start gap-6 p-6 max-[720px]:gap-5 max-[720px]:rounded-[1.5rem] max-[720px]:p-4"
            >
              <div className="grid gap-3">
                <div className="inline-flex w-fit items-center gap-2 rounded-full border border-[rgba(49,67,58,0.12)] bg-[rgba(255,255,255,0.54)] px-3 py-1.5 font-mono text-[0.72rem] uppercase tracking-[0.12em] text-ink-soft shadow-[inset_0_1px_0_rgba(255,255,255,0.5)] min-[721px]:hidden">
                  <span aria-hidden="true" className="h-2 w-2 rounded-full bg-brass" />
                  Public share export
                </div>

                <div className="grid gap-3">
                  <h1 className="text-[clamp(2.8rem,6.2vw,5.3rem)] font-bold leading-[0.95] tracking-[-0.07em] max-[720px]:text-[clamp(2.15rem,14vw,3.75rem)] max-[720px]:leading-[0.94] max-[720px]:tracking-[-0.08em]">
                    Turn a public ChatGPT share into Markdown.
                  </h1>
                  <p className="max-w-[36rem] text-[1.02rem] leading-[1.72] text-ink-muted max-[720px]:max-w-none max-[720px]:text-[0.97rem]">
                    Paste a supported share link to generate a clean transcript
                    you can review and copy.
                  </p>
                </div>

                <div className="flex flex-wrap gap-2.5 min-[721px]:hidden">
                  <span className="inline-flex min-h-9 items-center rounded-full border border-line bg-white/50 px-3 font-mono text-[0.73rem] uppercase tracking-[0.08em] text-ink-soft">
                    Preview before copy
                  </span>
                  <span className="inline-flex min-h-9 items-center rounded-full border border-line bg-white/50 px-3 font-mono text-[0.73rem] uppercase tracking-[0.08em] text-ink-soft">
                    Clean markdown output
                  </span>
                </div>
              </div>

              <form
                className="form-shell grid gap-4 p-4 max-[720px]:gap-3.5 max-[720px]:rounded-[1.2rem] max-[720px]:p-3.5"
                onSubmit={handleSubmit}
              >
                <label className="grid gap-[0.6rem]">
                  <span
                    className={cn(
                      monoCapsClass,
                      'text-[0.78rem] tracking-[0.12em] text-ink-soft',
                    )}
                  >
                    Public share URL
                  </span>
                  <div className="grid min-h-[3.75rem] grid-cols-[auto_minmax(0,1fr)] items-center gap-[0.8rem] rounded-[1.1rem] border border-line-strong bg-paper-inset pl-[0.95rem] pr-[0.4rem] transition-[border-color,box-shadow,transform] duration-[180ms] ease-out focus-within:-translate-y-px focus-within:border-[rgba(155,106,51,0.48)] focus-within:shadow-[0_0_0_4px_var(--focus)] max-[720px]:min-h-[3.45rem] max-[720px]:gap-[0.65rem] max-[720px]:rounded-[1rem] max-[720px]:pl-[0.85rem] max-[720px]:pr-[0.3rem]">
                    <svg aria-hidden="true" className="h-[1.05rem] w-[1.05rem]" viewBox="0 0 24 24">
                      <path
                        d="M14 5h5v5M10 14 19 5M19 13v4a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h4"
                        className="fill-none stroke-[rgba(22,19,16,0.56)] stroke-[1.9] stroke-linecap-round stroke-linejoin-round"
                      />
                    </svg>
                    <input
                      autoComplete="off"
                      className="min-h-full min-w-0 bg-transparent py-4 pr-[0.75rem] font-mono text-[0.96rem] text-ink outline-none placeholder:text-ink-soft max-[720px]:py-[0.95rem] max-[720px]:pr-[0.55rem] max-[720px]:text-[0.88rem] max-[720px]:placeholder:text-[0.82rem]"
                      inputMode="url"
                      name="url"
                      placeholder="chatgpt.com/share/..."
                      ref={urlInputRef}
                      required
                      type="url"
                      value={url}
                      onChange={(event) => setUrl(event.target.value)}
                    />
                  </div>
                  <p className="font-mono text-[0.8rem] leading-[1.6] tracking-[0.02em] text-ink-soft">
                    Supports `chatgpt.com/share/...` and
                    `chat.openai.com/share/...`.
                  </p>
                </label>

                <div className="grid gap-3 min-[1100px]:items-center">
                  <Button disabled={isPending} type="submit" variant="primary">
                    <span>
                      {isPending ? 'Generating export...' : 'Generate Markdown'}
                    </span>
                    <svg
                      aria-hidden="true"
                      className="h-8 w-8 rounded-full bg-white/8 p-[0.45rem] max-[720px]:h-7 max-[720px]:w-7"
                      viewBox="0 0 24 24"
                    >
                      <path
                        d="M7 12h10M13 6l6 6-6 6"
                        className="fill-none stroke-current stroke-2 stroke-linecap-round stroke-linejoin-round"
                      />
                    </svg>
                  </Button>
                </div>
              </form>

              {isPending ? (
                <div className="h-[0.42rem] overflow-hidden rounded-full bg-[rgba(23,20,17,0.08)]" aria-label="Processing share link">
                  <div className="h-full w-[36%] animate-[slide_1.4s_ease-in-out_infinite] rounded-full bg-[linear-gradient(90deg,var(--brass),var(--brass-strong))]" />
                </div>
              ) : null}
            </section>
          ) : null}

          {hasResult ? (
            <section
              className="panel-shell grid h-[min(32rem,calc(100dvh-3rem))] min-h-[28rem] grid-rows-[auto_1fr] gap-6 p-6 max-[1099px]:h-[min(31rem,calc(100dvh-1.75rem))] max-[1099px]:min-h-[24rem] max-[720px]:h-[calc(100dvh-1.5rem)] max-[720px]:min-h-[29.5rem] max-[720px]:gap-5 max-[720px]:rounded-[1.5rem] max-[720px]:p-4 min-[1100px]:h-[calc(100dvh-8.5rem)]"
              ref={outputSectionRef}
            >
              <div className="flex items-start justify-between gap-4 max-[720px]:flex-col max-[720px]:items-stretch">
                <div className="grid gap-[0.55rem]">
                  <p className={cn(monoCapsClass, 'text-[0.72rem] text-ink-soft')}>
                    Output
                  </p>
                  <h2 className="text-[clamp(1.55rem,3vw,2.2rem)] font-semibold leading-[1.02] tracking-[-0.05em] max-[720px]:text-[clamp(1.4rem,8vw,1.9rem)]">
                    Markdown export ready
                  </h2>
                  <p className="text-[1rem] leading-[1.65] text-ink-muted max-[720px]:text-[0.96rem]">
                    Review the generated transcript, then copy the Markdown
                    directly into your workflow.
                  </p>
                </div>

                <div className="grid w-full gap-3 max-[720px]:justify-items-stretch min-[721px]:min-w-fit min-[721px]:justify-items-end">
                  <div
                    className="flex flex-wrap gap-[0.55rem] max-[720px]:justify-start min-[721px]:justify-end"
                    aria-label="Export metadata"
                  >
                    {lineCount > 0 ? (
                      <span className="inline-flex min-h-8 items-center rounded-full border border-line bg-[rgba(63,47,33,0.05)] px-[0.74rem] font-mono text-[0.74rem] uppercase tracking-[0.08em] text-ink-soft">
                        {lineCount} lines
                      </span>
                    ) : null}
                    {characterCount > 0 ? (
                      <span className="inline-flex min-h-8 items-center rounded-full border border-line bg-[rgba(63,47,33,0.05)] px-[0.74rem] font-mono text-[0.74rem] uppercase tracking-[0.08em] text-ink-soft">
                        {characterCount} chars
                      </span>
                    ) : null}
                    {warningCount > 0 ? (
                      <span className="inline-flex min-h-8 items-center rounded-full border border-[rgba(156,118,45,0.18)] bg-[rgba(156,118,45,0.12)] px-[0.74rem] font-mono text-[0.74rem] uppercase tracking-[0.08em] text-warning-ink">
                        {warningCount} warning{warningCount > 1 ? 's' : ''}
                      </span>
                    ) : null}
                  </div>

                  <div className="grid grid-cols-3 gap-2 min-[721px]:flex min-[721px]:flex-wrap min-[721px]:justify-end">
                    <Button
                      aria-label="Edit URL"
                      className="max-[720px]:min-h-11 max-[720px]:w-11 max-[720px]:justify-center max-[720px]:gap-0 max-[720px]:px-0 max-[720px]:pl-0"
                      onClick={handleEditUrl}
                    >
                      <svg aria-hidden="true" className="h-[1.05rem] w-[1.05rem]" viewBox="0 0 24 24">
                        <path
                          d="M19 12H5M11 6l-6 6 6 6"
                          className="fill-none stroke-current stroke-[1.8] stroke-linecap-round stroke-linejoin-round"
                        />
                      </svg>
                      <span className="hidden min-[721px]:inline">Edit URL</span>
                    </Button>

                    <Button
                      aria-label={previewLabel}
                      aria-pressed={isRenderedPreview}
                      className="max-[720px]:min-h-11 max-[720px]:w-11 max-[720px]:justify-center max-[720px]:gap-0 max-[720px]:px-0 max-[720px]:pl-0"
                      pressed={isRenderedPreview}
                      onClick={handlePreview}
                    >
                      <svg aria-hidden="true" className="h-[1.05rem] w-[1.05rem]" viewBox="0 0 24 24">
                        <path
                          d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6ZM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z"
                          className="fill-none stroke-current stroke-[1.8] stroke-linecap-round stroke-linejoin-round"
                        />
                      </svg>
                      <span className="hidden min-[721px]:inline">{previewLabel}</span>
                    </Button>

                    <Button
                      aria-label={copyLabel}
                      className="max-[720px]:min-h-11 max-[720px]:w-11 max-[720px]:justify-center max-[720px]:gap-0 max-[720px]:px-0 max-[720px]:pl-0"
                      onClick={handleCopy}
                    >
                      <svg aria-hidden="true" className="h-[1.05rem] w-[1.05rem]" viewBox="0 0 24 24">
                        <path
                          d="M9 9h10v12H9zM5 3h10v4H9v10H5z"
                          className="fill-none stroke-current stroke-[1.8] stroke-linecap-round stroke-linejoin-round"
                        />
                      </svg>
                      <span className="hidden min-[721px]:inline">{copyLabel}</span>
                    </Button>
                  </div>
                </div>
              </div>

              {isRenderedPreview ? (
                <article
                  className="output-surface markdown-preview grid h-full gap-4 leading-[1.68] text-ink max-[720px]:gap-3 max-[720px]:text-[0.95rem]"
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
                  className="output-surface m-0 h-full whitespace-pre-wrap font-mono text-[0.92rem] leading-[1.72] text-ink max-[720px]:text-[0.84rem]"
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
