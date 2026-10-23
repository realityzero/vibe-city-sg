// Persistent user settings + save game.
import { DEFAULT_SETTINGS } from '../ui/index.js';
import { isTouchFirst } from '../ui/touch.js';
const KEY = 'vibecity.settings.v2';
const EXTRA = { shadows: true, bloom: true, showFps: false, dynamicResolution: true };
// phones and tablets start on the low preset (any choice made in Settings is kept)
const DEVICE = isTouchFirst() ? { quality: 'low' } : {};
export function loadSettings() {
  try { return { ...DEFAULT_SETTINGS, ...EXTRA, ...DEVICE, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { return { ...DEFAULT_SETTINGS, ...EXTRA, ...DEVICE }; }
}
export function saveSettings(s) { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { } }
const SAVE = 'vibecity.save.v1';
export function loadSave() { try { return JSON.parse(localStorage.getItem(SAVE) || 'null'); } catch { return null; } }
export function writeSave(s) { try { localStorage.setItem(SAVE, JSON.stringify(s)); } catch { } }
export function clearSave() { try { localStorage.removeItem(SAVE); } catch { } }
