export type BeforeQuitEvent = {
  preventDefault(): void
}

export function createBeforeQuitHandler({
  shutdown,
  quit,
  onError
}: {
  shutdown(): Promise<void>
  quit(): void
  onError(error: unknown): void
}): (event: BeforeQuitEvent) => void {
  let shutdownStarted = false
  let shutdownComplete = false

  return (event) => {
    if (shutdownComplete) return

    event.preventDefault()
    if (shutdownStarted) return
    shutdownStarted = true

    void shutdown()
      .catch(onError)
      .finally(() => {
        shutdownComplete = true
        quit()
      })
  }
}
