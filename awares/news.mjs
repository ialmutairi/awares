#!/usr/bin/env node
/**
 * awares — رصد المستجدات التنظيمية
 *
 * يبحث عن ما **تغيّر فعلاً** خلال المدة الماضية: نظام صدر، لائحة عُدّلت،
 * جدول مخالفات نُشر أو رُفعت غراماته، مشروع طُرح على استطلاع، حملة ضبط أُعلنت.
 *
 * يشتغل مجدولاً ويكتب public/data/news.json — فالواجهة تقرأ ملفاً ثابتاً
 * ولا تستدعي شيئاً. تكلفة العرض صفر مهما بلغ عدد الزوار.
 *
 *   node news.mjs              # كل المجموعات
 *   node news.mjs --days 60    # نافذة أطول
 *   node news.mjs --group مالي
 */

import { writeFile, mkdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { availableProviders } from "./providers.mjs";
import { extractJSON, officialSource, hostOf } from "./analysis.mjs";
import { REGULATORS } from "./regulators.mjs";

const OUT = "./public/data/news.json";

/* نجمّع الجهات في حزم — بحث واحد لكل حزمة أرخص من بحث لكل جهة */
const GROUPS = [
  { id: "tax", name: "الزكاة والضريبة والجمارك", regs: ["zatca", "gac"] },
  { id: "labor", name: "العمل والتأمينات", regs: ["hrsd", "gosi", "qiwa"] },
  { id: "data", name: "البيانات والأمن السيبراني", regs: ["sdaia", "nca", "cst"] },
  { id: "commerce", name: "التجارة وحماية المستهلك", regs: ["mc", "saso"] },
  { id: "health", name: "الصحة والغذاء والدواء", regs: ["sfda", "moh", "chi", "scfhs"] },
  { id: "realestate", name: "العقار والبلدية والبناء", regs: ["rega", "momah", "balady", "sbc"] },
  { id: "finance", name: "المال والتأمين", regs: ["sama", "cma", "ia"] },
  { id: "industry", name: "الصناعة والبيئة والنقل", regs: ["mim", "ncec", "tga"] },
  { id: "media", name: "الإعلام والسياحة والملكية الفكرية", regs: ["gmedia", "mt", "saip", "gea"] },
];

const KINDS = ["law", "regulation", "penalty", "consultation", "enforcement"];

const byId = new Map(REGULATORS.map((r) => [r.id, r]));

function prompt(group, days) {
  const list = group.regs
    .map((id) => byId.get(id))
    .filter(Boolean)
    .map((r) => `- ${r.name} (${r.host})`)
    .join("\n");

  return `أنت محلل رصد تنظيمي سعودي. مهمتك: ما الذي **تغيّر** خلال آخر ${days} يوماً لدى هذه الجهات؟

${list}

ابحث عن الجديد فقط — لا تسرد الأنظمة القائمة منذ سنوات:
- نظام أو لائحة صدرت أو عُدّلت
- جدول تصنيف مخالفات نُشر أو عُدّلت غراماته
- مشروع مطروح على منصة استطلاع (istitlaa.ncc.gov.sa) ومهلته لم تنتهِ
- تمديد مهلة أو بدء تطبيق مرحلة جديدة
- حملات ضبط أو مخالفات أُعلن عنها رسمياً

صنّف كل خبر:
- law = نظام صدر أو عُدّل
- regulation = لائحة أو قرار تنفيذي
- penalty = جدول مخالفات أو تغيّر في الغرامات
- consultation = مشروع تحت الاستطلاع
- enforcement = ضبطيات أو حملات تفتيش

أعِد ٤ أخبار كحد أقصى — الأكثر أثراً على المنشآت الصغيرة والمتوسطة.

الشكل المطلوب، JSON فقط بلا markdown ولا نص قبله أو بعده:
{"items":[{"title":"عنوان الخبر بجملة","kind":"law|regulation|penalty|consultation|enforcement","agency":"اسم الجهة","date":"التاريخ كما ورد أو تقديره","impact":"جملة واحدة: ماذا يعني هذا لصاحب منشأة","deadline":"مهلة أو تاريخ نفاذ إن وُجد، أو فارغ","source":"رابط رسمي"}]}

قواعد صارمة:
- لا تخترع خبراً ولا تاريخاً. إن لم تجد جديداً فأعِد items فارغة.
- المصدر رابط رسمي حقيقي ظهر في بحثك وينتهي نطاقه بـ gov.sa أو نطاق الجهة.
- لا تستشهد بمدونة ولا مكتب محاماة.
- بالعربية ومختصراً.`;
}

const str = (v, n) => String(v ?? "").trim().slice(0, n);

function sanitize(items, { citations = [] } = {}) {
  if (!Array.isArray(items)) return [];
  const searched = new Set(citations.map(hostOf).filter(Boolean));

  return items
    .filter((it) => it && typeof it.title === "string" && it.title.trim().length > 10)
    .map((it) => {
      const source = officialSource(it.source);
      return {
        title: str(it.title, 220),
        kind: KINDS.includes(it.kind) ? it.kind : "regulation",
        agency: str(it.agency, 140),
        date: str(it.date, 60),
        impact: str(it.impact, 260),
        deadline: str(it.deadline, 80),
        source,
        unverifiedSource: !!source && searched.size > 0 && !searched.has(hostOf(source)),
      };
    })
    // خبر بلا مصدر رسمي لا يُنشر — الخبر بلا مرجع إشاعة
    .filter((it) => it.source)
    .slice(0, 4);
}

/* ---------- التشغيل ---------- */
const argv = process.argv.slice(2);
const days = Number(argv[argv.indexOf("--days") + 1]) || 45;
const only = argv.includes("--group") ? argv[argv.indexOf("--group") + 1] : null;

const providers = availableProviders(process.env);
if (!providers.length) {
  console.error("لا يوجد مفتاح مزود (XAI_API_KEY / GEMINI_API_KEY / ANTHROPIC_API_KEY)");
  process.exit(1);
}
const provider = providers[0]; // خبر واحد لا يحتاج تحققاً متقاطعاً — نوفّر التكلفة

const targets = only ? GROUPS.filter((g) => g.id === only || g.name.includes(only)) : GROUPS;
if (!targets.length) {
  console.error(`مجموعة غير معروفة: ${only}`);
  process.exit(1);
}

console.log(`المزوّد: ${provider.label} · النافذة: ${days} يوماً · المجموعات: ${targets.length}\n`);

const groups = [];
for (const g of targets) {
  try {
    const { text, citations } = await provider.run(prompt(g, days), {
      key: provider.key,
      maxTokens: 3000,
      search: true,
    });
    const items = sanitize(extractJSON(text).items, { citations });
    groups.push({ id: g.id, name: g.name, items });
    console.log(`✓ ${g.name} — ${items.length} خبر`);
  } catch (e) {
    console.log(`✗ ${g.name} — ${String(e.message).slice(0, 120)}`);
    groups.push({ id: g.id, name: g.name, items: [], failed: true });
  }
  await new Promise((r) => setTimeout(r, 900));
}

// نحتفظ بأخبار المجموعة السابقة إن فشلت هذه المرة، بدل نشر فراغ
if (existsSync(OUT)) {
  try {
    const old = JSON.parse(await readFile(OUT, "utf8"));
    for (const g of groups) {
      if (!g.failed) continue;
      const prev = (old.groups || []).find((p) => p.id === g.id);
      if (prev?.items?.length) Object.assign(g, { items: prev.items, stale: true });
    }
  } catch {}
}

const total = groups.reduce((n, g) => n + g.items.length, 0);
await mkdir("./public/data", { recursive: true });
await writeFile(
  OUT,
  JSON.stringify({ generatedAt: new Date().toISOString(), windowDays: days, total, groups }, null, 2),
  "utf8"
);

console.log(`\n✔ ${total} خبراً في ${OUT}`);
