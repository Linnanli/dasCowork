import { ConversationRuntimeIndicatorContext } from './ConversationRuntimeIndicatorContext'
import type { ConversationRuntimeIndicatorStore } from '../runtime/ConversationRuntimeIndicatorStore'

export function ConversationRuntimeIndicatorProvider({
  store,
  children
}: {
  store: ConversationRuntimeIndicatorStore
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <ConversationRuntimeIndicatorContext.Provider value={store}>
      {children}
    </ConversationRuntimeIndicatorContext.Provider>
  )
}
