import fs from 'node:fs'

export function createRuntimeLogger(runtimeLogPath: string) {
  return {
    appendRuntimeLog(message: string) {
      try {
        const line = `[${new Date().toISOString()}] ${message}\n`
        fs.appendFileSync(runtimeLogPath, line, 'utf-8')
      } catch {
        // ignore
      }
    },
  }
}
