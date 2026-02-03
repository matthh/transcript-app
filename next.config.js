/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ['chromadb'],
  outputFileTracingIncludes: {
    '/api/search': ['./vector-store.json', './data/**/*'],
    '/api/search/stream': ['./vector-store.json', './data/**/*'],
  },
};

module.exports = nextConfig;
