const { getDefaultConfig } = require('expo/metro-config');

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);

// 1. Ensure Metro treats .wasm files as assets (required for expo-sqlite / wa-sqlite on web)
if (!config.resolver.assetExts.includes('wasm')) {
  config.resolver.assetExts.push('wasm');
}

// 2. Enable package exports for conditional exports resolution (wa-sqlite)
config.resolver.unstable_enablePackageExports = true;

// 3. Add Cross-Origin headers required for SharedArrayBuffer / WebAssembly threading in web workers
const originalEnhanceMiddleware = config.server?.enhanceMiddleware;
config.server = {
  ...config.server,
  enhanceMiddleware: (middleware, server) => {
    const nextMiddleware = originalEnhanceMiddleware
      ? originalEnhanceMiddleware(middleware, server)
      : middleware;
    return (req, res, next) => {
      res.setHeader('Cross-Origin-Embedder-Policy', 'credentialless');
      res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
      return nextMiddleware(req, res, next);
    };
  },
};

module.exports = config;
