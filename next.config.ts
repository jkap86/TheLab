import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // node-pg-migrate loads migration files via a runtime `import(file://...)`,
  // which the bundler cannot statically resolve. Keep it (and pg) as native
  // Node modules so the on-boot migration runner in src/instrumentation.ts
  // works instead of being bundled. (pg is auto-externalized; listed for clarity.)
  serverExternalPackages: ["node-pg-migrate", "pg"],
  async redirects() {
    return [
      {
        source: '/',
        destination: '/tools',
        permanent: true
      }
    ]
  },
};

export default nextConfig;
