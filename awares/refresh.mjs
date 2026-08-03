#!/usr/bin/env node
/**
 * awares — مولّد البيانات التنظيمية
 *
 * يشتغل مرة أسبوعياً (GitHub Actions أو أي مجدول)، يبحث في المصادر الرسمية
 * لكل قطاع، ويكتب ملفات JSON ثابتة يقرأها الموقع مباشرة.
 *
 * يعمل بأي مفتاح متاح: XAI_API_KEY أو GEMINI_API_KEY أو ANTHROPIC_API_KEY.
 * إن توفّر أكثر من مفتاح، يُسأل كل نموذج على حدة وتُدمج النتائج:
 * ما يتفق عليه نموذجان يُوسم confirmed، وما ينفرد به واحد يُوسم single.
 *
 * التشغيل:
 *   XAI_API_KEY=... GEMINI_API_KEY=... node refresh.mjs
 *   node refresh.mjs food            # قطاع واحد
 *   node refresh.mjs --solo food     # مزود واحد فقط (أرخص وأسرع)
 */

import { writeFile, mkdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { SECTORS } from "./sectors.mjs";
import { availableProviders } from "./providers.mjs";
import { agencyPrompt, extractJSON, sanitizeItems, crossVerify } from "./analysis.mjs";

const OUT_DIR = "./public/data";
const CONCURRENCY = 3;      // طلبات متوازية داخل القطاع الواحد
const PAUSE_MS = 800;       // تهدئة بين الطلبات

/* ============================================================
   بناء جهة واحدة
   ============================================================ */

async function askProvider(provider, agency, sector) {
  const { text, citations } = await provider.run(agencyPrompt(agency, sector), {
    key: provider.key,
    maxTokens: 3000,
    search: true,
  });
  const parsed = extractJSON(text);
  return sanitizeItems(parsed.items, { citations });
}

/**
 * يسأل كل المزودين المتاحين ثم يدمج.
 * فشل مزود واحد لا يُسقط الجهة — يكفي أن ينجح واحد.
 */
async function buildAgency(agency, sector, providers) {
  const settled = await Promise.allSettled(
    providers.map((p) => askProvider(p, agency, sector))
  );

  const perProvider = [];
  const errors = [];
  settled.forEach((r, i) => {
    if (r.status === "fulfilled" && r.value.length) {
      perProvider.push({ provider: providers[i].id, items: r.value });
    } else if (r.status === "rejected") {
      errors.push(`${providers[i].id}: ${r.reason?.message || r.reason}`);
    }
  });

  if (!perProvider.length) {
    throw new Error(errors.join(" | ") || "لم يُرجع أي مزود بنوداً");
  }
  return { items: crossVerify(perProvider), errors };
}

/* ============================================================
   بناء قطاع
   ============================================================ */

async function buildSector(sector, providers) {
  console.log(`\n▸ ${sector.name}`);
  const agencies = new Array(sector.agencies.length);
  let cursor = 0;

  const worker = async () => {
    while (cursor < sector.agencies.length) {
      const idx = cursor++;
      const agency = sector.agencies[idx];
      try {
        const { items, errors } = await buildAgency(agency, sector, providers);
        agencies[idx] = { name: agency, items };
        const confirmed = items.filter((i) => i.confidence === "confirmed").length;
        console.log(
          `  ✓ ${agency} — ${items.length} التزام` +
            (providers.length > 1 ? ` (${confirmed} مؤكّد من مزودين)` : "") +
            (errors.length ? `  ⚠ ${errors.length} مزود فشل` : "")
        );
      } catch (e) {
        console.log(`  ✗ ${agency} — ${String(e.message).slice(0, 160)}`);
        // نُبقي بيانات الأسبوع الماضي بدل نشر فراغ
        agencies[idx] = { name: agency, items: [], failed: true };
      }
      await new Promise((r) => setTimeout(r, PAUSE_MS));
    }
  };

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, sector.agencies.length) }, worker));

  return {
    id: sector.id,
    name: sector.name,
    updatedAt: new Date().toISOString(),
    providers: providers.map((p) => p.id),
    agencies,
  };
}

/** يدمج مع الملف السابق: لو فشلت جهة، نحتفظ ببياناتها القديمة ونسمها stale */
async function mergeWithPrevious(fresh) {
  const path = `${OUT_DIR}/${fresh.id}.json`;
  if (!existsSync(path)) return fresh;
  try {
    const old = JSON.parse(await readFile(path, "utf8"));
    fresh.agencies = fresh.agencies.map((a) => {
      if (!a.failed) return a;
      const prev = (old.agencies || []).find((p) => p.name === a.name);
      return prev?.items?.length ? { ...prev, stale: true } : a;
    });
  } catch {}
  return fresh;
}

/* ============================================================
   التشغيل
   ============================================================ */

async function main() {
  const args = process.argv.slice(2);
  const solo = args.includes("--solo");
  const only = args.find((a) => !a.startsWith("--"));

  let providers = availableProviders(process.env);
  if (!providers.length) {
    console.error(
      "لا يوجد مفتاح مزود. صدّر واحداً على الأقل:\n" +
        "  XAI_API_KEY / GEMINI_API_KEY / ANTHROPIC_API_KEY"
    );
    process.exit(1);
  }
  if (solo) providers = providers.slice(0, 1);

  const targets = only ? SECTORS.filter((s) => s.id === only) : SECTORS;
  if (!targets.length) {
    console.error(`قطاع غير معروف: ${only}`);
    console.error(`المتاح: ${SECTORS.map((s) => s.id).join(", ")}`);
    process.exit(1);
  }

  console.log(
    `المزودون: ${providers.map((p) => `${p.label} (${p.defaultModel})`).join("، ")}\n` +
      `القطاعات: ${targets.length}`
  );

  await mkdir(OUT_DIR, { recursive: true });

  // نبدأ من الفهرس الحالي حتى لا يمسح تشغيلُ قطاعٍ واحدٍ بقيةَ القطاعات
  const indexPath = `${OUT_DIR}/index.json`;
  let previous = [];
  if (existsSync(indexPath)) {
    try {
      previous = JSON.parse(await readFile(indexPath, "utf8")).sectors || [];
    } catch {}
  }
  const index = new Map(previous.map((s) => [s.id, s]));

  // نضمن وجود مدخل لكل قطاع معرّف حتى لو لم يُولّد بعد
  for (const s of SECTORS) {
    if (!index.has(s.id)) index.set(s.id, { id: s.id, name: s.name, count: 0, updatedAt: null });
  }

  for (const sector of targets) {
    const built = await mergeWithPrevious(await buildSector(sector, providers));
    await writeFile(`${OUT_DIR}/${sector.id}.json`, JSON.stringify(built, null, 2), "utf8");

    const total = built.agencies.reduce((n, a) => n + (a.items?.length || 0), 0);
    index.set(sector.id, {
      id: sector.id,
      name: sector.name,
      count: total,
      updatedAt: total ? built.updatedAt : null,
    });
  }

  // الترتيب يتبع sectors.mjs لا ترتيب التوليد
  const ordered = SECTORS.map((s) => index.get(s.id)).filter(Boolean);
  await writeFile(
    indexPath,
    JSON.stringify({ updatedAt: new Date().toISOString(), sectors: ordered }, null, 2),
    "utf8"
  );

  const done = ordered.filter((s) => s.count > 0).length;
  console.log(`\n✔ اكتمل — ${done}/${ordered.length} قطاع فيه بيانات، في ${OUT_DIR}`);
}

main().catch((e) => {
  console.error("فشل التشغيل:", e);
  process.exit(1);
});
