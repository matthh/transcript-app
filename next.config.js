/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ['chromadb'],
  outputFileTracingIncludes: {
    '/api/search': ['./data/**/*', './transcripts/**/*'],
    '/api/search/stream': ['./data/**/*', './transcripts/**/*'],
  },
};

module.exports = nextConfig;
