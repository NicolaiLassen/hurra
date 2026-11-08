import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import type { IncomingMessage } from 'node:http'
import { fileURLToPath, URL } from 'node:url'
import { defineConfig, loadEnv, type Plugin } from 'vite'

export default defineConfig({
  plugins: [react(), tailwindcss(), netlifyFunctions()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  // Expose the dev server on the LAN so it can be opened from a phone.
  server: { host: true },
})

/**
 * Serves netlify/functions/<name>.mts at /api/<name> during `npm run dev`, as
 * Netlify does in production, with env vars from .env.development.local.
 */
function netlifyFunctions(): Plugin {
  return {
    name: 'netlify-functions',
    configureServer(server) {
      Object.assign(process.env, loadEnv(server.config.mode, process.cwd(), ''))
      server.middlewares.use('/api', async (req, res) => {
        const name = (req.url ?? '').split('?')[0].replace(/^\//, '')
        if (!/^[a-z0-9-]+$/.test(name)) {
          res.statusCode = 404
          return res.end()
        }
        try {
          const { default: handler } = await server.ssrLoadModule(`/netlify/functions/${name}.mts`)
          const body = req.method === 'GET' || req.method === 'HEAD' ? undefined : await readBody(req)
          const headers = new Headers(
            Object.entries(req.headers).flatMap(([key, value]) =>
              value === undefined ? [] : (Array.isArray(value) ? value : [value]).map((v) => [key, v] as [string, string]),
            ),
          )
          const response: Response = await handler(new Request(`http://localhost/api/${name}`, { method: req.method, headers, body }))
          res.statusCode = response.status
          response.headers.forEach((value, key) => res.setHeader(key, value))
          res.end(Buffer.from(await response.arrayBuffer()))
        } catch (error) {
          server.ssrFixStacktrace(error as Error)
          console.error(error)
          res.statusCode = 500
          res.end(String(error))
        }
      })
    },
  }
}

async function readBody(req: IncomingMessage) {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks)
}
