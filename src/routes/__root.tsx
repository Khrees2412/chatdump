/// <reference types="vite/client" />
import type { ReactNode } from 'react'
import {
  HeadContent,
  Outlet,
  Scripts,
  createRootRoute,
} from '@tanstack/react-router'
import '../styles.css'

const SITE_TITLE = 'chatdump | Public Share Link to Markdown'
const SITE_DESCRIPTION =
  'Convert public share links into clean, deterministic Markdown you can review, copy, and reuse.'
const SITE_URL = 'https://chatdump.vercel.app'
const SOCIAL_IMAGE = `${SITE_URL}/social-card.svg`

export const Route = createRootRoute({
  head: () => ({
    meta: [
      {
        charSet: 'utf-8',
      },
      {
        name: 'viewport',
        content: 'width=device-width, initial-scale=1',
      },
      {
        title: SITE_TITLE,
      },
      {
        name: 'description',
        content: SITE_DESCRIPTION,
      },
      {
        property: 'og:type',
        content: 'website',
      },
      {
        property: 'og:site_name',
        content: SITE_TITLE,
      },
      {
        property: 'og:title',
        content: SITE_TITLE,
      },
      {
        property: 'og:description',
        content: SITE_DESCRIPTION,
      },
      {
        property: 'og:url',
        content: SITE_URL,
      },
      {
        property: 'og:image',
        content: SOCIAL_IMAGE,
      },
      {
        property: 'og:image:width',
        content: '1200',
      },
      {
        property: 'og:image:height',
        content: '630',
      },
      {
        property: 'twitter:card',
        content: 'summary_large_image',
      },
      {
        property: 'twitter:title',
        content: SITE_TITLE,
      },
      {
        property: 'twitter:description',
        content: SITE_DESCRIPTION,
      },
      {
        property: 'twitter:image',
        content: SOCIAL_IMAGE,
      },
    ],
    links: [
      {
        rel: 'icon',
        type: 'image/svg+xml',
        href: '/favicon.svg',
        sizes: 'any',
      },
      {
        rel: 'apple-touch-icon',
        href: '/logo-mark.svg',
      },
    ],
  }),
  component: RootComponent,
})

function RootComponent() {
  return (
    <RootDocument>
      <Outlet />
    </RootDocument>
  )
}

function RootDocument({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>{children}<Scripts /></body>
    </html>
  )
}
