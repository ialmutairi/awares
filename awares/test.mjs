/**
 * awares — اختبارات محرك التحليل
 *
 * تشغيل: npm test   (بلا تبعيات وبلا شبكة)
 *
 * تغطي ما يقع عليه ضرر حقيقي لو انكسر: فلترة المصادر، واستخراج JSON من ردود
 * النماذج، والتحقق من الحقول، والدمج المتقاطع.
 */

import {
  officialSource,
  extractJSON,
  sanitizeItems,
  sanitizeAnalysis,
  crossVerify,
  sanitizeIntake,
} from "./analysis.mjs";

let fail = 0;
const ok = (name, cond) => { console.log(`${cond ? "✓" : "✗"} ${name}`); if (!cond) fail++; };

// ---- officialSource ----
ok("يقبل gov.sa", !!officialSource("https://sdaia.gov.sa/ar/x"));
ok("يقبل نطاقاً فرعياً", !!officialSource("https://istitlaa.ncc.gov.sa/"));
ok("يقبل cma.org.sa", !!officialSource("https://cma.org.sa/x"));
ok("يرفض الثغرة القديمة evil.com/x.gov.sa", officialSource("https://evil.com/fake.gov.sa/") === null);
ok("يرفض نطاقاً منتحلاً notgov.sa.evil.com", officialSource("https://gov.sa.evil.com/") === null);
ok("يرفض .com", officialSource("https://bakermckenzie.com/x") === null);
ok("يرفض javascript:", officialSource("javascript:alert(1)") === null);
ok("يرفض الفارغ", officialSource("") === null);

// ---- extractJSON ----
ok("يقشّر أسوار markdown", extractJSON('```json\n{"a":1}\n```').a === 1);
ok("يتجاهل نصاً بعد الكائن", extractJSON('مقدمة {"a":{"b":2}} خاتمة').a.b === 2);
ok("لا يبتلع أقواساً في نص", extractJSON('{"a":"قوس } هنا","b":3}').b === 3);
ok("يتعامل مع الهروب", extractJSON('{"a":"شرطة \\\\","b":4}').b === 4);

// ---- sanitizeItems ----
const items = sanitizeItems([
  { name: "نظام حماية البيانات الشخصية", status: "bogus", severity: "x", penalty: "", source: "https://sdaia.gov.sa/p", steps: ["a","b","c","d","e","f"] },
  { name: "قصير", status: "draft" },
  { name: "نظام آخر صالح تماماً", status: "draft", source: "https://evil.com/x" },
], { citations: ["https://sdaia.gov.sa/other"] });
ok("يحذف الاسم القصير", items.length === 2);
ok("يصحّح الحالة غير الصالحة", items[0].status === "enforced");
ok("يصحّح الخطورة", items[0].severity === "medium");
ok("يملأ الجزاء الافتراضي", items[0].penalty === "غير محدد في المصدر");
ok("يقصّ الخطوات إلى ٤", items[0].steps.length === 4);
ok("يقبل مصدراً من نفس نطاق البحث", items[0].unverifiedSource === false);
ok("يُسقط المصدر غير الرسمي", items[1].source === null);

// ---- crossVerify ----
const merged = crossVerify([
  { provider: "grok", items: [
      { name: "نظام حماية البيانات الشخصية ولائحته", severity: "high", penalty: "٥ ملايين ريال", summary: "قصير", steps: [], source: null },
      { name: "نظام التجارة الإلكترونية", severity: "low", penalty: "غير محدد في المصدر", summary: "س", steps: ["خ"] },
  ]},
  { provider: "gemini", items: [
      { name: "نظام حماية البيانات الشخصية السعودي", severity: "medium", penalty: "غير محدد في المصدر", summary: "ملخص أطول بكثير من الأول", steps: ["خطوة"], source: "https://sdaia.gov.sa/x" },
  ]},
]);
ok("يدمج البندين المتشابهين", merged.length === 2);
const pdpl = merged.find(m => m.name.includes("حماية البيانات"));
ok("يسم المتفق عليه confirmed", pdpl.confidence === "confirmed");
ok("يحتفظ بالغرامة المحددة", pdpl.penalty === "٥ ملايين ريال");
ok("يأخذ المصدر من المزود الآخر", pdpl.source === "https://sdaia.gov.sa/x");
ok("يأخذ الملخص الأطول", pdpl.summary.includes("أطول"));
ok("يرفع الخطورة للأعلى", pdpl.severity === "high");
ok("المؤكّد أولاً في الترتيب", merged[0].confidence === "confirmed");
ok("المنفرد يُوسم single", merged[1].confidence === "single");

// ---- sanitizeIntake ----
const intake = sanitizeIntake({
  business: { label: "مقهى", sectorIds: ["food", "غير-موجود"], note: "n" },
  questions: [
    { id: "a b!", label: "س١", type: "single", options: ["x", "y"] },
    { id: "a b!", label: "س٢", type: "single", options: ["واحد"] },   // خيار واحد → نص
    { id: "", label: "", type: "multi" },                              // بلا نص → يُحذف
    { label: "س٣", type: "weird" },
  ],
}, new Set(["food", "retail"]));
ok("ينظّف المعرّف", intake.questions[0].id === "ab");
ok("يمنع تكرار المعرّف", intake.questions[1].id !== intake.questions[0].id);
ok("يحوّل خياراً واحداً إلى نص", intake.questions[1].type === "text");
ok("يحذف السؤال بلا نص", intake.questions.length === 3);
ok("يصحّح النوع المجهول", intake.questions[2].type === "text");
ok("يفلتر القطاع غير الموجود", intake.business.sectorIds.length === 1);

// ---- sanitizeAnalysis: الحقول الإضافية تبقى محاذية لبنودها بعد الفلترة ----
const an = sanitizeAnalysis({
  summary: "س", agencies: ["أ"],
  items: [
    { name: "قصير", agency: "جهة-محذوفة", applies: "أ", severity: "high" },  // يُفلتر
    { name: "نظام حماية البيانات الشخصية", agency: "سدايا", applies: "تجمع بيانات", severity: "high" },
    { name: "نظام التجارة الإلكترونية", agency: "وزارة التجارة", applies: "تبيع أونلاين", severity: "medium" },
  ],
});
ok("يفلتر البند غير الصالح من التحليل", an.items.length === 2);
ok("الجهة تبقى محاذية لبندها", an.items[0].agency === "سدايا");
ok("applies تبقى محاذية لبندها", an.items[1].applies === "تبيع أونلاين");
ok("يرتّب حسب الخطورة", an.items[0].severity === "high");

/* ---------- تطبيع الذاكرة ---------- */
/* انحدار حقيقي: نطاق التشكيل [\u064B-\u0670] كان يبتلع الأرقام الهندية
   \u0660..\u0669، فوصفان متطابقان بأرقام مختلفة الشكل ينتجان مفتاحين. */
const { normalize, cacheKey } = await import("./cache.mjs");

ok("يوحّد الأرقام الهندية واللاتينية",
  normalize("٧ موظفين") === normalize("7 موظفين"));
ok("لا يبتلع الرقم الهندي مع التشكيل",
  normalize("مادة ٥ نافذة").includes("5"));
ok("يوحّد الهمزات والتاء المربوطة",
  normalize("إدارة أملاك") === normalize("اداره املاك"));
ok("يتجاهل الترقيم واختلاف المسافات",
  normalize("مقهى، بفرعين.") === normalize("مقهى  بفرعين"));
ok("يحذف التطويل", normalize("مطـــعم") === normalize("مطعم"));

const [k1, k2] = await Promise.all([
  cacheKey("analyze", ["مخبز، ٧ موظفين"]),
  cacheKey("analyze", ["مخبز, 7 موظفين!!"]),
]);
ok("وصفان متكافئان ينتجان نفس مفتاح الذاكرة", k1 === k2);
ok("وصفان مختلفان ينتجان مفتاحين",
  k1 !== (await cacheKey("analyze", ["مصنع، ٧ موظفين"])));

/* ---------- سجل الجهات ---------- */
const { REGULATORS, OFFICIAL_HOSTS, regulatorsFor } = await import("./regulators.mjs");

ok("لا نطاق مكرر في السجل",
  new Set(REGULATORS.map((r) => r.id)).size === REGULATORS.length);
ok("كل جهة لها نطاق ونطاقها ضمن المقبولة",
  REGULATORS.every((r) => r.host && OFFICIAL_HOSTS.has(r.host)));
ok("النطاقات الميتة لم تعد في السجل",
  !["cchi.gov.sa", "gcam.gov.sa", "gastat.gov.sa", "wera.gov.sa"].some((h) => OFFICIAL_HOSTS.has(h)));
ok("مصادر السجل تمرّ من فلترة المصادر",
  officialSource("https://chi.gov.sa/x") !== null && officialSource("https://socpa.org.sa/x") !== null);
ok("كل قطاع له جهة رقابية واحدة على الأقل",
  ["food", "software", "fintech", "beauty", "media"].every((s) => regulatorsFor(s).length > 0));

console.log(fail ? `\n${fail} فشل` : "\nكل الاختبارات نجحت");
process.exit(fail ? 1 : 0);
