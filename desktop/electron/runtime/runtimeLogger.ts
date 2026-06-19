import fs from 'node:fs'
import path from 'node:path'

export function createRuntimeLogger(runtimeLogPath: string) {
  return {
    appendRuntimeLog(message: string) {
      try {
        const line = `[${new Date().toISOString()}] ${message}\n`
        fs.mkdirSync(path.dirname(runtimeLogPath), { recursive: true })
        fs.appendFileSync(runtimeLogPath, line, 'utf-8')
      } catch {
        // ignore
      }
    },
  }
}
