/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ['chromadb', 'googleapis'],
  outputFileTracingIncludes: {
    '/api/search': ['./data/**/*', './transcripts/**/*'],
    '/api/search/stream': ['./data/**/*', './transcripts/**/*'],
    '/api/synopsis': ['./transcripts/**/*'],
  },
};

module.exports = nextConfig;
