// Lets Node run the games' TypeScript as it is: their imports leave out the
// .ts extension (Vite and the Netlify bundler add it), so a relative import
// that doesn't resolve is tried again with .ts. Register this before any
// module that imports the games is loaded, then import those dynamically.
import { registerHooks } from 'node:module'

registerHooks({
  resolve(specifier, context, next) {
    try {
      return next(specifier, context)
    } catch (error) {
      if ((specifier.startsWith('.') || specifier.startsWith('/')) && !/\.[cm]?[jt]sx?$/.test(specifier)) {
        return next(`${specifier}.ts`, context)
      }
      throw error
    }
  },
})
