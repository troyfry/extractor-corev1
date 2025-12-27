/** @type {import('next').NextConfig} */
const nextConfig = {
  eslint: {
    ignoreDuringBuilds: true,
  },
  // No special config required for pdf-parse
  webpack: (config, { isServer }) => {
    // Fix for pdfjs-dist in Next.js
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        path: false,
        crypto: false,
      };
      
      // Handle pdfjs-dist worker files
      config.resolve.alias = {
        ...config.resolve.alias,
        "pdfjs-dist/build/pdf.worker.mjs": false,
        "pdfjs-dist/build/pdf.worker.min.mjs": false,
      };
    }
    return config;
  },
};

module.exports = nextConfig;
