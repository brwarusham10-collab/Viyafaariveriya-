import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vitest/config";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "prompt",
      includeAssets: ["favicon.svg", "apple-touch-icon.png"],
      manifest: {
        name: "Viyafaariveriyaa POS",
        short_name: "Viyafaari",
        description: "Point of sale and business management for Maldivian retailers",
        theme_color: "#0D2B33",
        background_color: "#F4F6F5",
        display: "standalone",
        start_url: "/pos",
        icons: [
          { src: "pwa-192.png", sizes: "192x192", type: "image/png" },
          { src: "pwa-512.png", sizes: "512x512", type: "image/png" },
          { src: "pwa-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        // App shell only. API responses are never cached by the service worker; offline
        // catalog data lives in IndexedDB with explicit staleness tracking.
        globPatterns: ["**/*.{js,css,html,svg,png,woff2}"],
        navigateFallback: "/index.html",
        navigateFallbackDenylist: [/^\/auth\//, /^\/rest\//],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
      },
    }),
  ],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules")) {
            if (id.includes("recharts") || id.includes("d3-")) return "charts";
            if (id.includes("jspdf") || id.includes("write-excel-file")) return "exports";
            if (id.includes("@supabase")) return "supabase";
            if (id.includes("@radix-ui") || id.includes("@floating-ui")) return "ui";
            if (id.includes("react-dom") || id.includes("react-router") || id.includes("scheduler")) return "react";
            if (id.includes("dexie") || id.includes("date-fns") || id.includes("@tanstack") || id.includes("zod")) return "vendor";
          }
        },
      },
    },
  },
  test: {
    include: ["src/**/*.test.{ts,tsx}"],
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
  },
});
