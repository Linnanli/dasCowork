import { createContext } from 'react'

import type { ConversationRuntimeIndicatorStore } from '../runtime/ConversationRuntimeIndicatorStore'

export const ConversationRuntimeIndicatorContext = createContext<
  ConversationRuntimeIndicatorStore | undefined
>(undefined)
