/* Nimbus Portal — shared helpers */
window.N = window.N || {};

(function (N) {
  const esc = (s) =>
    String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");

  const uid = (p = "") => p + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);

  const fmtBytes = (n) => {
    if (n < 1024) return n + " B";
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + " KiB";
    return (n / 1024 / 1024).toFixed(2) + " MiB";
  };

  const fmtTime = (t) => {
    if (!t) return "—";
    const d = new Date(t);
    return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" });
  };

  const fmtDur = (ms) => {
    if (ms == null) return "—";
    if (ms < 1000) return ms + " ms";
    const s = ms / 1000;
    if (s < 60) return s.toFixed(1) + " s";
    return Math.floor(s / 60) + "m " + Math.round(s % 60) + "s";
  };

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  /* ---------- CSV ---------- */
  function parseCSV(text, delim = ",") {
    const rows = [];
    let row = [], field = "", i = 0, inQ = false;
    text = String(text || "").replace(/^﻿/, "");
    while (i < text.length) {
      const c = text[i];
      if (inQ) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
          inQ = false; i++; continue;
        }
        field += c; i++; continue;
      }
      if (c === '"') { inQ = true; i++; continue; }
      if (c === delim) { row.push(field); field = ""; i++; continue; }
      if (c === "\r") { i++; continue; }
      if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; i++; continue; }
      field += c; i++;
    }
    if (field !== "" || row.length) { row.push(field); rows.push(row); }
    const nonEmpty = rows.filter((r) => !(r.length === 1 && r[0] === ""));
    if (!nonEmpty.length) return { columns: [], rows: [] };
    const header = nonEmpty[0].map((h, idx) => (h || "col" + (idx + 1)).trim());
    return {
      columns: header,
      rows: nonEmpty.slice(1).map((r) => {
        const o = {};
        header.forEach((h, k) => (o[h] = r[k] === undefined ? "" : r[k]));
        return o;
      }),
    };
  }

  function csvCell(v) {
    if (v === null || v === undefined) return "";
    const s = String(v);
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  function toCSV(columns, rows) {
    const lines = [columns.map(csvCell).join(",")];
    for (const r of rows) lines.push(columns.map((c) => csvCell(Array.isArray(r) ? r[columns.indexOf(c)] : r[c])).join(","));
    return lines.join("\n") + "\n";
  }

  /* JSON or JSON-lines → {columns, rows} */
  function parseJSONData(text) {
    text = String(text || "").trim();
    let arr;
    if (!text) return { columns: [], rows: [] };
    if (text[0] === "[") arr = JSON.parse(text);
    else if (text[0] === "{" && !text.includes("\n")) arr = [JSON.parse(text)];
    else arr = text.split(/\n+/).filter((l) => l.trim()).map((l) => JSON.parse(l));
    const cols = [];
    const flat = arr.map((o) => flatten(o));
    flat.forEach((o) => Object.keys(o).forEach((k) => { if (!cols.includes(k)) cols.push(k); }));
    return { columns: cols, rows: flat };
  }

  function flatten(o, prefix = "", out = {}) {
    for (const [k, v] of Object.entries(o || {})) {
      const key = prefix ? prefix + "_" + k : k;
      if (v && typeof v === "object" && !Array.isArray(v)) flatten(v, key, out);
      else out[key] = Array.isArray(v) ? JSON.stringify(v) : v;
    }
    return out;
  }

  function toJSONLines(columns, rows) {
    return rows.map((r) => {
      const o = {};
      columns.forEach((c, i) => (o[c] = Array.isArray(r) ? r[i] : r[c]));
      return JSON.stringify(o);
    }).join("\n") + "\n";
  }

  /* Infer SQLite type for a column of string-ish values */
  function inferType(values) {
    let sawInt = true, sawNum = true, any = false;
    for (const v of values) {
      if (v === null || v === undefined || v === "") continue;
      any = true;
      if (typeof v === "number") { if (!Number.isInteger(v)) sawInt = false; continue; }
      if (typeof v === "boolean") continue;
      const s = String(v).trim();
      if (!/^-?\d+$/.test(s) || (s.length > 1 && s[0] === "0" && !s.startsWith("0.")) ) sawInt = false;
      if (!/^-?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(s)) sawNum = false;
      if (!sawNum) break;
    }
    if (!any) return "TEXT";
    if (sawInt) return "INTEGER";
    if (sawNum) return "REAL";
    return "TEXT";
  }

  function coerce(v, type) {
    if (v === null || v === undefined || v === "") return null;
    if (typeof v === "boolean") return v ? 1 : 0;
    if (type === "INTEGER") { const n = parseInt(v, 10); return isNaN(n) ? String(v) : n; }
    if (type === "REAL") { const n = parseFloat(v); return isNaN(n) ? String(v) : n; }
    return typeof v === "object" ? JSON.stringify(v) : String(v);
  }

  const qid = (name) => '"' + String(name).replace(/"/g, '""') + '"';

  /* glob: supports * and ** within a path */
  function globToRegex(glob) {
    let re = "";
    for (let i = 0; i < glob.length; i++) {
      const c = glob[i];
      if (c === "*") {
        if (glob[i + 1] === "*") { re += ".*"; i++; } else re += "[^/]*";
      } else if (c === "?") re += "[^/]";
      else re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    }
    return new RegExp("^" + re + "$");
  }

  /* Seeded RNG so sample data is the same for every learner */
  function rng(seed) {
    let s = seed >>> 0;
    const next = () => {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    next.int = (a, b) => a + Math.floor(next() * (b - a + 1));
    next.pick = (arr) => arr[Math.floor(next() * arr.length)];
    return next;
  }

  /* ---------- UI helpers ---------- */
  function toast(msg, kind = "info", ms = 3200) {
    const host = document.getElementById("toasts");
    if (!host) return;
    const el = document.createElement("div");
    el.className = "toast toast-" + kind;
    el.setAttribute("role", "status");
    el.textContent = msg;
    host.appendChild(el);
    setTimeout(() => { el.classList.add("out"); setTimeout(() => el.remove(), 300); }, ms);
  }

  /* modal({title, body (html), actions:[{label, kind, onClick(close, root) -> bool|void}]}) */
  function modal({ title, body, actions = [], wide = false, onMount }) {
    const wrap = document.createElement("div");
    wrap.className = "modal-backdrop";
    wrap.innerHTML = `<div class="modal ${wide ? "modal-wide" : ""}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <div class="modal-head"><h2>${esc(title)}</h2><button class="icon-btn" data-x aria-label="Close">${N.icon("close")}</button></div>
      <div class="modal-body">${body}</div>
      <div class="modal-foot">${actions.map((a, i) => `<button class="btn ${a.kind === "primary" ? "btn-primary" : a.kind === "danger" ? "btn-danger" : ""}" data-i="${i}">${esc(a.label)}</button>`).join("")}</div>
    </div>`;
    const close = () => wrap.remove();
    wrap.addEventListener("click", async (e) => {
      if (e.target === wrap || e.target.closest("[data-x]")) return close();
      const b = e.target.closest("[data-i]");
      if (!b) return;
      const a = actions[+b.dataset.i];
      if (!a.onClick) return close();
      const r = await a.onClick(close, wrap);
      if (r !== false) close();
    });
    wrap.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });
    document.body.appendChild(wrap);
    const first = wrap.querySelector("input, select, textarea, .btn-primary");
    if (first) first.focus();
    if (onMount) onMount(wrap, close);
    return { close, root: wrap };
  }

  function confirmDialog(title, text, okLabel = "Delete", kind = "danger") {
    return new Promise((resolve) => {
      modal({
        title,
        body: `<p>${text}</p>`,
        actions: [
          { label: okLabel, kind, onClick: () => resolve(true) },
          { label: "Cancel", onClick: () => resolve(false) },
        ],
      });
    });
  }

  /* Render a data grid */
  function grid(columns, rows, { max = 500, empty = "No rows." } = {}) {
    if (!columns.length) return `<div class="empty-note">${esc(empty)}</div>`;
    const shown = rows.slice(0, max);
    return `<div class="grid-wrap"><table class="grid"><thead><tr><th class="rn">#</th>${columns.map((c) => `<th>${esc(c)}</th>`).join("")}</tr></thead>
      <tbody>${shown.map((r, i) => `<tr><td class="rn">${i + 1}</td>${columns.map((c, k) => {
        const v = Array.isArray(r) ? r[k] : r[c];
        return v === null || v === undefined ? `<td class="null">NULL</td>` : `<td class="${typeof v === "number" ? "num" : ""}">${esc(v)}</td>`;
      }).join("")}</tr>`).join("")}</tbody></table></div>
      ${rows.length > max ? `<div class="grid-note">Showing first ${max} of ${rows.length} rows.</div>` : ""}`;
  }

  /* Simple bar chart for a result: first text column × first numeric column */
  function barChart(columns, rows) {
    if (!rows.length || columns.length < 2) return `<div class="empty-note">A chart needs at least two columns: a label and a number.</div>`;
    let numIdx = -1, labIdx = -1;
    columns.forEach((c, i) => {
      const v = rows[0][i];
      if (numIdx < 0 && typeof v === "number" && i > 0) numIdx = i;
    });
    labIdx = 0;
    if (numIdx < 0) return `<div class="empty-note">No numeric column found to chart.</div>`;
    const data = rows.slice(0, 40).map((r) => ({ label: String(r[labIdx]), v: Number(r[numIdx]) || 0 }));
    const maxV = Math.max(...data.map((d) => d.v), 0) || 1;
    const W = 720, rowH = 22, labelW = 150, H = data.length * rowH + 30;
    const bars = data.map((d, i) => {
      const w = Math.max(0, (d.v / maxV) * (W - labelW - 90));
      const y = 10 + i * rowH;
      return `<text x="${labelW - 8}" y="${y + 14}" text-anchor="end" class="ch-label">${esc(d.label.length > 20 ? d.label.slice(0, 19) + "…" : d.label)}</text>
        <rect x="${labelW}" y="${y + 3}" width="${w.toFixed(1)}" height="${rowH - 7}" rx="2" class="ch-bar"></rect>
        <text x="${labelW + w + 6}" y="${y + 14}" class="ch-val">${esc(Number.isInteger(d.v) ? d.v.toLocaleString() : d.v.toLocaleString(undefined, { maximumFractionDigits: 2 }))}</text>`;
    }).join("");
    return `<div class="chart-wrap"><div class="chart-cap">${esc(columns[numIdx])} by ${esc(columns[labIdx])}${rows.length > 40 ? " (first 40)" : ""}</div>
      <svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="Bar chart">${bars}</svg></div>`;
  }

  async function downloadText(filename, text, mime = "text/plain") {
    try {
      const dl = window.claude && (await window.claude.use("downloads"));
      if (dl) {
        await dl.save({ filename, data: new Blob([text], { type: mime }) });
        return;
      }
    } catch (e) {
      if (e && e.code) { toast("Download cancelled.", "warn"); return; }
    }
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type: mime }));
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  Object.assign(N, {
    esc, uid, fmtBytes, fmtTime, fmtDur, sleep, parseCSV, toCSV, parseJSONData, toJSONLines,
    inferType, coerce, qid, globToRegex, rng, toast, modal, confirmDialog, grid, barChart, downloadText,
  });
})(window.N);
