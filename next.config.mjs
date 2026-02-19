/** @type {import('next').NextConfig} */
const nextConfig = {
  // Ya no usamos 'output: export' ni webpack hacks
  images: {
    unoptimized: true,
  },
};

export default nextConfig;