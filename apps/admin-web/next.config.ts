import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: ['@strawboss/types', '@strawboss/api', '@strawboss/ui-tokens', '@strawboss/validation'],
};

export default nextConfig;
