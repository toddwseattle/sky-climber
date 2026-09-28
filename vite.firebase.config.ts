import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

const workspaceRoot = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  root: fileURLToPath(new URL("./firebase", import.meta.url)),
  publicDir: fileURLToPath(new URL("./public", import.meta.url)),
  envDir: workspaceRoot,
  plugins: [react()],
  build: {
    outDir: fileURLToPath(new URL("./dist-firebase", import.meta.url)),
    emptyOutDir: true,
  },
});
