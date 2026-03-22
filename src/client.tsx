import { inject } from '@vercel/analytics'
import { StrictMode } from 'react'
import { hydrateRoot } from 'react-dom/client'
import { StartClient } from '@tanstack/react-start/client'

inject()

hydrateRoot(
  document,
  <StrictMode>
    <StartClient />
  </StrictMode>,
)
