/* eslint-disable @typescript-eslint/no-require-imports -- Electron's preload hook is CommonJS. */
const { existsSync, writeFileSync } = require('node:fs')

const faultPath = process.env.DASCOWORK_E2E_MESSAGE_PORT_FAULT_PATH
const faultMode = process.env.DASCOWORK_E2E_MESSAGE_PORT_FAULT_MODE ?? 'messageerror'

if (faultPath && process.type !== 'renderer') {
  const { app } = require('electron')
  writeFileSync(`${faultPath}.hook-loaded`, 'main\n', 'utf8')
  const installFaultHook = `
    (() => {
      const NativeMessageChannel = globalThis.MessageChannel
      const channels = []
      let sequenceGapRequested = false
      function findOnMessageDescriptor(port) {
        let prototype = Object.getPrototypeOf(port)
        while (prototype) {
          const descriptor = Object.getOwnPropertyDescriptor(prototype, 'onmessage')
          if (descriptor) return descriptor
          prototype = Object.getPrototypeOf(prototype)
        }
        return undefined
      }
      function interceptPort(port) {
        const descriptor = findOnMessageDescriptor(port)
        if (!descriptor?.set) return
        let listener = null
        Object.defineProperty(port, 'onmessage', {
          configurable: true,
          get: () => listener,
          set: (nextListener) => {
            listener = nextListener
            descriptor.set.call(port, (event) => {
              if (
                sequenceGapRequested &&
                event.data &&
                typeof event.data === 'object' &&
                typeof event.data.sequence === 'number'
              ) {
                sequenceGapRequested = false
                nextListener?.(
                  new MessageEvent('message', {
                    data: { ...event.data, sequence: event.data.sequence + 1 }
                  })
                )
                return
              }
              nextListener?.(event)
            })
          }
        })
      }
      class FaultInjectingMessageChannel {
        constructor() {
          const channel = new NativeMessageChannel()
          interceptPort(channel.port1)
          channels.push(channel)
          return channel
        }
      }
      globalThis.MessageChannel = FaultInjectingMessageChannel
      globalThis.__dascoworkE2eMessagePortFault = (mode) => {
        const channel = channels.at(-1)
        if (!channel) return false
        if (mode === 'sequence-gap') sequenceGapRequested = true
        else channel.port1.dispatchEvent(new Event('messageerror'))
        return true
      }
    })()
  `
  const triggerFault = `globalThis.__dascoworkE2eMessagePortFault?.(${JSON.stringify(faultMode)}) ?? false`

  app.on('web-contents-created', (_event, contents) => {
    contents.once('dom-ready', () => {
      void contents
        .executeJavaScriptInIsolatedWorld(999, [{ code: installFaultHook }])
        .then(() => {
          writeFileSync(`${faultPath}.ready`, 'ready\n', 'utf8')
          const timer = setInterval(() => {
            if (!existsSync(faultPath)) return
            void contents
              .executeJavaScriptInIsolatedWorld(999, [{ code: triggerFault }])
              .then((injected) => {
                if (!injected) return
                clearInterval(timer)
                writeFileSync(`${faultPath}.injected`, 'messageerror\n', 'utf8')
              })
              .catch((error) => {
                clearInterval(timer)
                writeFileSync(`${faultPath}.error`, String(error), 'utf8')
              })
          }, 20)
          timer.unref?.()
        })
        .catch((error) => writeFileSync(`${faultPath}.error`, String(error), 'utf8'))
    })
  })
}
