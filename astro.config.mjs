import netlify from "@astrojs/netlify";
import { defineConfig } from "astro/config";
import { loadEnv } from "vite";

// For Local Dev, set NGROK_HOST from .env
const { NGROK_HOST } = loadEnv(process.env, process.cwd(), "");

// https://astro.build/config
export default defineConfig({
  adapter: netlify(),

  vite: {
    server: {
      allowedHosts: [NGROK_HOST],
    },
  },
});
