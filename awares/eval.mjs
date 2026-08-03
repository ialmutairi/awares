#!/usr/bin/env node
/**
 * awares — قياس جودة النتائج
 *
 * يشغّل ملفات منشآت نموذجية عبر المسار الكامل (استبيان ← تحليل)، ثم يقيس
 * ما يمكن قياسه آلياً ويكتب public/data/quality.json لتعرضه الواجهة للعموم.
 *
 * ما يُقاس هنا **حقائق قابلة للتحقق**، لا رأي:
 *   - هل المصدر نطاق رسمي؟          (يُقاس بالسجل)
 *   - هل رابط المصدر يفتح فعلاً؟     (يُقاس بطلب HTTP)
 *   - هل الجزاء رقم أم "غير محدد"؟   (يُقاس بالنص)
 *   - هل فيه شرح مبسّط للمخالفة؟
 *   - هل ادّعى مصدراً لم يظهر في بحثه؟
 *
 * ما لا يُقاس هنا — وهذا حدّ الأداة الصادق:
 *   **صحة الرقم نفسه.** أن يفتح الرابط لا يعني أن الغرامة المذكورة صحيحة.
 *   هذا يحتاج مراجعة بشرية، ويُعرض في الواجهة كما هو.
 *
 *   node eval.mjs            # كل الملفات
 *   node eval.mjs --quick    # ملفان فقط
 */

import { writeFile, mkdir } from "node:fs/promises";
import { handleIntake, handleAnalyze } from "./api-core.mjs";
import { officialSource } from "./analysis.mjs";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

/* منشآت نموذجية تغطي قطاعات ومخاطر مختلفة */
const PROFILES = [
  { id: "coffee", label: "مقهى وتحميص", text: "مقهى بفرعين في الرياض، ١٢ موظفاً، نحمّص حبوب القهوة بأنفسنا ونبيعها معبأة عبر متجر إلكتروني مع توصيل، وعندنا برنامج ولاء يجمع أرقام العملاء." },
  { id: "saas", label: "منصة برمجية", text: "شركة برمجيات، ٢٥ موظفاً، نبني منصة SaaS لعملاء داخل المملكة ونخزّن بياناتهم على سحابة أجنبية، ونتعامل بالدفع الإلكتروني." },
  { id: "clinic", label: "عيادة أسنان", text: "عيادة أسنان خاصة في جدة، ٩ موظفين، نتعاقد مع شركات تأمين ونحتفظ بملفات المرضى إلكترونياً." },
  { id: "broker", label: "وساطة عقارية", text: "مكتب وساطة عقارية، ٦ موظفين، نسوّق وحدات على الخارطة ونحرّر عقود إيجار عبر إيجار." },
  { id: "factory", label: "مصنع أغذية", text: "مصنع تعبئة تمور صغير في القصيم، ٤٠ عاملاً، نصدّر جزءاً من الإنتاج ولدينا مستودع مبرّد." },
];

/** هل الرابط يفتح فعلاً؟ نستخدم curl لأن جدران الحماية الحكومية تحجب undici */
async function linkAlive(url) {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  try {
    const { stdout } = await promisify(execFile)(
      "curl",
      ["-sS", "-o", "/dev/null", "-m", "30", "-L", "-A", UA, "-w", "%{http_code}", url],
      { timeout: 40000 }
    );
    return Number(stdout.trim()) === 200;
  } catch {
    return false;
  }
}

async function scoreProfile(p, env) {
  process.stdout.write(`\n▸ ${p.label}\n`);

  const intake = await handleIntake({ description: p.text }, env);
  process.stdout.write(`  استبيان: ${intake.questions.length} سؤال${intake.cached ? " (من الذاكرة)" : ""}\n`);

  // نجيب بأول خيار لكل سؤال — إجابة واقعية وثابتة بين التشغيلات
  const answers = {};
  for (const q of intake.questions) {
    answers[q.id] = q.options?.length ? q.options[0] : q.type === "number" ? "10" : "نعم";
  }

  const res = await handleAnalyze(
    { description: p.text, business: intake.business, questions: intake.questions, answers },
    env,
    null // بلا سياق قطاعي — نقيس التحليل وحده
  );

  const items = res.items;
  const checked = [];
  for (const it of items) {
    const isOfficial = !!officialSource(it.source);
    checked.push({
      name: it.name,
      hasSource: !!it.source,
      isOfficial,
      alive: it.source ? await linkAlive(it.source) : false,
      penaltyNamed: !!it.penalty && !it.penalty.startsWith("غير محدد"),
      hasPlain: !!it.plain,
      hasApplies: !!it.applies,
      flagged: !!it.unverifiedSource,
    });
  }

  const n = checked.length;
  const pct = (f) => (n ? Math.round((checked.filter(f).length / n) * 100) : 0);
  const row = {
    id: p.id,
    label: p.label,
    items: n,
    cached: !!res.cached,
    sourceOfficial: pct((c) => c.isOfficial),
    sourceAlive: pct((c) => c.alive),
    penaltyNamed: pct((c) => c.penaltyNamed),
    plainLanguage: pct((c) => c.hasPlain),
    appliesLinked: pct((c) => c.hasApplies),
    flaggedSource: pct((c) => c.flagged),
  };

  process.stdout.write(
    `  بنود ${n} · مصدر رسمي ${row.sourceOfficial}% · رابط حيّ ${row.sourceAlive}% · ` +
      `جزاء محدد ${row.penaltyNamed}% · شرح مبسّط ${row.plainLanguage}%\n`
  );
  for (const c of checked.filter((c) => !c.alive || !c.isOfficial)) {
    process.stdout.write(`    ⚠ ${c.name.slice(0, 54)} — ${!c.hasSource ? "بلا مصدر" : !c.isOfficial ? "مصدر غير رسمي" : "رابط لا يفتح"}\n`);
  }
  return row;
}

/* ---------- التشغيل ---------- */
const quick = process.argv.includes("--quick");
const targets = quick ? PROFILES.slice(0, 2) : PROFILES;

const env = process.env;
const rows = [];
for (const p of targets) {
  try {
    rows.push(await scoreProfile(p, env));
  } catch (e) {
    console.log(`  ✗ ${p.label} — ${String(e.message).slice(0, 140)}`);
  }
}

if (!rows.length) {
  console.error("\nلم ينجح أي ملف — تحقق من المفاتيح.");
  process.exit(1);
}

const totalItems = rows.reduce((n, r) => n + r.items, 0);
const wavg = (k) => Math.round(rows.reduce((s, r) => s + r[k] * r.items, 0) / totalItems);

const summary = {
  generatedAt: new Date().toISOString(),
  profiles: rows.length,
  items: totalItems,
  metrics: {
    sourceOfficial: wavg("sourceOfficial"),
    sourceAlive: wavg("sourceAlive"),
    penaltyNamed: wavg("penaltyNamed"),
    plainLanguage: wavg("plainLanguage"),
    appliesLinked: wavg("appliesLinked"),
    flaggedSource: wavg("flaggedSource"),
  },
  byProfile: rows,
  // يُعرض حرفياً في الواجهة — لا نريد أن يُقرأ الرقم كشهادة صحة
  caveat:
    "هذه المقاييس تقيس شكل المخرجات لا صحة أرقامها. أن يفتح الرابط لا يعني أن الغرامة المذكورة صحيحة — التحقق من المصدر الرسمي يبقى مسؤولية المستخدم.",
};

await mkdir("./public/data", { recursive: true });
await writeFile("./public/data/quality.json", JSON.stringify(summary, null, 2), "utf8");

console.log("\n" + "─".repeat(58));
console.log(`الإجمالي: ${rows.length} ملف · ${totalItems} بند`);
for (const [k, label] of [
  ["sourceOfficial", "مصدر رسمي"],
  ["sourceAlive", "رابط يفتح فعلاً"],
  ["penaltyNamed", "جزاء محدد"],
  ["plainLanguage", "شرح مبسّط"],
  ["appliesLinked", "مربوط بنشاطك"],
  ["flaggedSource", "موسوم للمراجعة"],
]) {
  console.log(`  ${label.padEnd(20)} ${String(summary.metrics[k]).padStart(3)}%`);
}
console.log("\n✔ كُتب في public/data/quality.json");
