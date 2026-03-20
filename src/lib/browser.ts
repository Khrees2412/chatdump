import type { BrowserExtractResult } from './types'

const BROWSER_IDLE_TIMEOUT_MS = 3_000
const BROWSER_NAVIGATION_TIMEOUT_MS = 15_000
const BROWSER_SIGNAL_TIMEOUT_MS = 5_000

export async function extractConversationInBrowser(
  url: string,
): Promise<BrowserExtractResult | null> {
  const playwright = await loadPlaywright()

  if (!playwright?.chromium) {
    return null
  }

  const browser = await playwright.chromium.launch({ headless: true })

  try {
    const page = await browser.newPage({
      userAgent: 'chatdump/0.1 (+browser fallback)',
    })

    await page.goto(url, {
      timeout: BROWSER_NAVIGATION_TIMEOUT_MS,
      waitUntil: 'domcontentloaded',
    })

    await page
      .waitForFunction(
        () => {
          const globalScope = window as unknown as Record<string, unknown>

          return Boolean(
            globalScope.__NEXT_DATA__ ||
              globalScope.__staticRouterHydrationData ||
              (globalScope.__reactRouterDataRouter as { state?: unknown } | undefined)?.state ||
              globalScope.__remixContext ||
              document.querySelector('[data-message-author-role]'),
          )
        },
        {
          timeout: BROWSER_SIGNAL_TIMEOUT_MS,
        },
      )
      .catch(() => undefined)

    await page
      .waitForLoadState('networkidle', {
        timeout: BROWSER_IDLE_TIMEOUT_MS,
      })
      .catch(() => undefined)

    return await page.evaluate(() => {
      const globalScope = window as unknown as Record<string, unknown>
      const routerData = globalScope.__reactRouterDataRouter as
        | { state?: { loaderData?: unknown } }
        | undefined
      const remixData = globalScope.__remixContext as
        | { state?: { loaderData?: unknown } }
        | undefined
      const staticRouterData = globalScope.__staticRouterHydrationData as
        | { loaderData?: unknown }
        | undefined

      return {
        html: document.documentElement.outerHTML,
        payloads: [
          globalScope.__NEXT_DATA__,
          staticRouterData,
          staticRouterData?.loaderData,
          routerData?.state,
          routerData?.state?.loaderData,
          remixData,
          remixData?.state,
          remixData?.state?.loaderData,
        ].filter((value) => Boolean(value)),
        sourceUrl: window.location.href,
      } satisfies BrowserExtractResult
    })
  } finally {
    await browser.close().catch(() => undefined)
  }
}

async function loadPlaywright(): Promise<{ chromium?: any } | null> {
  const moduleName = 'playwright'

  try {
    return await import(/* @vite-ignore */ moduleName)
  } catch {
    return null
  }
}
