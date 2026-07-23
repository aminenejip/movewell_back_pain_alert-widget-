import { defineConfig } from "vite";
import { copyFileSync, mkdirSync, readdirSync, existsSync } from "fs";
import { join, dirname } from "path";

export default defineConfig({
  clearScreen: false,
  base: "./",
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
  build: {
    target: "esnext",
    outDir: "dist",
  },
  plugins: [
    {
      name: "copy-sounds",
      closeBundle() {
        const src = join(__dirname, "public", "sounds");
        const dst = join(__dirname, "dist", "sounds");
        if (existsSync(src)) {
          mkdirSync(dst, { recursive: true });
          for (const f of readdirSync(src)) {
            copyFileSync(join(src, f), join(dst, f));
          }
        }
      },
    },
  ],
});
