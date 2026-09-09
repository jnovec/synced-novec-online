/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async rewrites() {
    return [
      {
        source: '/s/:session',
        destination: '/?session=:session',
      },
      {
        source: '/session/:session',
        destination: '/?session=:session',
      },
      {
        source: '/ingest/:path*',
        destination: 'https://app.posthog.com/:path*',
      },
    ];
  },
};

module.exports = nextConfig;
