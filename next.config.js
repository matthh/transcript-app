/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ['chromadb'],
  outputFileTracingIncludes: {
    '/api/search': ['./vector-store.json', './data/**/*', './transcripts/**/*'],
    '/api/search/stream': ['./vector-store.json', './data/**/*', './transcripts/**/*'],
  },
};

module.exports = nextConfig;
