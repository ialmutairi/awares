/**
 * awares — وسيط /api أثناء التطوير
 *
 * ينفّذ نفس منطق دوال Cloudflare داخل خادم Vite، فما يعمل محلياً يعمل بعد النشر.
 * المفاتيح تُقرأ من ملف .env في جذر المشروع ولا تُمرَّر للمتصفح.
 */

import { readFile } from "node:fs/promises";
import {
  handleIntake, handleAnalyze, handleSubmitSource, handleListSources,
  handleFeedback, handleStats, respond, providersConfigured,
} from "./api-core.mjs";

const readBody = (req) =>
  new Promise((resolve) => {
    let raw = "";
    req.on("data", (c) => {
      raw += c;
      if (raw.length > 64_000) req.destroy(); // سقف حجم الطلب
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(raw || "{}"));
      } catch {
        resolve({});
      }
    });
    req.on("error", () => resolve({}));
  });

const loadSector = async (id) =>
  JSON.parse(await readFile(`./public/data/${id.replace(/[^a-z0-9-]/gi, "")}.json`, "utf8"));

export function devApi(env) {
  return {
    name: "awares-dev-api",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const path = (req.url || "").split("?")[0];
        if (!path.startsWith("/api/")) return next();

        const send = ({ status, body, headers }) => {
          res.statusCode = status;
          for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
          res.end(body);
        };

        if (path === "/api/status") {
          const providers = providersConfigured(env);
          return send({
            status: 200,
            body: JSON.stringify({ ready: providers.length > 0, providers }),
            headers: { "content-type": "application/json; charset=utf-8" },
          });
        }

        // مسارات القراءة
        if (req.method === "GET") {
          const q = new URL(req.url, "http://x").searchParams;
          if (path === "/api/sources")
            return send(await respond(() => handleListSources(env, q.get("sector") || "")));
          if (path === "/api/feedback") return send(await respond(() => handleStats(env)));
        }

        if (req.method !== "POST") {
          return send({
            status: 405,
            body: JSON.stringify({ error: "استخدم POST" }),
            headers: { "content-type": "application/json; charset=utf-8" },
          });
        }

        const body = await readBody(req);

        if (path === "/api/intake") return send(await respond(() => handleIntake(body, env)));
        if (path === "/api/analyze")
          return send(await respond(() => handleAnalyze(body, env, loadSector)));
        if (path === "/api/sources") return send(await respond(() => handleSubmitSource(body, env)));
        if (path === "/api/feedback") return send(await respond(() => handleFeedback(body, env)));

        return send({
          status: 404,
          body: JSON.stringify({ error: "مسار غير معروف" }),
          headers: { "content-type": "application/json; charset=utf-8" },
        });
      });
    },
  };
}
