import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { devApi } from "./dev-api.mjs";

export default defineConfig(({ mode }) => {
  // البادئة "" تحمّل كل متغيرات .env للخادم — ولا شيء منها يصل حزمة المتصفح
  const env = loadEnv(mode, process.cwd(), "");

  return {
    plugins: [react(), devApi(env)],
  };
});
