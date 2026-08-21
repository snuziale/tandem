/// <reference types="vitest" />
import { defineConfig, loadEnv } from 'vite'
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import babel from '@rolldown/plugin-babel'
import tailwindcss from '@tailwindcss/vite'
import { API_PATHS } from './src/shared/api-paths.ts'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

  // Every /api/* route is implemented by the Bun server (typed GitHub
  // endpoints, stores, agent runs) — dev forwards the whole prefix to a
  // locally-running `pnpm start` (first free port from 5274). There is no
  // env-driven auth injection here: credentials live in ~/.tandem/config.json
  // and never reach the browser bundle.
  const bunServerTarget = `http://127.0.0.1:${env.TANDEM_SERVER_PORT ?? 5274}`

  return {
    plugins: [react(), babel({ presets: [reactCompilerPreset()] }), tailwindcss()],
    server: {
      proxy: {
        [API_PATHS.API]: {
          target: bunServerTarget,
          changeOrigin: false,
          // Agent run streams are SSE and can idle for minutes between passes —
          // no proxy-side timeout, or the stream is cut mid-run.
          timeout: 0,
          proxyTimeout: 0,
          configure: (proxy: { on: (event: 'error', handler: (err: NodeJS.ErrnoException) => void) => void }) => {
            proxy.on('error', (err) => {
              const hint = err.code === 'ECONNREFUSED' ? 'run `pnpm start` in another terminal (or use `pnpm dev:all`)' : err.message
              console.warn(`[tandem] /api/* → ${bunServerTarget} failed: ${hint}`)
            })
          },
        },
      },
    },
    test: {
      globals: true,
      environment: 'node',
    },
  }
})
