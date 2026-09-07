import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  devIndicators: false,
  env: { NEXT_PUBLIC_VOICE_HOSTED: process.env.VERCEL === '1' ? '1' : '0' },
};

export default nextConfig;
