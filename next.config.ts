import type { NextConfig } from 'next';

function normalizeIgnoredEntries(ignored: unknown): string[] {
  if (Array.isArray(ignored)) {
    return ignored.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0);
  }

  if (typeof ignored === 'string' && ignored.trim().length > 0) {
    return [ignored];
  }

  return [];
}

const nextConfig: NextConfig = {
  reactStrictMode: true,
  distDir: process.env.NEXT_DIST_DIR || '.next',
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

    if (dev && process.env.DISABLE_HMR !== 'true') {
      const ignored = normalizeIgnoredEntries(config.watchOptions?.ignored);
      const buildArtifactsIgnored = ['**/.next/**', '**/.next-dev/**'];
      const mergedIgnored = [...ignored, ...buildArtifactsIgnored];

      config.watchOptions = {
        ...config.watchOptions,
        ignored: mergedIgnored,
      };
    }

    if (dev && process.platform === 'win32' && process.env.DISABLE_HMR !== 'true') {
      const ignored = normalizeIgnoredEntries(config.watchOptions?.ignored);
      const winSystemIgnored = [
        '**/pagefile.sys',
        '**/DumpStack.log.tmp',
        '**/hiberfil.sys',
        '**/swapfile.sys',
      ];
      config.watchOptions = {
        ...config.watchOptions,
        ignored: [...ignored, ...winSystemIgnored],
      };
    }
    return config;
  },
};

export default nextConfig;
