import {
  normalizeSettings,
  type RuntimeSettings,
  type SettingsDefaultsContext,
} from './settings'

type SettingsRuntimeDeps = {
  readSettings: () => Partial<RuntimeSettings> | null | undefined
  writeSettings: (settings: RuntimeSettings) => void
  createDefaultsContext: () => SettingsDefaultsContext
  afterSave: () => void
}

export function createSettingsRuntime({
  readSettings,
  writeSettings,
  createDefaultsContext,
  afterSave,
}: SettingsRuntimeDeps) {
  const normalizeRuntimeSettings = (settings: Partial<RuntimeSettings> | null | undefined) => {
    return normalizeSettings(settings, createDefaultsContext())
  }

  const loadSettings = () => normalizeRuntimeSettings(readSettings())

  const saveSettings = (next: RuntimeSettings) => {
    const normalized = normalizeRuntimeSettings(next)
    writeSettings(normalized)
    afterSave()
    return normalized
  }

  return {
    loadSettings,
    normalizeRuntimeSettings,
    saveSettings,
  }
}
