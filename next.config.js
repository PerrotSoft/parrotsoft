/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: '250mb',
    },
  },
};

module.exports = nextConfig;