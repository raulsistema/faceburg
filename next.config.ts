import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: false,
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'picsum.photos',
        port: '',
        pathname: '/**',
      },
    ],
  },
  output: 'standalone',
  webpack: (config, { dev }) => {
    // HMR is disabled in AI Studio via DISABLE_HMR env var.
    // Do not modify - file watching is disabled to prevent flickering during agent edits.
    if (dev && process.env.DISABLE_HMR === 'true') {
      config.watchOptions = {
        ignored: /.*/,
      };
    }

    if (dev && process.platform === 'win32' && process.env.DISABLE_HMR !== 'true') {
      const ignored = config.watchOptions?.ignored;
      const winSystemIgnored = [
        '**/pagefile.sys',
        '**/DumpStack.log.tmp',
        '**/hiberfil.sys',
        '**/swapfile.sys',
      ];
      const normalizedIgnored = Array.isArray(ignored)
        ? ignored.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
        : typeof ignored === 'string' && ignored.trim().length > 0
          ? [ignored]
          : [];
      config.watchOptions = {
        ...config.watchOptions,
        ignored: [...normalizedIgnored, ...winSystemIgnored],
      };
    }
    return config;
  },
};

export default nextConfig;
