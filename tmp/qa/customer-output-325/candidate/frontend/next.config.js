/** @type {import('next').NextConfig} */
const path = require('path');

const nextConfig = {
  skipTrailingSlashRedirect: true,
  // Keep production builds isolated from an active local dev server. Next can
  // corrupt the shared webpack cache when `next build` and `next dev` write to
  // the same directory, which previously made visual QA fail with transient
  // `__webpack_modules__[moduleId] is not a function` errors.
  distDir: process.env.NEXT_DIST_DIR ||
    (process.env.NODE_ENV === 'production' ? '.next-build' : '.next'),
  transpilePackages: ['@sabalanerp/contract-product-graph'],
  webpack(config) {
    // The shared package is CommonJS for the backend runtime. Point the
    // frontend bundler at its TypeScript source so Fast Refresh never injects
    // ESM hot-reload code into the already-compiled CommonJS artifact.
    config.resolve.alias['@sabalanerp/contract-product-graph'] = path.resolve(
      __dirname,
      '../packages/contract-product-graph/src/index.ts'
    );
    return config;
  },
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL || (process.env.NODE_ENV === 'production' ? '/api' : 'http://localhost:5000'),
  },
  experimental: {
    cpus: 1,
  },
  // The release-critical visual suite intentionally visits nearly every ERP
  // route. Dispose inactive development entries promptly so that this broad
  // navigation audit cannot exhaust the local container before V8 can collect
  // its compilation graph.
  onDemandEntries: {
    maxInactiveAge: 15 * 1000,
    pagesBufferLength: 1,
  },
  async rewrites() {
    if (!process.env.BACKEND_API_ORIGIN) return [];
    return [
      {
        source: '/api/:path*',
        destination: `${process.env.BACKEND_API_ORIGIN}/api/:path*`,
      },
      {
        source: '/socket.io/:path*',
        destination: `${process.env.BACKEND_API_ORIGIN}/socket.io/:path*/`,
      },
    ];
  },
  // PWA Configuration
  async headers() {
    return [
      {
        source: '/manifest.json',
        headers: [
          {
            key: 'Content-Type',
            value: 'application/manifest+json',
          },
        ],
      },
      {
        source: '/sw.js',
        headers: [
          {
            key: 'Content-Type',
            value: 'application/javascript',
          },
          {
            key: 'Cache-Control',
            value: 'public, max-age=0, must-revalidate',
          },
        ],
      },
    ];
  },
}

module.exports = nextConfig
