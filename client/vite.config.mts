import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

function resolvePort(value: string | undefined): number {
  const port = Number.parseInt(value || '', 10);
  return Number.isInteger(port) && port > 0 && port <= 65_535 ? port : 4001;
}

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'build',
    emptyOutDir: true,
    target: 'es2022',
  },
  server: {
    host: '0.0.0.0',
    port: resolvePort(process.env.CLIENT_PORT || process.env.PORT),
    strictPort: true,
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/setupTests.ts'],
    clearMocks: true,
    restoreMocks: true,
  },
});
