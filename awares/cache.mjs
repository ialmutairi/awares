/**
 * awares — ذاكرة النتائج
 *
 * أغلب ما يُسأل عنه متكرر: «مقهى»، «متجر إلكتروني»، «عيادة أسنان».
 * بلا ذاكرة ندفع ثمن بحث كامل لكل زائر يسأل نفس السؤال بصياغة مختلفة.
 *
 * المفتاح يُبنى من وصف مُطبَّع (لا من النص الحرفي) حتى يلتقي
 * «مقهى بفرعين ١٢ موظف» مع «مقهى، فرعين، ١٢ موظفاً» على نفس المدخل.
 *
 * يعمل في Node وفي Cloudflare Workers:
 *   - Workers: caches.default يبقى بين الطلبات وعلى امتداد نقطة الحضور
 *   - Node/dev: Map في الذاكرة
 */

const MEM = new Map(); // key -> { value, expires }
const MEM_MAX = 500;

export const TTL = {
  intake: 60 * 60 * 24 * 30, // الاستبيان يتغيّر ببطء — شهر
  analyze: 60 * 60 * 24 * 7, // التحليل يتبع الأنظمة — أسبوع، ويطابق دورة المسح
};

/* ---------- تطبيع ومفتاح ---------- */

/** يوحّد الصياغة العربية حتى تتطابق الأوصاف المتشابهة */
export function normalize(text) {
  return String(text || "")
    // الأرقام أولاً: نطاق التشكيل أدناه يبتلع الأرقام الهندية لو جاء قبله
    .replace(/[٠-٩]/g, (d) => "٠١٢٣٤٥٦٧٨٩".indexOf(d))
    .replace(/[۰-۹]/g, (d) => "۰۱۲۳۴۵۶۷۸۹".indexOf(d))
    // التشكيل فقط، بالرموز الصريحة. كتابتها [\u064B-\u0670] تبتلع
    // \u0660..\u0669 وهي الأرقام الهندية لا الحركات — وهذا ما كسر مطابقة الذاكرة.
    .replace(/[\u064B-\u065F\u0670\u06D6-\u06ED]/g, "")
    .replace(/ـ/g, "")                  // التطويل
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[^\p{L}\p{N}]+/gu, " ")   // ترقيم
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/**
 * حقبة شهرية تدخل في كل مفتاح.
 * بدل مهمة مجدولة تكنس الذاكرة، يتغيّر المفتاح نفسه أول كل شهر ميلادي
 * فتصبح كل المدخلات القديمة غير قابلة للوصول دفعةً واحدة — تنظيف ذاتي
 * لا يحتاج cron ولا يترك نافذة يُقدَّم فيها محتوى بائت.
 * وTTL يتكفّل بحذفها فعلياً من التخزين بعدها.
 */
export function monthEpoch(now = new Date()) {
  return now.getUTCFullYear() * 12 + now.getUTCMonth();
}

/** SHA-256 متاح في Node 20 وفي Workers عبر crypto.subtle */
export async function cacheKey(kind, parts) {
  const raw = `${kind}::m${monthEpoch()}::${parts
    .map((p) => normalize(typeof p === "string" ? p : JSON.stringify(p)))
    .join("::")}`;
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw));
  return [...new Uint8Array(buf)].slice(0, 16).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/* ---------- القراءة والكتابة ---------- */

const cfCache = () => (typeof caches !== "undefined" && caches.default ? caches.default : null);
const urlFor = (key) => `https://awares.cache/${key}`;

export async function getCached(key) {
  const hit = MEM.get(key);
  if (hit && hit.expires > Date.now()) return hit.value;
  if (hit) MEM.delete(key);

  const cf = cfCache();
  if (cf) {
    try {
      const res = await cf.match(urlFor(key));
      if (res) return await res.json();
    } catch {}
  }
  return null;
}

/**
 * يكنس المنتهي من ذاكرة العملية.
 * الحقبة الشهرية تجعل مفاتيح الشهر الماضي غير قابلة للوصول، لكنها تبقى
 * شاغلة للذاكرة في عملية Node طويلة العمر — هذا ينظّفها فعلياً.
 */
export function purgeStale() {
  const now = Date.now();
  let n = 0;
  for (const [k, v] of MEM) {
    if (v.expires <= now) {
      MEM.delete(k);
      n++;
    }
  }
  return n;
}

export async function setCached(key, value, ttlSeconds) {
  purgeStale();
  if (MEM.size >= MEM_MAX) MEM.delete(MEM.keys().next().value); // إزاحة الأقدم
  MEM.set(key, { value, expires: Date.now() + ttlSeconds * 1000 });

  const cf = cfCache();
  if (cf) {
    try {
      await cf.put(
        urlFor(key),
        new Response(JSON.stringify(value), {
          headers: {
            "content-type": "application/json; charset=utf-8",
            "cache-control": `public, max-age=${ttlSeconds}`,
          },
        })
      );
    } catch {}
  }
}

/**
 * يغلّف دالة مكلفة بذاكرة.
 * يعيد { value, cached } حتى تستطيع الواجهة إظهار أن النتيجة محفوظة.
 */
export async function withCache(kind, parts, ttlSeconds, produce) {
  const key = await cacheKey(kind, parts);
  const hit = await getCached(key);
  if (hit) return { value: hit, cached: true };

  const value = await produce();
  await setCached(key, value, ttlSeconds);
  return { value, cached: false };
}
