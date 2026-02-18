/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'shockball.nyc3.cdn.digitaloceanspaces.com',
      },
      {
        protocol: 'https',
        hostname: 'shockball.online',
      },
    ],
  },
}

module.exports = nextConfig
