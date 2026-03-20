import handler, { createServerEntry } from '@tanstack/react-start/server-entry'
import {
  handlePrivateProviderHealthRequest,
  isPrivateProviderHealthRequest,
} from './src/lib/provider-health'

export default createServerEntry({
  fetch(request) {
    if (isPrivateProviderHealthRequest(request)) {
      return handlePrivateProviderHealthRequest(request)
    }

    return handler.fetch(request)
  },
})
