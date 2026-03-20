import { access } from 'node:fs/promises'
import { constants } from 'node:fs'
import { createRequire } from 'node:module'
import type { BrowserExtractResult } from './types'

const BROWSER_NAVIGATION_TIMEOUT_MS = 15_000
const BROWSER_SIGNAL_TIMEOUT_MS = 5_000
const BROWSER_LAUNCH_ARGS = [
  '--disable-dev-shm-usage',
  '--disable-setuid-sandbox',
  '--no-sandbox',
]
const HERMETIC_PLAYWRIGHT_BROWSERS_PATH = '0'
const require = createRequire(import.meta.url)

export async function extractConversationInBrowser(
  url: string,
): Promise<BrowserExtractResult | null> {
  process.env.PLAYWRIGHT_BROWSERS_PATH ??= HERMETIC_PLAYWRIGHT_BROWSERS_PATH

  const resolvedPackagePath = resolveModulePath('playwright/package.json')
  logInfo('Playwright fallback invoked', {
    browsersPath: process.env.PLAYWRIGHT_BROWSERS_PATH,
    node: process.version,
    playwrightPackagePath: resolvedPackagePath,
    url,
    vercelEnv: process.env.VERCEL_ENV ?? null,
  })

  const playwright = await loadPlaywright()

  if (!playwright?.chromium) {
    logWarn('Playwright module is unavailable in this runtime', {
      playwrightPackagePath: resolvedPackagePath,
      url,
    })
    return null
  }

  const executablePath = getExecutablePath(playwright)
  const executablePresent = executablePath ? await fileExists(executablePath) : false

  logInfo('Playwright module loaded', {
    executablePath,
    executablePresent,
    url,
  })

  const browser = await playwright.chromium.launch({
    args: BROWSER_LAUNCH_ARGS,
    executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH || undefined,
    headless: true,
  })

  try {
    logInfo('Playwright browser launched', { url })

    const page = await browser.newPage({
      userAgent: 'chatdump/0.1 (+browser fallback)',
    })

    await page.goto(url, {
      timeout: BROWSER_NAVIGATION_TIMEOUT_MS,
      waitUntil: 'domcontentloaded',
    })

    logInfo('Playwright page loaded', {
      pageUrl: page.url(),
      title: await page.title().catch(() => ''),
      url,
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

    const result = await page.evaluate(() => {
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

    logInfo('Playwright browser extraction completed', {
      payloadCount: result.payloads?.length ?? 0,
      sourceUrl: result.sourceUrl,
      url,
    })

    return result
  } catch (cause) {
    logError('Playwright browser extraction failed', {
      error: getErrorMessage(cause),
      url,
    })
    throw cause
  } finally {
    await browser.close().catch(() => undefined)
  }
}

async function loadPlaywright(): Promise<{ chromium?: any } | null> {
  const moduleName = 'playwright'

  try {
    return await import(/* @vite-ignore */ moduleName)
  } catch (importCause) {
    logWarn('Playwright import failed', {
      error: getErrorMessage(importCause),
      moduleName,
    })
  }

  try {
    return require(moduleName)
  } catch (requireCause) {
    logWarn('Playwright require fallback failed', {
      error: getErrorMessage(requireCause),
      moduleName,
    })
    return null
  }
}

function getExecutablePath(playwright: { chromium?: any }): string | null {
  try {
    return typeof playwright.chromium?.executablePath === 'function'
      ? playwright.chromium.executablePath()
      : null
  } catch {
    return null
  }
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK)
    return true
  } catch {
    return false
  }
}

function resolveModulePath(specifier: string): string | null {
  try {
    return require.resolve(specifier)
  } catch {
    return null
  }
}

function getErrorMessage(cause: unknown): string {
  if (cause instanceof Error) {
    return cause.message
  }

  return String(cause)
}

function logInfo(message: string, details: Record<string, unknown>) {
  console.info(`[chatdump] ${message}`, details)
}

function logWarn(message: string, details: Record<string, unknown>) {
  console.warn(`[chatdump] ${message}`, details)
}

function logError(message: string, details: Record<string, unknown>) {
  console.error(`[chatdump] ${message}`, details)
}
