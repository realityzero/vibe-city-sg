// Test server without HMR so headless play-tests don't get reloaded while files are being edited.
import base from './vite.config.js';
export default { ...base, server: { ...(base.server || {}), hmr: false, port: 5174, host: '127.0.0.1' } };
