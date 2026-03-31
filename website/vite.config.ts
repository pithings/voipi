import { defineConfig } from "vite";
// import { nitro } from "nitro/vite";

export default defineConfig({
  root: ".",
  plugins: [
    // nitro()
  ],
  resolve: {
    alias: {
      "voipi/browser": "../src/providers/browser.ts",
    },
  },
});
