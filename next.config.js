/** @type {import('next').NextConfig} */
const nextConfig = {
  eslint: {
    ignoreDuringBuilds: true,
  },
  // Exclude mupdf from server-side bundling (WASM module, only available at runtime)
  // Note: serverComponentsExternalPackages is for App Router, but we're using Pages Router
  // The webpack externals config below handles this for us
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
    
    // Mark mupdf as external for server-side builds (WASM module, runtime-only)
    if (isServer) {
      config.externals = config.externals || [];
      if (typeof config.externals === "function") {
        const originalExternals = config.externals;
        config.externals = [
          ...(Array.isArray(originalExternals) ? originalExternals : []),
          "mupdf",
        ];
      } else if (Array.isArray(config.externals)) {
        config.externals.push("mupdf");
      } else {
        config.externals = [config.externals, "mupdf"];
      }
    }
    
    return config;
  },
};

module.exports = nextConfig;
