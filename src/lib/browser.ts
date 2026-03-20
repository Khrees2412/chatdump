import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import sparticuzChromium from '@sparticuz/chromium'
import { chromium as playwrightCoreChromium } from 'playwright-core'
import type { BrowserExtractResult } from './types'

const BROWSER_NAVIGATION_TIMEOUT_MS = 15_000
const BROWSER_SIGNAL_TIMEOUT_MS = 5_000
const require = createRequire(import.meta.url)

export async function extractConversationInBrowser(
  url: string,
): Promise<BrowserExtractResult | null> {
  if (isVercelRuntime()) {
    return extractConversationInServerlessBrowser(url)
  }

  const resolvedPackagePath = resolveModulePath('playwright/package.json')
  logInfo('Playwright fallback invoked', {
    node: process.version,
    playwrightPackagePath: resolvedPackagePath,
    runtime: 'local-playwright',
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

  logInfo('Playwright module loaded', {
    executablePath: getSafeExecutablePath(executablePath),
    url,
  })

  const browser = await playwright.chromium.launch({
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

async function extractConversationInServerlessBrowser(
  url: string,
): Promise<BrowserExtractResult | null> {
  const chromiumAssetDir = resolveChromiumAssetDir()
  const executablePath = await sparticuzChromium.executablePath(chromiumAssetDir)

  logInfo('Playwright fallback invoked', {
    chromiumAssetDir,
    executablePath: getSafeExecutablePath(executablePath),
    node: process.version,
    runtime: 'vercel-serverless',
    url,
    vercelEnv: process.env.VERCEL_ENV ?? null,
  })

  const browser = await playwrightCoreChromium.launch({
    args: sparticuzChromium.args,
    executablePath,
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

function getSafeExecutablePath(path: string | null): string | null {
  if (!path) {
    return null
  }

  return path.length > 140 ? `${path.slice(0, 137)}...` : path
}

function isVercelRuntime(): boolean {
  return Boolean(process.env.VERCEL || process.env.VERCEL_ENV)
}

function resolveChromiumAssetDir(): string | undefined {
  const candidates = [
    fileURLToPath(new URL('../bin', import.meta.url)),
    fileURLToPath(new URL('../../bin', import.meta.url)),
  ]

  return candidates.find((candidate) => existsSync(candidate))
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
