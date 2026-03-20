import { createFileRoute } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import {
  startTransition,
  useDeferredValue,
  useState,
} from 'react'

type ConvertInput = {
  url: string
}

const convertShare = createServerFn({ method: 'POST' })
  .inputValidator((data: ConvertInput) => ({
    url: data.url.trim(),
  }))
  .handler(async ({ data }) => {
    const { convertShareUrlToMarkdown } = await import('../lib/convert')

    const result = await convertShareUrlToMarkdown(data.url)

    return {
      markdown: result.markdown,
      warnings: result.warnings,
    }
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
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'error'>('idle')

  const preview = useDeferredValue(markdown)
  const hasResult = preview.length > 0
  const lineCount = hasResult ? preview.split('\n').length : 0
  const characterCount = hasResult ? preview.length : 0
  const warningCount = warnings.length
  const copyLabel =
    copyState === 'copied'
      ? 'Copied'
      : copyState === 'error'
        ? 'Copy failed'
        : 'Copy Markdown'

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setIsPending(true)
    setMarkdown('')
    setError(null)
    setWarnings([])
    setCopyState('idle')

    startTransition(() => {
      convertShare({
        data: {
          url,
        },
      })
        .then((result) => {
          setMarkdown(result.markdown)
          setWarnings(result.warnings)
        })
        .catch((cause) => {
          const message =
            cause instanceof Error ? cause.message : 'Conversion failed'

          setMarkdown('')
          setError(message)
        })
        .finally(() => {
          setIsPending(false)
        })
    })
  }

  async function handleCopy() {
    if (!preview) {
      return
    }

    try {
      await navigator.clipboard.writeText(preview)
      setCopyState('copied')
      window.setTimeout(() => setCopyState('idle'), 1600)
    } catch {
      setCopyState('error')
    }
  }

  return (
    <main className="app-shell">
      <div className="app-frame">
        <header className="app-header">
          <div className="brand-lockup">
            <div aria-hidden="true" className="brand-mark">
              cd
            </div>
            <div className="brand-copy">
              <p className="brand-name">chatdump</p>
              <p className="brand-context">Public ChatGPT share to Markdown</p>
            </div>
          </div>

          <div className="header-pills" aria-label="Product characteristics">
            <span className="header-pill">Deterministic export</span>
            <span className="header-pill">No sign-in</span>
          </div>
        </header>

        <div className={`workspace${hasResult ? ' workspace-has-output' : ''}`}>
          <section className="panel panel-source">
            <div className="panel-intro">
              <p className="section-label">Source</p>
              <h1>Export a public ChatGPT share as a clean Markdown transcript.</h1>
              <p className="lead">
                Paste a supported share URL and get a stable, readable export
                you can review before copying into docs, notes, or version
                control.
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

                <p className="form-note">
                  One public share link per export. Warnings appear inline when
                  the source is incomplete.
                </p>
              </div>
            </form>

            {isPending ? (
              <div className="progress-track" aria-label="Processing share link">
                <div className="progress-fill" />
              </div>
            ) : null}

            <div className="promise-list" aria-label="What the export includes">
              <article className="promise-item">
                <p className="promise-kicker">Formatting</p>
                <p className="promise-title">Readable Markdown</p>
                <p className="promise-copy">
                  Clean headings, preserved order, and plain-text-friendly
                  output.
                </p>
              </article>

              <article className="promise-item">
                <p className="promise-kicker">Fidelity</p>
                <p className="promise-title">Conversation-first export</p>
                <p className="promise-copy">
                  Page chrome stays out so the transcript is ready for reuse.
                </p>
              </article>

              <article className="promise-item">
                <p className="promise-kicker">Signals</p>
                <p className="promise-title">Warnings stay visible</p>
                <p className="promise-copy">
                  Extraction issues are surfaced instead of silently dropped.
                </p>
              </article>
            </div>

            <div aria-live="polite" className="status-stack">
              {error ? <p className="status error">{error}</p> : null}
              {warnings.map((warning) => (
                <p className="status warning" key={warning}>
                  {warning}
                </p>
              ))}
            </div>
          </section>

          {hasResult ? (
            <section className="panel panel-output">
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

                  <button className="secondary" type="button" onClick={handleCopy}>
                    <svg aria-hidden="true" viewBox="0 0 24 24">
                      <path d="M9 9h10v12H9z" />
                      <path d="M5 3h10v4H9v10H5z" />
                    </svg>
                    <span>{copyLabel}</span>
                  </button>
                </div>
              </div>

              <pre className="preview">{preview}</pre>
            </section>
          ) : null}
        </div>
      </div>
    </main>
  )
}
