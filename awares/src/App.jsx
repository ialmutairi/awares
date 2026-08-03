import React, { useState, useEffect, useMemo, useRef } from "react";
import { SECTORS } from "../sectors.mjs";
import { REGULATORS, PRIMARY_SOURCES, regulatorsFor } from "../regulators.mjs";

/* ============================================================
   awares — الوعي والامتثال التنظيمي

   وضعان:
   ١) حلّل منشأتي — استبيان ديناميكي يبنيه النموذج على وصف صاحب المنشأة،
      ثم بحث حيّ في المصادر الرسمية عبر /api (المفاتيح على الخادم فقط).
      هذا الوضع وحده هو ما يكلّف، ونتائجه تُحفظ في ذاكرة الخادم.
   ٢) التغطية — عرض ثابت من regulators.mjs: أي قطاع نغطّيه وكم جهة رقابية فيه.
      صفر استدعاءات، صفر تكلفة.
   ============================================================ */

/* صور الرموز في public/qr/ — يفضّل مربّعة بخلفية بيضاء */
const BANKS = [
  { id: "stc", name: "stc bank", qr: "/qr/stc.jpeg", dot: "#4f008c" },
  { id: "rajhi", name: "مصرف الراجحي", qr: "/qr/alrajhi.jpeg", dot: "#1f2ae0" },
];

const STYLES = `
@import url('https://fonts.googleapis.com/css2?family=Noto+Kufi+Arabic:wght@400;600;800&family=IBM+Plex+Sans+Arabic:wght@300;400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap');

.aw-root {
  --ink: #16181d; --ink-soft: #4a5058; --ink-faint: #878e97;
  --paper: #f1f3ef; --surface: #ffffff;
  --rule: #dcdfd7; --rule-soft: #e9ebe5;
  --pine: #0b5d4e; --pine-soft: #e3efeb;
  --amber: #a35a06; --amber-soft: #f8eddc;
  --rust: #b23a17; --rust-soft: #fae7df;
  --slate: #5d6773; --slate-soft: #e8ebee;
  --crimson: #97122f;

  /* ألوان العلامة، مأخوذة من logo.png */
  --navy: #16365d; --teal: #3ec4c9;

  direction: rtl; text-align: right;
  background: var(--paper); color: var(--ink);
  font-family: 'IBM Plex Sans Arabic', system-ui, sans-serif;
  font-size: 15px; line-height: 1.7; min-height: 100%; padding-bottom: 60px;
}
.aw-root *, .aw-root *::before, .aw-root *::after { box-sizing: border-box; }
.aw-num { font-family: 'IBM Plex Mono', monospace; font-variant-numeric: tabular-nums; }
.aw-wrap { max-width: 880px; margin: 0 auto; padding: 0 20px; }

/* ---------- header ---------- */
.aw-top { background: var(--surface); border-bottom: 1px solid var(--rule); padding: 15px 0; }
.aw-top-in { display: flex; align-items: center; justify-content: space-between; gap: 14px; flex-wrap: wrap; }
.aw-brand { display: flex; align-items: center; gap: 10px; }
/* الدرع مقصوص من الشعار نفسه — يبقى حادّاً في أي مقاس، والكلمة تُصفّ بجانبه */
.aw-mark { width: 34px; height: 34px; object-fit: contain; display: block; flex-shrink: 0; }
/* اسم لاتيني داخل صفحة RTL: بلا عزل يقفز النقطة لليسار فتُقرأ ".awares" */
.aw-word { font-family: 'Noto Kufi Arabic', sans-serif; font-weight: 800; font-size: 21px; color: var(--navy); line-height: 1; direction: ltr; unicode-bidi: isolate; }
.aw-word span { color: var(--teal); }
.aw-tag { font-size: 12.5px; color: var(--ink-faint); }

/* ---------- tabs ---------- */
.aw-tabs { display: flex; gap: 0; margin: 22px 0 20px; border-bottom: 1px solid var(--rule); }
.aw-tab {
  font-family: 'Noto Kufi Arabic', sans-serif; font-size: 14px; font-weight: 500;
  padding: 10px 18px; border: none; background: none; color: var(--ink-faint);
  cursor: pointer; border-bottom: 2px solid transparent; margin-bottom: -1px;
}
.aw-tab:hover { color: var(--ink-soft); }
.aw-tab:focus-visible { outline: 2px solid var(--pine); outline-offset: -2px; }
.aw-tab[data-on="true"] { color: var(--ink); border-bottom-color: var(--pine); font-weight: 600; }

/* ---------- SIGNATURE: ختم التحديث ---------- */
.aw-stamp {
  display: inline-flex; align-items: center; gap: 9px;
  border: 1px solid var(--rule); background: var(--surface);
  border-radius: 100px; padding: 6px 15px 6px 11px; margin: 0 0 18px;
}
.aw-pulse { width: 7px; height: 7px; border-radius: 50%; background: var(--pine); position: relative; flex-shrink: 0; }
.aw-pulse::after {
  content: ''; position: absolute; inset: -4px; border-radius: 50%;
  border: 1px solid var(--pine); opacity: 0; animation: awring 2.6s ease-out infinite;
}
@keyframes awring { 0% { transform: scale(.6); opacity: .8; } 100% { transform: scale(1.6); opacity: 0; } }
@media (prefers-reduced-motion: reduce) { .aw-pulse::after { animation: none; } }
.aw-stamp-t { font-size: 12.5px; color: var(--ink-soft); }
.aw-stamp-t b { font-weight: 600; color: var(--ink); }
.aw-stamp[data-old="true"] .aw-pulse { background: var(--amber); }
.aw-stamp[data-old="true"] .aw-pulse::after { border-color: var(--amber); }

/* ---------- sector tabs ---------- */
.aw-sectors { display: flex; flex-wrap: wrap; gap: 7px; margin-bottom: 20px; }
.aw-sector {
  font-family: 'Noto Kufi Arabic', sans-serif; font-size: 13.5px; font-weight: 500;
  padding: 8px 15px; border: 1px solid var(--rule); border-radius: 2px;
  background: var(--surface); color: var(--ink-soft); cursor: pointer;
  transition: background .12s, color .12s, border-color .12s;
}
.aw-sector:hover { border-color: var(--ink-faint); }
.aw-sector:focus-visible { outline: 2px solid var(--pine); outline-offset: 1px; }
.aw-sector[data-on="true"] { background: var(--ink); border-color: var(--ink); color: #fff; }

/* ---------- ledger + filter ---------- */
.aw-bar {
  display: flex; align-items: stretch; justify-content: space-between; gap: 16px;
  flex-wrap: wrap; margin-bottom: 22px;
}
.aw-ledger {
  display: grid; grid-template-columns: repeat(4, minmax(78px, 1fr));
  border: 1px solid var(--rule); background: var(--surface); border-radius: 3px;
  overflow: hidden; flex: 1; min-width: 300px;
}
.aw-lc { padding: 12px 14px; border-inline-start: 1px solid var(--rule-soft); }
.aw-lc:first-child { border-inline-start: none; }
.aw-ln { font-family: 'IBM Plex Mono', monospace; font-size: 23px; font-weight: 500; line-height: 1.15; }
.aw-ll { font-size: 11px; color: var(--ink-faint); margin-top: 3px; }

.aw-filters { display: flex; gap: 6px; align-items: center; }
.aw-f {
  font-family: inherit; font-size: 12.5px; padding: 7px 13px;
  border: 1px solid var(--rule); border-radius: 100px; background: var(--surface);
  color: var(--ink-soft); cursor: pointer;
}
.aw-f:hover { border-color: var(--ink-faint); }
.aw-f:focus-visible { outline: 2px solid var(--pine); outline-offset: 1px; }
.aw-f[data-on="true"] { background: var(--pine); border-color: var(--pine); color: #fff; }

/* ---------- agency ---------- */
.aw-agency { margin-bottom: 24px; }
.aw-ahead {
  display: flex; align-items: center; gap: 10px;
  padding-bottom: 8px; margin-bottom: 11px; border-bottom: 1px solid var(--rule);
}
.aw-aname { font-family: 'Noto Kufi Arabic', sans-serif; font-weight: 600; font-size: 15px; line-height: 1.5; }
.aw-stale {
  font-size: 10.5px; font-weight: 600; padding: 2px 8px; border-radius: 100px;
  background: var(--amber-soft); color: var(--amber); white-space: nowrap;
}

/* ---------- card ---------- */
.aw-card {
  background: var(--surface); border: 1px solid var(--rule);
  border-radius: 3px; padding: 16px 18px; margin-bottom: 10px; border-inline-start-width: 3px;
}
.aw-ctop { display: flex; align-items: flex-start; gap: 12px; margin-bottom: 11px; }
.aw-cname { font-family: 'Noto Kufi Arabic', sans-serif; font-weight: 600; font-size: 14.5px; line-height: 1.6; flex: 1; }
.aw-cbadges { display: flex; flex-direction: column; align-items: flex-end; gap: 5px; flex-shrink: 0; }
.aw-badge { font-size: 11.5px; font-weight: 600; padding: 3px 10px; border-radius: 100px; white-space: nowrap; }
.aw-conf {
  font-size: 10.5px; font-weight: 600; padding: 2px 8px; border-radius: 100px; white-space: nowrap;
  background: var(--pine-soft); color: var(--pine);
}
.aw-conf[data-single="true"] { background: var(--slate-soft); color: var(--slate); }
.aw-cagency { font-size: 11.5px; color: var(--ink-faint); margin: -6px 0 10px; }

.aw-applies {
  font-size: 13px; color: var(--pine); background: var(--pine-soft);
  border-radius: 3px; padding: 8px 12px; margin-bottom: 12px;
}

.aw-rail { margin: 13px 0 14px; }
.aw-track { display: grid; grid-template-columns: repeat(4, 1fr); gap: 3px; margin-bottom: 6px; }
.aw-seg { height: 3px; background: var(--rule-soft); border-radius: 2px; }
.aw-labels { display: grid; grid-template-columns: repeat(4, 1fr); gap: 3px; }
.aw-lbl { font-size: 10.5px; color: var(--ink-faint); text-align: center; }

.aw-note { font-size: 13.5px; color: var(--ink-soft); margin-bottom: 12px; }
.aw-rows { border-top: 1px solid var(--rule-soft); }
.aw-row { display: flex; gap: 12px; padding: 9px 0; border-bottom: 1px solid var(--rule-soft); font-size: 13.5px; }
.aw-row:last-child { border-bottom: none; }
.aw-rk { flex-shrink: 0; width: 72px; font-size: 11.5px; font-weight: 600; color: var(--ink-faint); padding-top: 3px; }
.aw-rv { flex: 1; color: var(--ink-soft); }
.aw-pen { font-family: 'IBM Plex Mono', monospace; font-size: 13px; color: var(--crimson); font-weight: 500; }

.aw-steps { list-style: none; padding: 0; margin: 0; counter-reset: s; }
.aw-steps li { counter-increment: s; position: relative; padding-inline-start: 22px; margin-bottom: 5px; }
.aw-steps li:last-child { margin-bottom: 0; }
.aw-steps li::before {
  content: counter(s); position: absolute; inset-inline-start: 0; top: 1px;
  font-family: 'IBM Plex Mono', monospace; font-size: 10.5px;
  width: 15px; height: 15px; border-radius: 50%; background: var(--slate-soft); color: var(--slate);
  display: flex; align-items: center; justify-content: center;
}
.aw-src { font-size: 12px; color: var(--pine); text-decoration: none; border-bottom: 1px solid var(--pine-soft); }
.aw-src:hover { border-bottom-color: var(--pine); }
.aw-warn { font-size: 11.5px; color: var(--amber); margin-top: 4px; }

/* ============================================================
   المحلّل — الاستبيان الديناميكي
   ============================================================ */
.aw-flow { display: flex; align-items: center; gap: 8px; margin-bottom: 16px; flex-wrap: wrap; }
.aw-flow-s { display: flex; align-items: center; gap: 7px; font-size: 12.5px; color: var(--ink-faint); }
.aw-flow-n {
  width: 21px; height: 21px; border-radius: 50%; flex-shrink: 0;
  border: 1px solid var(--rule); background: var(--surface);
  font-family: 'IBM Plex Mono', monospace; font-size: 11px;
  display: flex; align-items: center; justify-content: center;
}
.aw-flow-s[data-on="true"] { color: var(--ink); font-weight: 600; }
.aw-flow-s[data-on="true"] .aw-flow-n { background: var(--ink); border-color: var(--ink); color: #fff; }
.aw-flow-s[data-done="true"] .aw-flow-n { background: var(--pine); border-color: var(--pine); color: #fff; }
.aw-flow-line { flex: 1; min-width: 14px; height: 1px; background: var(--rule); }

.aw-panel {
  background: var(--surface); border: 1px solid var(--rule);
  border-radius: 3px; padding: 20px; margin-bottom: 18px;
}
.aw-panel-t { font-family: 'Noto Kufi Arabic', sans-serif; font-weight: 600; font-size: 15.5px; margin-bottom: 6px; }
.aw-panel-s { font-size: 13px; color: var(--ink-soft); margin-bottom: 15px; }

.aw-ta {
  width: 100%; min-height: 118px; resize: vertical;
  font-family: inherit; font-size: 14px; line-height: 1.75; color: var(--ink);
  border: 1px solid var(--rule); border-radius: 3px; padding: 12px 14px;
  background: var(--paper); direction: rtl;
}
.aw-ta:focus { outline: none; border-color: var(--pine); background: var(--surface); }
.aw-ta::placeholder { color: var(--ink-faint); }

.aw-hints { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
.aw-hint {
  font-family: inherit; font-size: 12px; padding: 5px 11px;
  border: 1px dashed var(--rule); border-radius: 100px; background: transparent;
  color: var(--ink-faint); cursor: pointer;
}
.aw-hint:hover { border-style: solid; border-color: var(--pine); color: var(--pine); }

.aw-actions { display: flex; align-items: center; gap: 10px; margin-top: 15px; flex-wrap: wrap; }
.aw-btn {
  font-family: 'Noto Kufi Arabic', sans-serif; font-size: 13.5px; font-weight: 600;
  padding: 10px 22px; border: 1px solid var(--ink); border-radius: 2px;
  background: var(--ink); color: #fff; cursor: pointer;
  display: inline-flex; align-items: center; gap: 8px;
}
.aw-btn:hover:not(:disabled) { background: #000; }
.aw-btn:focus-visible { outline: 2px solid var(--pine); outline-offset: 2px; }
.aw-btn:disabled { opacity: .5; cursor: not-allowed; }
.aw-btn[data-ghost="true"] { background: transparent; color: var(--ink-soft); border-color: var(--rule); font-weight: 500; }
.aw-btn[data-ghost="true"]:hover:not(:disabled) { border-color: var(--ink-faint); background: transparent; }
.aw-count { font-size: 12px; color: var(--ink-faint); }

.aw-spin {
  width: 13px; height: 13px; border-radius: 50%; flex-shrink: 0;
  border: 2px solid currentColor; border-top-color: transparent;
  animation: awspin .7s linear infinite;
}
@keyframes awspin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .aw-spin { animation-duration: 2.4s; } }

.aw-err {
  font-size: 13px; color: var(--rust); background: var(--rust-soft);
  border-radius: 3px; padding: 10px 14px; margin-top: 14px;
}

/* ---------- الأسئلة ---------- */
.aw-biz {
  display: flex; align-items: flex-start; gap: 10px; flex-wrap: wrap;
  font-size: 13px; color: var(--ink-soft);
  border-bottom: 1px solid var(--rule-soft); padding-bottom: 14px; margin-bottom: 16px;
}
.aw-biz-l {
  font-family: 'Noto Kufi Arabic', sans-serif; font-weight: 600; font-size: 14px; color: var(--ink);
}

.aw-q { padding: 15px 0; border-bottom: 1px solid var(--rule-soft); }
.aw-q:last-of-type { border-bottom: none; padding-bottom: 4px; }
.aw-q-label { font-size: 14px; font-weight: 500; color: var(--ink); margin-bottom: 3px; }
.aw-q-why { font-size: 12px; color: var(--ink-faint); margin-bottom: 10px; line-height: 1.6; }
.aw-opts { display: flex; flex-wrap: wrap; gap: 7px; }
.aw-opt {
  font-family: inherit; font-size: 13px; padding: 7px 14px;
  border: 1px solid var(--rule); border-radius: 100px; background: var(--paper);
  color: var(--ink-soft); cursor: pointer; transition: background .12s, color .12s, border-color .12s;
}
.aw-opt:hover { border-color: var(--ink-faint); }
.aw-opt:focus-visible { outline: 2px solid var(--pine); outline-offset: 1px; }
.aw-opt[data-on="true"] { background: var(--pine); border-color: var(--pine); color: #fff; }
.aw-in {
  width: 100%; font-family: inherit; font-size: 13.5px; color: var(--ink);
  border: 1px solid var(--rule); border-radius: 3px; padding: 9px 12px;
  background: var(--paper); direction: rtl;
}
.aw-in:focus { outline: none; border-color: var(--pine); background: var(--surface); }

/* ---------- النتيجة ---------- */
.aw-verdict {
  background: var(--surface); border: 1px solid var(--rule); border-inline-start: 3px solid var(--pine);
  border-radius: 3px; padding: 18px 20px; margin-bottom: 18px;
}
.aw-verdict-t { font-family: 'Noto Kufi Arabic', sans-serif; font-weight: 600; font-size: 15px; margin-bottom: 8px; }
.aw-verdict-s { font-size: 13.5px; color: var(--ink-soft); line-height: 1.8; }
.aw-chips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 14px; }
.aw-chip {
  font-size: 11.5px; padding: 4px 11px; border-radius: 100px;
  background: var(--slate-soft); color: var(--slate);
}
.aw-gaps {
  font-size: 12.5px; color: var(--amber); background: var(--amber-soft);
  border-radius: 3px; padding: 12px 15px; margin-bottom: 18px;
}
.aw-gaps ul { margin: 6px 0 0; padding-inline-start: 18px; }
.aw-meta { font-size: 11.5px; color: var(--ink-faint); margin-bottom: 18px; }

/* ---------- المستجدات ---------- */
.aw-nwbar { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 16px; }
.aw-nwf {
  font-family: inherit; font-size: 12.5px; padding: 6px 13px;
  border: 1px solid var(--rule); border-radius: 100px; background: var(--surface);
  color: var(--ink-soft); cursor: pointer;
}
.aw-nwf:hover { border-color: var(--ink-faint); }
.aw-nwf[data-on="true"] { background: var(--navy); border-color: var(--navy); color: #fff; }

.aw-nwg { margin-bottom: 22px; }
.aw-nwg-t {
  font-family: 'Noto Kufi Arabic', sans-serif; font-weight: 600; font-size: 14px;
  padding-bottom: 7px; margin-bottom: 10px; border-bottom: 1px solid var(--rule);
  display: flex; align-items: center; gap: 9px;
}
.aw-nw {
  background: var(--surface); border: 1px solid var(--rule); border-inline-start-width: 3px;
  border-radius: 3px; padding: 14px 16px; margin-bottom: 8px;
}
.aw-nw-top { display: flex; align-items: flex-start; gap: 10px; margin-bottom: 7px; }
.aw-nw-t { flex: 1; font-size: 13.5px; font-weight: 500; line-height: 1.7; }
.aw-nw-k {
  flex-shrink: 0; font-size: 10.5px; font-weight: 600;
  padding: 2px 9px; border-radius: 100px; white-space: nowrap;
}
.aw-nw-i { font-size: 13px; color: var(--ink-soft); margin-bottom: 8px; }
.aw-nw-f { display: flex; gap: 14px; flex-wrap: wrap; font-size: 11.5px; color: var(--ink-faint); align-items: baseline; }
.aw-nw-d { color: var(--rust); font-weight: 600; }

/* ---------- التغطية ---------- */
.aw-covbar {
  display: flex; gap: 26px; flex-wrap: wrap;
  background: var(--surface); border: 1px solid var(--rule); border-radius: 3px;
  padding: 15px 20px; margin-bottom: 12px;
}
.aw-covstat { font-size: 13px; color: var(--ink-soft); }
.aw-covstat b { font-size: 20px; font-weight: 500; color: var(--navy); margin-inline-end: 6px; }
.aw-covnote { font-size: 12.5px; color: var(--ink-faint); margin-bottom: 18px; line-height: 1.7; }

.aw-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(250px, 1fr)); gap: 9px; }
.aw-cov {
  background: var(--surface); border: 1px solid var(--rule); border-radius: 3px;
  overflow: hidden; transition: border-color .12s;
}
.aw-cov:hover { border-color: var(--ink-faint); }
.aw-cov[data-on="true"] { border-color: var(--navy); grid-column: 1 / -1; }

.aw-cov-head {
  width: 100%; display: flex; align-items: center; gap: 12px; text-align: start;
  font-family: inherit; padding: 14px 15px; border: none; background: none; cursor: pointer; color: inherit;
}
.aw-cov-head:focus-visible { outline: 2px solid var(--pine); outline-offset: -2px; }
.aw-cov-ico {
  width: 38px; height: 38px; border-radius: 3px; flex-shrink: 0;
  background: var(--pine-soft); color: var(--navy);
  display: flex; align-items: center; justify-content: center;
}
.aw-cov[data-on="true"] .aw-cov-ico { background: var(--navy); color: #fff; }
.aw-cov-body { flex: 1; min-width: 0; }
.aw-cov-name { display: block; font-family: 'Noto Kufi Arabic', sans-serif; font-weight: 600; font-size: 13.5px; }
.aw-cov-count { display: block; font-size: 11.5px; color: var(--ink-faint); margin-top: 2px; }
.aw-cov-count b { color: var(--teal); font-weight: 600; }
.aw-cov-caret { font-family: 'IBM Plex Mono', monospace; font-size: 17px; color: var(--ink-faint); flex-shrink: 0; }

.aw-cov-list { padding: 0 15px 14px; border-top: 1px solid var(--rule-soft); }
.aw-cov-reg {
  display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap;
  padding: 8px 0; border-bottom: 1px solid var(--rule-soft); text-decoration: none;
}
.aw-cov-reg:hover .aw-cov-reg-n { color: var(--navy); }
.aw-cov-reg-n { font-size: 13px; color: var(--ink-soft); flex: 1; min-width: 160px; }
.aw-cov-reg-h { font-size: 11.5px; color: var(--teal); direction: ltr; }
.aw-cov-cta {
  margin-top: 12px; font-family: 'Noto Kufi Arabic', sans-serif; font-size: 12.5px; font-weight: 600;
  padding: 8px 16px; border: 1px solid var(--navy); border-radius: 2px;
  background: transparent; color: var(--navy); cursor: pointer;
}
.aw-cov-cta:hover { background: var(--navy); color: #fff; }

.aw-covsrc {
  margin-top: 22px; background: var(--surface); border: 1px solid var(--rule);
  border-radius: 3px; padding: 18px 20px;
}
.aw-covsrc-t { font-family: 'Noto Kufi Arabic', sans-serif; font-weight: 600; font-size: 14px; margin-bottom: 10px; }
.aw-covsrc-r {
  display: flex; gap: 12px; flex-wrap: wrap; font-size: 12.5px; color: var(--ink-faint);
  padding: 7px 0; border-top: 1px solid var(--rule-soft); line-height: 1.7;
}
.aw-covsrc-r a { flex-shrink: 0; min-width: 190px; }
.aw-covsrc-r span { flex: 1; min-width: 220px; }

/* ---------- جودة النتائج ---------- */
.aw-q2 {
  margin-top: 22px; background: var(--surface); border: 1px solid var(--rule);
  border-radius: 3px; padding: 18px 20px;
}
.aw-q2-t { font-family: 'Noto Kufi Arabic', sans-serif; font-weight: 600; font-size: 14px; }
.aw-q2-s { font-size: 12px; color: var(--ink-faint); margin: 3px 0 14px; }
.aw-q2-r { display: flex; align-items: center; gap: 12px; margin-bottom: 9px; font-size: 12.5px; }
.aw-q2-l { width: 128px; flex-shrink: 0; color: var(--ink-soft); }
.aw-q2-bar { flex: 1; height: 7px; background: var(--rule-soft); border-radius: 4px; overflow: hidden; min-width: 70px; }
/* block ضروري: span داخل span يبقى inline فلا يسري عليه width */
.aw-q2-fill { display: block; height: 100%; border-radius: 4px; }
.aw-q2-v { width: 40px; flex-shrink: 0; text-align: start; font-weight: 500; }
.aw-q2-note {
  font-size: 12px; color: var(--amber); background: var(--amber-soft);
  border-radius: 3px; padding: 10px 13px; margin-top: 14px; line-height: 1.75;
}

/* ---------- التقييم بعد التجربة ---------- */
.aw-rate {
  margin-top: 20px; background: var(--surface); border: 1px solid var(--rule);
  border-inline-start: 3px solid var(--teal); border-radius: 3px; padding: 18px 20px;
}
.aw-rate-t { font-family: 'Noto Kufi Arabic', sans-serif; font-weight: 600; font-size: 14px; margin-bottom: 3px; }
.aw-rate-s { font-size: 12.5px; color: var(--ink-faint); margin-bottom: 13px; }
.aw-stars { display: flex; gap: 5px; flex-wrap: wrap; }
.aw-star {
  font-family: inherit; font-size: 13px; min-width: 40px; padding: 8px 0;
  border: 1px solid var(--rule); border-radius: 3px; background: var(--paper);
  color: var(--ink-soft); cursor: pointer;
}
.aw-star:hover { border-color: var(--teal); }
.aw-star:focus-visible { outline: 2px solid var(--pine); outline-offset: 1px; }
.aw-star[data-on="true"] { background: var(--navy); border-color: var(--navy); color: #fff; font-weight: 600; }
.aw-rate-scale { display: flex; justify-content: space-between; font-size: 11px; color: var(--ink-faint); margin-top: 5px; max-width: 232px; }
.aw-rate-done { font-size: 13px; color: var(--pine); }

/* ---------- اقتراح مصدر ---------- */
.aw-add { margin-top: 13px; padding-top: 13px; border-top: 1px dashed var(--rule); }
.aw-add-t { font-size: 12px; color: var(--ink-faint); margin-bottom: 8px; }
.aw-add-row { display: flex; gap: 6px; flex-wrap: wrap; }
.aw-add-in {
  flex: 1; min-width: 210px; font-family: 'IBM Plex Mono', monospace; font-size: 12px;
  border: 1px solid var(--rule); border-radius: 3px; padding: 8px 10px;
  background: var(--paper); color: var(--ink); direction: ltr; text-align: left;
}
.aw-add-in:focus { outline: none; border-color: var(--teal); background: var(--surface); }
.aw-add-btn {
  font-family: 'Noto Kufi Arabic', sans-serif; font-size: 12.5px; font-weight: 600;
  padding: 8px 16px; border: 1px solid var(--navy); border-radius: 3px;
  background: var(--navy); color: #fff; cursor: pointer; flex-shrink: 0;
}
.aw-add-btn:disabled { opacity: .5; cursor: not-allowed; }
.aw-add-msg { font-size: 12px; margin-top: 8px; line-height: 1.7; }
.aw-add-msg[data-ok="true"] { color: var(--pine); }
.aw-add-msg[data-ok="false"] { color: var(--rust); }
.aw-sug {
  display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap;
  font-size: 12px; padding: 6px 0; color: var(--ink-faint);
}
.aw-sug-tag {
  font-size: 10px; font-weight: 600; padding: 1px 7px; border-radius: 100px;
  background: var(--amber-soft); color: var(--amber); white-space: nowrap;
}

/* ---------- شريط رسائل الناس ---------- */
.aw-wall { margin-top: 16px; }
.aw-wall-t {
  font-family: 'Noto Kufi Arabic', sans-serif; font-weight: 600; font-size: 13px;
  margin-bottom: 3px; display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap;
}
.aw-wall-c { font-size: 11.5px; font-weight: 400; color: var(--ink-faint); }
.aw-wall-s { font-size: 11.5px; color: var(--ink-faint); margin-bottom: 11px; }
/* شريط أفقي: يبقى مضغوطاً مهما كثرت الرسائل، ولا يدفع بقية الصفحة لأسفل */
.aw-wall-strip {
  display: flex; gap: 9px; overflow-x: auto; padding-bottom: 6px;
  scroll-snap-type: x proximity; -webkit-overflow-scrolling: touch;
}
.aw-wall-strip::-webkit-scrollbar { height: 5px; }
.aw-wall-strip::-webkit-scrollbar-thumb { background: var(--rule); border-radius: 3px; }
.aw-msg {
  flex: 0 0 250px; scroll-snap-align: start;
  background: var(--paper); border: 1px solid var(--rule);
  border-radius: 3px; padding: 12px 14px;
}
.aw-msg-h { display: flex; align-items: center; gap: 7px; margin-bottom: 6px; }
.aw-msg-r {
  font-family: 'IBM Plex Mono', monospace; font-size: 11px; font-weight: 600;
  padding: 1px 8px; border-radius: 100px; color: #fff;
}
.aw-msg-w { font-size: 11px; color: var(--ink-faint); }
.aw-msg-b { font-size: 12.5px; color: var(--ink-soft); line-height: 1.75; }

/* ---------- المخالفة بلغة مبسّطة ---------- */
.aw-plain {
  font-size: 13.5px; color: var(--ink); background: var(--paper);
  border-inline-start: 2px solid var(--teal); border-radius: 0 3px 3px 0;
  padding: 9px 12px; margin-top: 7px; line-height: 1.75;
}
.aw-plain-k { font-size: 10.5px; font-weight: 600; color: var(--teal); display: block; margin-bottom: 3px; }

/* ---------- states ---------- */
.aw-skel { height: 60px; background: var(--surface); border: 1px solid var(--rule-soft); border-radius: 3px; margin-bottom: 10px; }
.aw-empty { font-size: 13px; color: var(--ink-faint); padding: 6px 0; }
.aw-demo {
  font-size: 12.5px; color: var(--amber); background: var(--amber-soft);
  border-radius: 3px; padding: 10px 14px; margin-bottom: 18px;
}

/* ---------- support + disclaimer ---------- */
.aw-support {
  margin-top: 34px; background: var(--surface); border: 1px solid var(--rule);
  border-radius: 3px; padding: 22px;
}
.aw-support-t { font-family: 'Noto Kufi Arabic', sans-serif; font-weight: 600; font-size: 15px; margin-bottom: 5px; }
.aw-support-s { font-size: 13px; color: var(--ink-soft); max-width: 480px; margin-bottom: 16px; }

.aw-banks { display: flex; gap: 8px; flex-wrap: wrap; }
.aw-bank {
  display: inline-flex; align-items: center; gap: 9px;
  font-family: 'Noto Kufi Arabic', sans-serif; font-weight: 500; font-size: 13.5px;
  padding: 10px 17px; border: 1px solid var(--rule); border-radius: 2px;
  background: var(--surface); color: var(--ink-soft); cursor: pointer;
  transition: border-color .12s, background .12s, color .12s;
}
.aw-bank:hover { border-color: var(--ink-faint); }
.aw-bank:focus-visible { outline: 2px solid var(--pine); outline-offset: 1px; }
.aw-bank[data-on="true"] { background: var(--ink); border-color: var(--ink); color: #fff; }
.aw-bank-dot { width: 8px; height: 8px; border-radius: 2px; flex-shrink: 0; }

.aw-qr {
  margin-top: 18px; padding-top: 18px; border-top: 1px solid var(--rule-soft);
  display: flex; align-items: center; gap: 20px; flex-wrap: wrap;
  animation: awrise .22s ease-out;
}
@keyframes awrise { from { opacity: 0; transform: translateY(5px); } to { opacity: 1; transform: none; } }
@media (prefers-reduced-motion: reduce) { .aw-qr { animation: none; } }

.aw-qr-frame {
  width: 176px; height: 176px; flex-shrink: 0;
  background: #fff; border: 1px solid var(--rule); border-radius: 3px;
  padding: 11px; display: flex; align-items: center; justify-content: center;
}
.aw-qr-frame img { width: 100%; height: 100%; object-fit: contain; display: block; }
.aw-qr-miss { font-size: 11.5px; color: var(--ink-faint); text-align: center; line-height: 1.6; }

.aw-qr-side { flex: 1; min-width: 200px; }
.aw-qr-bank { font-family: 'Noto Kufi Arabic', sans-serif; font-weight: 600; font-size: 14.5px; margin-bottom: 7px; }
.aw-qr-how { font-size: 13px; color: var(--ink-soft); margin-bottom: 12px; }
.aw-qr-close {
  font-family: inherit; font-size: 12.5px; padding: 7px 15px;
  border: 1px solid var(--rule); border-radius: 2px; background: transparent;
  color: var(--ink-soft); cursor: pointer;
}
.aw-qr-close:hover { border-color: var(--ink-faint); }

.aw-credit {
  margin-top: 20px; padding-top: 16px; border-top: 1px solid var(--rule-soft);
  font-size: 12.5px; color: var(--ink-faint);
  display: flex; align-items: center; gap: 13px; flex-wrap: wrap;
}
.aw-credit-logo { height: 46px; width: auto; object-fit: contain; display: block; flex-shrink: 0; }
.aw-credit b { font-family: 'Noto Kufi Arabic', sans-serif; font-weight: 600; color: var(--navy); }

.aw-legal {
  margin-top: 14px; font-size: 12.5px; color: var(--ink-soft); line-height: 1.75;
  border-top: 1px solid var(--rule); padding-top: 14px;
}
.aw-legal strong { color: var(--ink); font-weight: 600; }

@media (max-width: 640px) {
  .aw-ledger { grid-template-columns: repeat(2, 1fr); min-width: 0; }
  .aw-lc:nth-child(3) { border-inline-start: none; }
  .aw-lc:nth-child(n+3) { border-top: 1px solid var(--rule-soft); }
  .aw-row { flex-direction: column; gap: 3px; }
  .aw-rk { width: auto; }
  .aw-lbl { font-size: 9.5px; }
  .aw-support { flex-direction: column; align-items: flex-start; }
  .aw-flow-line { display: none; }
  .aw-ctop { flex-direction: column; gap: 8px; }
  .aw-cbadges { flex-direction: row; align-items: center; }
}
`;

/* ---------- الحالة التنظيمية ---------- */
const STAGES = ["مسودة", "صادر", "مهلة", "نافذ"];
const STATUS = {
  draft: { i: 0, label: "تحت الاستطلاع", fg: "#5d6773", bg: "#e8ebee" },
  issued: { i: 1, label: "صادر — لم ينفذ", fg: "#a35a06", bg: "#f8eddc" },
  grace: { i: 2, label: "فترة مهلة", fg: "#b23a17", bg: "#fae7df" },
  enforced: { i: 3, label: "نافذ", fg: "#0b5d4e", bg: "#e3efeb" },
};
const st = (s) => STATUS[s] || STATUS.enforced;

/* ---------- أيقونات القطاعات ---------- */
/* خطّية بسيطة، currentColor حتى ترث لون البطاقة */
const P = (d) => (
  <path d={d} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
);
const ICONS = {
  contracting: <>{P("M3 20h18")}{P("M6 20V9l6-4 6 4v11")}{P("M10 20v-5h4v5")}</>,
  "realestate-dev": <>{P("M3 20h18")}{P("M5 20V6h6v14")}{P("M13 20V11h6v9")}{P("M8 9h.01M8 13h.01M16 15h.01")}</>,
  "realestate-broker": <>{P("M4 11l8-6 8 6")}{P("M6 10v10h12V10")}{P("M10 20v-6h4v6")}</>,
  food: <>{P("M5 3v7a3 3 0 006 0V3")}{P("M8 10v11")}{P("M17 3c-1.5 2-2 4-2 6s.5 3 2 3 2-1 2-3-.5-4-2-6z")}{P("M17 12v9")}</>,
  retail: <>{P("M4 8h16l-1 12H5L4 8z")}{P("M9 8V6a3 3 0 016 0v2")}</>,
  ecommerce: <>{P("M3 4h2l2 12h11")}{P("M7 8h14l-2 6H8")}{P("M9 20a1 1 0 100-2 1 1 0 000 2zM17 20a1 1 0 100-2 1 1 0 000 2z")}</>,
  software: <>{P("M9 8l-4 4 4 4")}{P("M15 8l4 4-4 4")}{P("M13 6l-2 12")}</>,
  healthtech: <>{P("M3 12h4l2-5 3 10 2-5h7")}{P("M12 20s-6-4-6-9a3 3 0 016-1 3 3 0 016 1")}</>,
  clinics: <>{P("M12 7v8M8 11h8")}{P("M5 21V5a2 2 0 012-2h10a2 2 0 012 2v16")}{P("M3 21h18")}</>,
  education: <>{P("M12 4L2 9l10 5 10-5-10-5z")}{P("M6 12v5c0 1 3 2 6 2s6-1 6-2v-5")}</>,
  logistics: <>{P("M2 7h11v9H2z")}{P("M13 10h4l3 3v3h-7")}{P("M6 19a1.5 1.5 0 100-3 1.5 1.5 0 000 3zM17 19a1.5 1.5 0 100-3 1.5 1.5 0 000 3z")}</>,
  tourism: <>{P("M3 20h18")}{P("M4 20v-6a2 2 0 012-2h12a2 2 0 012 2v6")}{P("M7 12V8h10v4")}{P("M9 8V5h6v3")}</>,
  manufacturing: <>{P("M3 20V10l5 3V10l5 3V10l5 3v7z")}{P("M3 20h18")}{P("M8 7V4")}</>,
  fintech: <>{P("M3 9l9-5 9 5")}{P("M5 9v9M10 9v9M14 9v9M19 9v9")}{P("M3 20h18")}</>,
  professional: <>{P("M4 7h16v13H4z")}{P("M9 7V5a2 2 0 012-2h2a2 2 0 012 2v2")}{P("M4 12h16")}</>,
  beauty: <>{P("M6 4a2.5 2.5 0 100 5 2.5 2.5 0 000-5zM6 15a2.5 2.5 0 100 5 2.5 2.5 0 000-5z")}{P("M8 7l11 10M8 17L19 7")}</>,
  media: <>{P("M3 7h13v10H3z")}{P("M16 11l5-3v8l-5-3")}</>,
};
const FALLBACK_ICON = <>{P("M4 5h16v14H4z")}{P("M8 9h8M8 13h5")}</>;

/* ---------- أدوات ---------- */
async function postJSON(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "تعذّر الاتصال بالخادم.");
  return data;
}

/* ============================================================ */
export default function Awares() {
  const [view, setView] = useState("analyze");

  return (
    <div className="aw-root">
      <style>{STYLES}</style>

      <header className="aw-top">
        <div className="aw-wrap aw-top-in">
          <div className="aw-brand">
            <img className="aw-mark" src="/mark.png" alt="" width="34" height="34" />
            <span className="aw-word">awares<span>.</span></span>
          </div>
          <div className="aw-tag">الوعي والامتثال التنظيمي للمنشآت السعودية — مجاناً</div>
        </div>
      </header>

      <main className="aw-wrap">
        <div className="aw-tabs" role="tablist">
          <button
            className="aw-tab"
            role="tab"
            data-on={view === "analyze"}
            aria-selected={view === "analyze"}
            onClick={() => setView("analyze")}
          >
            حلّل منشأتي
          </button>
          <button
            className="aw-tab"
            role="tab"
            data-on={view === "news"}
            aria-selected={view === "news"}
            onClick={() => setView("news")}
          >
            المستجدات
          </button>
          <button
            className="aw-tab"
            role="tab"
            data-on={view === "coverage"}
            aria-selected={view === "coverage"}
            onClick={() => setView("coverage")}
          >
            التغطية
          </button>
        </div>

        {view === "analyze" && <Analyzer />}
        {view === "news" && <News />}
        {view === "coverage" && <Coverage onPick={() => setView("analyze")} />}

        <Support />

        <div className="aw-legal">
          <strong>معلومة استرشادية — وليست شهادة امتثال ولا استشارة قانونية.</strong>{" "}
          يُجمَع هذا المحتوى آلياً من مصادر منشورة وقد يحتوي أخطاء أو يتأخر عن آخر تحديث رسمي.
          افتح المصدر الرسمي لكل بند وتحقق منه قبل اتخاذ أي إجراء يخص منشأتك.
        </div>
      </main>
    </div>
  );
}

/* ============================================================
   ١) المحلّل — وصف ← استبيان مُولَّد ← نتيجة
   ============================================================ */

const EXAMPLES = [
  "مقهى بفرعين في الرياض، ١٢ موظفاً، نحمّص حبوبنا ونبيعها عبر متجر إلكتروني، ولدينا توصيل.",
  "شركة برمجيات، ٢٥ موظفاً، نبني منصة SaaS للعملاء داخل المملكة ونخزّن بياناتهم على سحابة أجنبية.",
  "مكتب وساطة عقارية، ٦ موظفين، نسوّق وحدات على الخارطة ونحرّر عقود إيجار.",
];

const STEPS = ["وصف المنشأة", "استبيان مفصّل", "النتيجة"];

function Analyzer() {
  const [ready, setReady] = useState(null);       // هل الخادم مُهيّأ بمفاتيح؟
  const [step, setStep] = useState(1);
  const [desc, setDesc] = useState("");
  const [intake, setIntake] = useState(null);     // { business, questions }
  const [answers, setAnswers] = useState({});
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const panelRef = useRef(null);

  useEffect(() => {
    fetch("/api/status")
      .then((r) => (r.ok ? r.json() : { ready: false }))
      .then((j) => setReady(!!j.ready))
      .catch(() => setReady(false));
  }, []);

  // نُصعد المستخدم لأعلى اللوحة عند كل انتقال — الخطوة الجديدة قد تبدأ تحت الطيّة
  useEffect(() => {
    if (step > 1) panelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [step]);

  const buildIntake = async () => {
    setBusy(true);
    setError("");
    try {
      const data = await postJSON("/api/intake", { description: desc });
      setIntake(data);
      setAnswers({});
      setStep(2);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const runAnalysis = async () => {
    setBusy(true);
    setError("");
    try {
      const data = await postJSON("/api/analyze", {
        description: desc,
        business: intake?.business,
        questions: intake?.questions,
        answers,
      });
      setResult(data);
      setStep(3);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const restart = () => {
    setStep(1);
    setIntake(null);
    setAnswers({});
    setResult(null);
    setError("");
  };

  const answered = useMemo(
    () => Object.values(answers).filter((v) => (Array.isArray(v) ? v.length : String(v || "").trim())).length,
    [answers]
  );

  if (ready === false) {
    return (
      <div className="aw-demo">
        التحليل الفوري غير مُهيّأ على هذا الخادم. أضف <span className="aw-num">XAI_API_KEY</span> أو{" "}
        <span className="aw-num">GEMINI_API_KEY</span> في متغيّرات البيئة، أو استخدم تبويب
        «التغطية» الذي يعمل بلا مفاتيح.
      </div>
    );
  }

  return (
    <div ref={panelRef}>
      <div className="aw-flow">
        {STEPS.map((label, i) => (
          <React.Fragment key={label}>
            {i > 0 && <div className="aw-flow-line" />}
            <div className="aw-flow-s" data-on={step === i + 1} data-done={step > i + 1}>
              <span className="aw-flow-n">{step > i + 1 ? "✓" : i + 1}</span>
              {label}
            </div>
          </React.Fragment>
        ))}
      </div>

      {/* ---------- الخطوة ١: الوصف ---------- */}
      {step === 1 && (
        <div className="aw-panel">
          <div className="aw-panel-t">اوصف منشأتك بكلماتك</div>
          <div className="aw-panel-s">
            كلما كان الوصف أدق، كان الاستبيان بعده أذكى والنتيجة أقرب لواقعك.
            اذكر النشاط، وعدد الموظفين، والمدينة، وأي شيء غير معتاد فيه.
          </div>

          <textarea
            className="aw-ta"
            value={desc}
            maxLength={1200}
            onChange={(e) => setDesc(e.target.value)}
            placeholder="مثال: مقهى بفرعين، ١٢ موظفاً، نحمّص حبوبنا ونبيعها أونلاين مع توصيل…"
            aria-label="وصف المنشأة"
          />

          <div className="aw-hints">
            {EXAMPLES.map((ex, i) => (
              <button key={i} className="aw-hint" onClick={() => setDesc(ex)} type="button">
                {ex.slice(0, 34)}…
              </button>
            ))}
          </div>

          <div className="aw-actions">
            <button className="aw-btn" onClick={buildIntake} disabled={busy || desc.trim().length < 15}>
              {busy && <span className="aw-spin" />}
              {busy ? "يبني الاستبيان…" : "ابنِ لي الاستبيان"}
            </button>
            <span className="aw-count aw-num">{desc.length}/1200</span>
          </div>

          {error && <div className="aw-err">{error}</div>}
        </div>
      )}

      {/* ---------- الخطوة ٢: الاستبيان المُولَّد ---------- */}
      {step === 2 && intake && (
        <div className="aw-panel">
          <div className="aw-biz">
            <span className="aw-biz-l">{intake.business.label}</span>
            {intake.business.note && <span>{intake.business.note}</span>}
          </div>

          <div className="aw-panel-t">أسئلة مبنية على نشاطك</div>
          <div className="aw-panel-s">
            كل سؤال هنا يغيّر النتيجة فعلياً. اترك ما لا ينطبق فارغاً.
          </div>

          {intake.questions.map((q) => (
            <Question
              key={q.id}
              q={q}
              value={answers[q.id]}
              onChange={(v) => setAnswers((a) => ({ ...a, [q.id]: v }))}
            />
          ))}

          <div className="aw-actions">
            <button className="aw-btn" onClick={runAnalysis} disabled={busy}>
              {busy && <span className="aw-spin" />}
              {busy ? "يبحث في المصادر الرسمية…" : "حلّل منشأتي"}
            </button>
            <button className="aw-btn" data-ghost="true" onClick={restart} disabled={busy}>
              رجوع
            </button>
            <span className="aw-count aw-num">
              {answered}/{intake.questions.length}
            </span>
          </div>

          {busy && (
            <div className="aw-panel-s" style={{ marginTop: 12, marginBottom: 0 }}>
              يستغرق البحث نصف دقيقة إلى دقيقة — يمسح المصادر الرسمية بحثاً عن جداول المخالفات.
            </div>
          )}
          {error && <div className="aw-err">{error}</div>}
        </div>
      )}

      {/* ---------- الخطوة ٣: النتيجة ---------- */}
      {step === 3 && result && <Result result={result} onRestart={restart} />}
    </div>
  );
}

/* ---------- سؤال واحد، بحسب نوعه ---------- */
function Question({ q, value, onChange }) {
  const toggleMulti = (opt) => {
    const cur = Array.isArray(value) ? value : [];
    onChange(cur.includes(opt) ? cur.filter((x) => x !== opt) : [...cur, opt]);
  };

  return (
    <div className="aw-q">
      <div className="aw-q-label">{q.label}</div>
      {q.why && <div className="aw-q-why">{q.why}</div>}

      {q.type === "single" && (
        <div className="aw-opts">
          {q.options.map((opt) => (
            <button
              key={opt}
              type="button"
              className="aw-opt"
              data-on={value === opt}
              aria-pressed={value === opt}
              onClick={() => onChange(value === opt ? "" : opt)}
            >
              {opt}
            </button>
          ))}
        </div>
      )}

      {q.type === "multi" && (
        <div className="aw-opts">
          {q.options.map((opt) => {
            const on = Array.isArray(value) && value.includes(opt);
            return (
              <button
                key={opt}
                type="button"
                className="aw-opt"
                data-on={on}
                aria-pressed={on}
                onClick={() => toggleMulti(opt)}
              >
                {opt}
              </button>
            );
          })}
        </div>
      )}

      {(q.type === "text" || q.type === "number") && (
        <input
          className="aw-in"
          type={q.type === "number" ? "number" : "text"}
          value={value || ""}
          maxLength={300}
          onChange={(e) => onChange(e.target.value)}
          placeholder="اكتب إجابتك"
          aria-label={q.label}
        />
      )}
    </div>
  );
}

/* ---------- النتيجة ---------- */
function Result({ result, onRestart }) {
  const counts = useMemo(() => {
    const c = { draft: 0, issued: 0, grace: 0, enforced: 0 };
    result.items.forEach((i) => { if (c[i.status] !== undefined) c[i.status]++; });
    return c;
  }, [result]);

  return (
    <>
      <div className="aw-verdict">
        <div className="aw-verdict-t">{result.business?.label || "منشأتك"} — الخلاصة</div>
        <div className="aw-verdict-s">{result.summary}</div>
        {result.agencies?.length > 0 && (
          <div className="aw-chips">
            {result.agencies.map((a) => (
              <span className="aw-chip" key={a}>{a}</span>
            ))}
          </div>
        )}
      </div>

      <div className="aw-bar">
        <div className="aw-ledger">
          {[["enforced", "نافذ"], ["grace", "فترة مهلة"], ["issued", "صادر — لم ينفذ"], ["draft", "تحت الاستطلاع"]]
            .map(([k, label]) => (
              <div className="aw-lc" key={k}>
                <div className="aw-ln" style={{ color: STATUS[k].fg }}>
                  {String(counts[k]).padStart(2, "0")}
                </div>
                <div className="aw-ll">{label}</div>
              </div>
            ))}
        </div>
        <div className="aw-filters">
          <button className="aw-f" onClick={onRestart}>تحليل جديد</button>
        </div>
      </div>

      {result.items.map((item, i) => <Card key={i} item={item} showAgency />)}

      {result.gaps?.length > 0 && (
        <div className="aw-gaps">
          لم نتمكّن من التحقق مما يلي — راجعه بنفسك:
          <ul>{result.gaps.map((g, i) => <li key={i}>{g}</li>)}</ul>
        </div>
      )}

      <div className="aw-meta">
        تحليل آلي عبر بحث حيّ في المصادر الرسمية · المزوّد: {result.provider}
        {result.cached && " · نتيجة محفوظة لوصف مطابق — بلا استدعاء جديد"}
      </div>

      <Rate sector={result.business?.label} />
    </>
  );
}

/* ============================================================
   ٢) التغطية — عرض ثابت، بلا استدعاءات ولا تكلفة

   لا نولّد بيانات القطاعات مسبقاً بعد الآن. البطاقة هنا تجيب على
   «هل تغطّون نشاطي؟» بعدّ الجهات الرقابية المسجّلة لهذا القطاع،
   وكلها من regulators.mjs المُتحقَّق من نطاقاته حياً.
   ============================================================ */
function Coverage({ onPick }) {
  const [open, setOpen] = useState(null);

  const rows = useMemo(
    () => SECTORS.map((s) => ({ ...s, regs: regulatorsFor(s.id) })),
    []
  );
  const totalHosts = useMemo(
    () => new Set(REGULATORS.map((r) => r.host)).size,
    []
  );

  return (
    <>
      <div className="aw-covbar">
        <div className="aw-covstat">
          <b className="aw-num">{SECTORS.length}</b> قطاعاً مغطّى
        </div>
        <div className="aw-covstat">
          <b className="aw-num">{totalHosts}</b> جهة رقابية في السجل
        </div>
        <div className="aw-covstat">
          <b className="aw-num">{PRIMARY_SOURCES.length}</b> مصادر مرجعية عليا
        </div>
      </div>

      <div className="aw-covnote">
        كل نطاق في السجل جرى فحصه حياً. التحليل الفعلي يجري عند الطلب في تبويب
        «حلّل منشأتي» — لا نخزّن مخالفات جاهزة، فالأنظمة تتغيّر.
      </div>

      <div className="aw-grid">
        {rows.map((s) => {
          const on = open === s.id;
          return (
            <div key={s.id} className="aw-cov" data-on={on}>
              <button
                className="aw-cov-head"
                aria-expanded={on}
                onClick={() => setOpen(on ? null : s.id)}
              >
                <span className="aw-cov-ico" aria-hidden="true">
                  <svg viewBox="0 0 24 24" width="22" height="22">{ICONS[s.id] || FALLBACK_ICON}</svg>
                </span>
                <span className="aw-cov-body">
                  <span className="aw-cov-name">{s.name}</span>
                  <span className="aw-cov-count">
                    <b className="aw-num">{s.regs.length}</b> جهة رقابية
                  </span>
                </span>
                <span className="aw-cov-caret" aria-hidden="true">{on ? "−" : "+"}</span>
              </button>

              {on && (
                <div className="aw-cov-list">
                  {s.regs.map((r) => (
                    <a
                      key={r.id}
                      className="aw-cov-reg"
                      href={`https://${r.host}`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <span className="aw-cov-reg-n">{r.name}</span>
                      <span className="aw-cov-reg-h aw-num">{r.host}</span>
                    </a>
                  ))}
                  <AddSource sectorId={s.id} />

                  <button className="aw-cov-cta" onClick={onPick}>
                    حلّل منشأتي في هذا القطاع ←
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <Quality />

      <div className="aw-covsrc">
        <div className="aw-covsrc-t">المصادر المرجعية العليا</div>
        {PRIMARY_SOURCES.map((p) => (
          <div className="aw-covsrc-r" key={p.id}>
            <a className="aw-src" href={`https://${p.host}`} target="_blank" rel="noopener noreferrer">
              {p.name}
            </a>
            <span>{p.role}</span>
          </div>
        ))}
      </div>
    </>
  );
}

/* ============================================================
   ٣) المستجدات — ما تغيّر فعلاً، من ملف ثابت يولّده news.mjs
   ============================================================ */
const KIND = {
  law:          { label: "نظام", fg: "#0b5d4e", bg: "#e3efeb" },
  regulation:   { label: "لائحة", fg: "#5d6773", bg: "#e8ebee" },
  penalty:      { label: "غرامات", fg: "#97122f", bg: "#fae7df" },
  consultation: { label: "استطلاع", fg: "#a35a06", bg: "#f8eddc" },
  enforcement:  { label: "ضبطيات", fg: "#b23a17", bg: "#fae7df" },
};

function News() {
  const [data, setData] = useState(undefined);
  const [kind, setKind] = useState("all");

  useEffect(() => {
    fetch("/data/news.json")
      .then((r) => (r.ok ? r.json() : null))
      .then(setData)
      .catch(() => setData(null));
  }, []);

  if (data === undefined) return <><div className="aw-skel" /><div className="aw-skel" /></>;
  if (!data?.groups?.length) {
    return (
      <div className="aw-demo">
        لم تُولَّد المستجدات بعد. شغّل <span className="aw-num">node news.mjs</span>.
      </div>
    );
  }

  const stamp = new Date(data.generatedAt).toLocaleDateString("ar-SA", {
    year: "numeric", month: "long", day: "numeric",
  });
  const kinds = ["all", ...new Set(data.groups.flatMap((g) => g.items.map((i) => i.kind)))];
  const shown = data.groups
    .map((g) => ({ ...g, items: g.items.filter((i) => kind === "all" || i.kind === kind) }))
    .filter((g) => g.items.length);

  return (
    <>
      <div className="aw-stamp">
        <span className="aw-pulse" />
        <span className="aw-stamp-t">
          <b className="aw-num">{data.total}</b> مستجداً خلال آخر{" "}
          <b className="aw-num">{data.windowDays}</b> يوماً · رُصدت {stamp}
        </span>
      </div>

      <div className="aw-nwbar">
        {kinds.map((k) => (
          <button key={k} className="aw-nwf" data-on={kind === k} onClick={() => setKind(k)}>
            {k === "all" ? "الكل" : KIND[k]?.label || k}
          </button>
        ))}
      </div>

      {shown.map((g) => (
        <section className="aw-nwg" key={g.id}>
          <div className="aw-nwg-t">
            {g.name}
            {g.stale && <span className="aw-stale">قد تكون قديمة</span>}
          </div>
          {g.items.map((it, i) => {
            const k = KIND[it.kind] || KIND.regulation;
            return (
              <article className="aw-nw" key={i} style={{ borderInlineStartColor: k.fg }}>
                <div className="aw-nw-top">
                  <h3 className="aw-nw-t">{it.title}</h3>
                  <span className="aw-nw-k" style={{ color: k.fg, background: k.bg }}>{k.label}</span>
                </div>
                {it.impact && <div className="aw-nw-i">{it.impact}</div>}
                <div className="aw-nw-f">
                  {it.agency && <span>{it.agency}</span>}
                  {it.date && <span className="aw-num">{it.date}</span>}
                  {it.deadline && <span className="aw-nw-d">مهلة: {it.deadline}</span>}
                  {it.source && (
                    <a className="aw-src" href={it.source} target="_blank" rel="noopener noreferrer">
                      المصدر الرسمي
                    </a>
                  )}
                  {it.unverifiedSource && <span style={{ color: "var(--amber)" }}>مصدر يحتاج تحققاً</span>}
                </div>
              </article>
            );
          })}
        </section>
      ))}

      {!shown.length && <div className="aw-empty">لا مستجدات ضمن هذا التصنيف.</div>}
    </>
  );
}

/* ---------- اقتراح مصدر لقطاع ----------
   المقترحات تُوسم «غير مراجَع» ولا تدخل السجل المُتحقَّق منه ولا تُمرَّر
   للنموذج كمرجع. الترقية تحتاج مراجعة بشرية — وإلا صار أي مجهول قادراً
   على حقن مرجع في أداة امتثال. */
function AddSource({ sectorId }) {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [list, setList] = useState([]);

  useEffect(() => {
    fetch(`/api/sources?sector=${encodeURIComponent(sectorId)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => setList(j?.sources || []))
      .catch(() => setList([]));
  }, [sectorId]);

  const send = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await postJSON("/api/sources", { sectorId, url: url.trim() });
      setMsg({ ok: true, text: r.hint || `أُضيف مصدر من «${r.source.host}» — بانتظار المراجعة.` });
      setList((l) => [r.source, ...l]);
      setUrl("");
    } catch (e) {
      setMsg({ ok: false, text: e.message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="aw-add">
      {list.length > 0 && (
        <div style={{ marginBottom: 11 }}>
          {list.map((s) => (
            <div className="aw-sug" key={s.id}>
              <a className="aw-src" href={s.url} target="_blank" rel="noopener noreferrer">
                {s.regulator || s.host}
              </a>
              <span className="aw-sug-tag">مقترح — غير مراجَع</span>
            </div>
          ))}
        </div>
      )}

      <div className="aw-add-t">
        تعرف مصدراً رسمياً ينقصنا؟ نقبل روابط الجهات الرسمية فقط، ونتحقق أن الرابط يفتح.
      </div>
      <div className="aw-add-row">
        <input
          className="aw-add-in"
          value={url}
          maxLength={500}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && url.trim() && !busy && send()}
          placeholder="https://sfda.gov.sa/ar/regulations/..."
          aria-label="رابط المصدر"
          dir="ltr"
        />
        <button className="aw-add-btn" onClick={send} disabled={busy || url.trim().length < 12}>
          {busy ? "يتحقق…" : "اقترح"}
        </button>
      </div>
      {msg && <div className="aw-add-msg" data-ok={msg.ok}>{msg.text}</div>}
    </div>
  );
}

/* ---------- شريط رسائل الناس — عام ----------
   ملاحظات المستخدمين تُعرض كما كُتبت بعد تنظيف بسيط على الخادم
   (حذف الروابط وأرقام التواصل ووسوم HTML). ليست فلترة محتوى كاملة —
   إن كبر الاستخدام فستحتاج مراجعة قبل النشر. */
function agoLabel(iso) {
  const m = Math.floor((Date.now() - new Date(iso)) / 60000);
  if (!isFinite(m) || m < 1) return "الآن";
  if (m < 60) return `قبل ${m} د`;
  const h = Math.floor(m / 60);
  if (h < 24) return `قبل ${h} س`;
  const d = Math.floor(h / 24);
  return d < 30 ? `قبل ${d} يوم` : `قبل ${Math.floor(d / 30)} شهر`;
}

function Wall({ notes }) {
  if (!notes?.length) return null;
  const color = (r) => (r >= 4 ? "var(--pine)" : r === 3 ? "var(--slate)" : "var(--rust)");

  return (
    <div className="aw-wall">
      <div className="aw-wall-t">
        ماذا قال المستخدمون
        <span className="aw-wall-c">{notes.length} رسالة</span>
      </div>
      <div className="aw-wall-s">تُعرض كما كُتبت — بما فيها الانتقادات.</div>
      <div className="aw-wall-strip">
        {notes.map((n, i) => (
          <div className="aw-msg" key={i}>
            <div className="aw-msg-h">
              <span className="aw-msg-r aw-num" style={{ background: color(n.rating) }}>
                {n.rating}/5
              </span>
              <span className="aw-msg-w">{agoLabel(n.at)}</span>
              {n.sector && <span className="aw-msg-w">· {n.sector}</span>}
            </div>
            <div className="aw-msg-b">{n.note}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------- التقييم بعد التجربة ----------
   يُسأل بعد رؤية النتيجة لا قبلها، فالتقييم عن شيء رآه المستخدم فعلاً.
   الملخّص يظهر للعموم في لوحة الجودة. */
function Rate({ sector }) {
  const [score, setScore] = useState(0);
  const [note, setNote] = useState("");
  const [sent, setSent] = useState(null);
  const [busy, setBusy] = useState(false);

  const submit = async (rating) => {
    setScore(rating);
    setBusy(true);
    try {
      const r = await postJSON("/api/feedback", {
        rating,
        helpful: rating >= 4,
        note: note.trim(),
        sector: sector || "",
      });
      setSent({ ...r.summary, notes: r.notes || [] });
    } catch {
      setSent({ count: 0, notes: [] });
    } finally {
      setBusy(false);
    }
  };

  if (sent) {
    return (
      <div className="aw-rate">
        <div className="aw-rate-done">
          شكراً — سُجّل تقييمك.
          {sent.count > 0 && (
            <> المتوسط العام الآن <b className="aw-num">{sent.average}</b>/5 من{" "}
              <b className="aw-num">{sent.count}</b> تقييماً.</>
          )}
        </div>
        {/* شريط الرسائل يظهر بعد التقييم مباشرة — تراه بعد أن تشارك، لا قبل */}
        <Wall notes={sent.notes} />
      </div>
    );
  }

  return (
    <div className="aw-rate">
      <div className="aw-rate-t">كم أفادك هذا التحليل؟</div>
      <div className="aw-rate-s">
        تقييمك يظهر للعموم في تبويب «التغطية» — بالرقم كما هو.
      </div>

      <input
        className="aw-in"
        style={{ marginBottom: 11 }}
        value={note}
        maxLength={500}
        onChange={(e) => setNote(e.target.value)}
        placeholder="ما الذي نقص أو أخطأ؟ (اختياري — وأنفع شيء لنا)"
        aria-label="ملاحظتك"
      />

      <div className="aw-stars" role="group" aria-label="التقييم من ١ إلى ٥">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            className="aw-star"
            data-on={score === n}
            disabled={busy}
            onClick={() => submit(n)}
            aria-label={`${n} من ٥`}
          >
            {n}
          </button>
        ))}
      </div>
      <div className="aw-rate-scale">
        <span>لم يفدني</span>
        <span>أفادني كثيراً</span>
      </div>
    </div>
  );
}

/* ---------- جودة النتائج — أرقام مقيسة، معروضة للعموم ----------
   تُولَّد بـ `node eval.mjs` على منشآت نموذجية. نعرضها كما هي حتى لو ساءت،
   لأن أداة امتثال تخفي معدّل خطئها أسوأ من أداة لا تقيسه أصلاً. */
const METRICS = [
  ["sourceOfficial", "مصدر رسمي", true],
  ["sourceAlive", "الرابط يفتح فعلاً", true],
  ["penaltyNamed", "جزاء محدد بالريال", true],
  ["plainLanguage", "شرح مبسّط للمخالفة", true],
  ["appliesLinked", "مربوط بنشاطك", true],
  ["flaggedSource", "موسوم للمراجعة", false], // كلما قلّ كان أفضل
];

function Quality() {
  const [q, setQ] = useState(null);
  const [fb, setFb] = useState(null);

  useEffect(() => {
    fetch("/data/quality.json")
      .then((r) => (r.ok ? r.json() : null))
      .then(setQ)
      .catch(() => setQ(null));
    fetch("/api/feedback")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => setFb(j ? { ...j.feedback, notes: j.notes || [] } : null))
      .catch(() => setFb(null));
  }, []);

  if (!q?.metrics) return null;

  const when = new Date(q.generatedAt).toLocaleDateString("ar-SA", {
    year: "numeric", month: "long", day: "numeric",
  });

  return (
    <div className="aw-q2">
      <div className="aw-q2-t">جودة النتائج — مقيسة لا مُدّعاة</div>
      <div className="aw-q2-s">
        قياس آلي على <b className="aw-num">{q.profiles}</b> منشأة نموذجية و
        <b className="aw-num"> {q.items}</b> بنداً · {when}
      </div>

      {METRICS.map(([key, label, higherBetter]) => {
        const v = q.metrics[key] ?? 0;
        const good = higherBetter ? v >= 80 : v <= 20;
        const mid = higherBetter ? v >= 55 : v <= 45;
        const color = good ? "var(--pine)" : mid ? "var(--amber)" : "var(--rust)";
        return (
          <div className="aw-q2-r" key={key}>
            <span className="aw-q2-l">{label}</span>
            <span className="aw-q2-bar">
              <span className="aw-q2-fill" style={{ width: `${v}%`, background: color }} />
            </span>
            <span className="aw-q2-v aw-num" style={{ color }}>{v}%</span>
          </div>
        );
      })}

      {/* تقييم المستخدمين — منفصل عن القياس الآلي لأنه يقيس شيئاً آخر:
          القياس يقول هل المخرجات مكتملة الشكل، والتقييم يقول هل نفعت أحداً */}
      {fb?.count > 0 && (
        <div className="aw-q2-r" style={{ marginTop: 14, paddingTop: 13, borderTop: "1px solid var(--rule-soft)" }}>
          <span className="aw-q2-l">تقييم المستخدمين</span>
          <span className="aw-q2-bar">
            <span
              className="aw-q2-fill"
              style={{ width: `${(fb.average / 5) * 100}%`, background: "var(--teal)" }}
            />
          </span>
          <span className="aw-q2-v aw-num" style={{ color: "var(--navy)", width: 78 }}>
            {fb.average}/5 · {fb.count}
          </span>
        </div>
      )}

      <div className="aw-q2-note">{q.caveat}</div>

      <Wall notes={fb?.notes} />
    </div>
  );
}

/* ---------- الدعم: اختر بنكك ثم امسح الرمز ---------- */
function Support() {
  const [picked, setPicked] = useState(null);
  const [missing, setMissing] = useState(false);
  const bank = BANKS.find((b) => b.id === picked);

  const choose = (id) => {
    setMissing(false);
    setPicked((p) => (p === id ? null : id));
  };

  return (
    <div className="aw-support">
      <div className="aw-support-t">awares مجاني ويبقى مجانياً</div>
      <div className="aw-support-s">
        تشغيله يكلّف بضعة دولارات شهرياً تغطي مسح المصادر أسبوعياً والتحليل الفوري.
        إن نفعك، اختر بنكك وامسح الرمز.
      </div>

      <div className="aw-banks">
        {BANKS.map((b) => (
          <button
            key={b.id}
            className="aw-bank"
            data-on={picked === b.id}
            aria-expanded={picked === b.id}
            onClick={() => choose(b.id)}
          >
            <span className="aw-bank-dot" style={{ background: b.dot }} />
            {b.name}
          </button>
        ))}
      </div>

      {bank && (
        <div className="aw-qr">
          <div className="aw-qr-frame">
            {missing ? (
              <div className="aw-qr-miss">
                ضع صورة الرمز في
                <br />
                <span className="aw-num">{bank.qr}</span>
              </div>
            ) : (
              <img src={bank.qr} alt={`رمز التحويل عبر ${bank.name}`} onError={() => setMissing(true)} />
            )}
          </div>

          <div className="aw-qr-side">
            <div className="aw-qr-bank">{bank.name}</div>
            <div className="aw-qr-how">
              افتح تطبيق {bank.name} واختر المسح الضوئي، ثم وجّه الكاميرا على الرمز.
              المبلغ يحدده أنت.
            </div>
            <button className="aw-qr-close" onClick={() => setPicked(null)}>
              إخفاء الرمز
            </button>
          </div>
        </div>
      )}

      <div className="aw-credit">
        <img className="aw-credit-logo" src="/logo.png" alt="awares — الوعي والامتثال التنظيمي" />
        <span>تطوير <b>امتنان المطيري</b></span>
      </div>
    </div>
  );
}

/* ---------- بطاقة الالتزام ---------- */
function Card({ item, showAgency }) {
  const s = st(item.status);
  const edge = item.severity === "high" ? "#97122f" : item.severity === "medium" ? s.fg : "var(--rule)";

  return (
    <article className="aw-card" style={{ borderInlineStartColor: edge }}>
      <div className="aw-ctop">
        <h3 className="aw-cname">{item.name}</h3>
        <div className="aw-cbadges">
          <span className="aw-badge" style={{ color: s.fg, background: s.bg }}>{s.label}</span>
          {item.confidence && (
            <span className="aw-conf" data-single={item.confidence === "single"}>
              {item.confidence === "confirmed"
                ? `مؤكّد من ${item.verifiedBy?.length || 2} مصادر تحليل`
                : "مصدر تحليل واحد"}
            </span>
          )}
        </div>
      </div>

      {showAgency && item.agency && <div className="aw-cagency">{item.agency}</div>}
      {item.applies && <div className="aw-applies">{item.applies}</div>}

      <div className="aw-rail">
        <div className="aw-track">
          {STAGES.map((_, i) => (
            <div key={i} className="aw-seg" style={i <= s.i ? { background: s.fg } : undefined} />
          ))}
        </div>
        <div className="aw-labels">
          {STAGES.map((label, i) => (
            <div key={label} className="aw-lbl" style={i === s.i ? { color: s.fg, fontWeight: 600 } : undefined}>
              {label}
            </div>
          ))}
        </div>
      </div>

      {item.statusNote && <div className="aw-note" style={{ color: s.fg, fontWeight: 500 }}>{item.statusNote}</div>}
      {item.summary && <div className="aw-note">{item.summary}</div>}

      <div className="aw-rows">
        {(item.violation || item.plain) && (
          <div className="aw-row">
            <div className="aw-rk">المخالفة</div>
            <div className="aw-rv">
              {item.violation}
              {/* الصياغة النظامية تبقى كما وردت، وتحتها ترجمتها لصاحب المنشأة */}
              {item.plain && (
                <div className="aw-plain">
                  <span className="aw-plain-k">بالمختصر</span>
                  {item.plain}
                </div>
              )}
            </div>
          </div>
        )}
        {item.penalty && (
          <div className="aw-row"><div className="aw-rk">الجزاء</div><div className="aw-rv aw-pen">{item.penalty}</div></div>
        )}
        {Array.isArray(item.steps) && item.steps.length > 0 && (
          <div className="aw-row">
            <div className="aw-rk">الاستيفاء</div>
            <div className="aw-rv">
              <ol className="aw-steps">{item.steps.map((x, i) => <li key={i}>{x}</li>)}</ol>
            </div>
          </div>
        )}
        {item.source && (
          <div className="aw-row">
            <div className="aw-rk">المصدر</div>
            <div className="aw-rv">
              <a className="aw-src" href={item.source} target="_blank" rel="noopener noreferrer">
                فتح المصدر الرسمي
              </a>
              {item.unverifiedSource && (
                <div className="aw-warn">لم يظهر هذا الرابط ضمن نتائج البحث — تحقق منه بنفسك.</div>
              )}
            </div>
          </div>
        )}
      </div>
    </article>
  );
}
