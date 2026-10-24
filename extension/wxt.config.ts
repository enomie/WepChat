import { defineConfig } from 'wxt';
import { resolve } from 'path';

export default defineConfig({
  srcDir: 'src',
  modules: ['@wxt-dev/module-svelte'],
  vite: () => ({
    resolve: {
      alias: {
        // Replace the spacetimedb ws.ts that uses `new Function()` (violates Chrome Extension CSP)
        // with a browser-safe version that uses the global WebSocket directly.
        'spacetimedb/src/sdk/ws': resolve(__dirname, 'src/lib/ws-browser-override.ts'),
      },
    },
  }),
  manifest: ({ browser }) => ({
    name: '__MSG_extName__',
    description: '__MSG_extDescription__',
    default_locale: 'en',
    version: '1.0.0',
    permissions: ['sidePanel', 'tabs', 'storage', 'activeTab'],
    // In Chrome: natives side_panel
    ...(browser === 'chrome'
      ? {
          side_panel: {
            default_path: 'sidepanel.html',
          },
        }
      : {}),
    // In Firefox: natives sidebar_action
    ...(browser === 'firefox'
      ? {
          sidebar_action: {
            default_panel: 'sidepanel.html',
            default_title: '__MSG_sidebarTitle__',
          },
        }
      : {}),
    action: {
      default_title: '__MSG_actionTitle__',
    },
  }),
});

