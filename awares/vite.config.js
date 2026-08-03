import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { devApi } from "./dev-api.mjs";

export default defineConfig(({ mode }) => {
  // البادئة "" تحمّل كل متغيرات .env للخادم — ولا شيء منها يصل حزمة المتصفح
  // إلا ما بدأ بـ VITE_ (وهذه عامة بطبيعتها: عنوان الواجهة ومعرّف Firebase)
  const env = loadEnv(mode, process.cwd(), "");

  return {
    // GitHub Pages يخدم على /<اسم-المستودع>/ ما لم يكن هناك نطاق مخصص.
    // نضبطه بـ VITE_BASE في خطوة البناء، وافتراضه "/" لبقية الاستضافات.
    base: env.VITE_BASE || "/",
    plugins: [react(), devApi(env)],
  };
});
