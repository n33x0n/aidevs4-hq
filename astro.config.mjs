// @ts-check
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import tailwindcss from '@tailwindcss/vite';
import knowledgeAutoSync from './src/integrations/knowledge-sync';

export default defineConfig({
  integrations: [react(), knowledgeAutoSync()],
  output: 'server',
  vite: {
    plugins: [tailwindcss()],
    server: {
      allowedHosts: ['azyl-53348.ag3nts.org'],
      watch: {
        // Ignoruj katalogi z danymi/logami — zapis przez solvery triggeruje HMR reload
        ignored: ['**/data/**', '**/src/logs/**', '**/*.db', '**/*.db-shm', '**/*.db-wal'],
      },
    },
    ssr: {
      // ssh2 to moduł Node.js z natywnymi opcjonalnymi zależnościami —
      // zewnętrzny (nie bundlowany) żeby działał poprawnie w Astro SSR
      external: ['ssh2', 'better-sqlite3', 'sqlite-vec'],
    },
  },
});
