/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',  // required for Netlify serverless functions
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  images: { unoptimized: true },
};
module.exports = nextConfig;