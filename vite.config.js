import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: process.env.ELECTRON_BUILD ? "./" : "/twrpg-helper/",
  plugins: [react()],
});
