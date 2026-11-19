/* Nimbus Portal — SQL dialects.
   T-SQL (Azure SQL Database) and Spark SQL (Databricks) are interpreted on top of SQLite:
   statements are split the way SQL Server splits them, T-SQL constructs are translated,
   SQLite-only syntax is rejected with the error SQL Server would raise, and engine errors
   are reported in SQL Server / Spark format. ADF data flow expressions compile to SQL here too. */
(function (N) {
  /* ======================= lexical helpers ======================= */
  const PH = (k) => "\u0001" + k + "\u0002";
  function mask(sql, { dq = false } = {}) {
    const lits = [];
    let out = "", i = 0;
    while (i < sql.length) {
      const c = sql[i], n = sql[i + 1];
      if (c === "-" && n === "-") { while (i < sql.length && sql[i] !== "\n") i++; continue; }
      if (c === "/" && n === "*") { const e = sql.indexOf("*/", i + 2); const end = e < 0 ? sql.length : e + 2; out += sql.slice(i, end).replace(/[^\n]/g, " "); i = end; continue; }
      const isN = (c === "N" || c === "n") && n === "'" && !/\w/.test(sql[i - 1] || "");
      if (c === "'" || isN || (dq && c === '"')) {
        const q = isN ? "'" : c;
        let j = isN ? i + 2 : i + 1, s = "";
        while (j < sql.length) {
          if (sql[j] === q && sql[j + 1] === q) { s += q; j += 2; continue; }
          if (sql[j] === q) break;
          s += sql[j++];
        }
        if (j >= sql.length) throw sqlErr(105, 15, 1, lineOf(sql, i), `Unclosed quotation mark after the character string '${s.slice(0, 40)}'.`);
        lits.push(s); out += PH(lits.length - 1); i = j + 1; continue;
      }
      out += c; i++;
    }
    return { text: out, lits };
  }
  const lineOf = (s, idx) => s.slice(0, idx).split("\n").length;
  const unmask = (text, lits) => text.replace(/\u0001(\d+)\u0002/g, (m, k) => "'" + lits[+k].replace(/'/g, "''") + "'");
  const litOf = (tok, lits) => { const m = /^\s*\u0001(\d+)\u0002\s*$/.exec(tok || ""); return m ? lits[+m[1]] : null; };
  const addLit = (lits, s) => { lits.push(String(s)); return PH(lits.length - 1); };

  function matchParen(t, open) {
    let d = 0;
    for (let i = open; i < t.length; i++) { if (t[i] === "(") d++; else if (t[i] === ")") { d--; if (!d) return i; } }
    return -1;
  }
  function splitTop(s, sep = ",") {
    const out = []; let d = 0, last = 0;
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (c === "(" || c === "[") d++; else if (c === ")" || c === "]") d--;
      else if (c === sep && d === 0) { out.push(s.slice(last, i)); last = i + 1; }
    }
    out.push(s.slice(last));
    return out;
  }
  /* index of a top-level keyword (word boundary, depth 0) */
  function findTopKw(s, kw, from = 0) {
    const re = new RegExp("\\b" + kw + "\\b", "gi");
    re.lastIndex = from;
    let m;
    while ((m = re.exec(s))) {
      let d = 0;
      for (let i = 0; i < m.index; i++) { if (s[i] === "(") d++; else if (s[i] === ")") d--; }
      if (d === 0) return m.index;
    }
    return -1;
  }
  /* Rewrite NAME(args) calls with balanced parens, innermost first */
  function rewriteCalls(text, name, fn) {
    const re = new RegExp("(^|[^\\w.@#$\\u0002])(" + name + ")\\s*\\(", "gi");
    let out = "", last = 0, m;
    while ((m = re.exec(text))) {
      const start = m.index + m[1].length, open = re.lastIndex - 1;
      const close = matchParen(text, open);
      if (close < 0) break;
      const inner = rewriteCalls(text.slice(open + 1, close), name, fn);
      const repl = fn(splitTop(inner).map((a) => a.trim()), inner, m[2]);
      if (repl == null) { re.lastIndex = open + 1; continue; }
      out += text.slice(last, start) + repl;
      last = close + 1; re.lastIndex = close + 1;
    }
    return out + text.slice(last);
  }

  /* ======================= errors ======================= */
  function sqlErr(num, level, state, line, msg) {
    const e = new Error(`Msg ${num}, Level ${level}, State ${state}, Line ${line}\n${msg}`);
    e.sqlNumber = num; e.sqlText = msg; e.isSql = true;
    return e;
  }
  function translateSqliteError(e, line) {
    if (e.isSql) return e;
    let m = String(e.message || e);
    if (N.__udfErr) { m = N.__udfErr; N.__udfErr = null; }
    let r;
    if ((r = /no such table: (?:main\.|temp\.)?(\S+)/.exec(m))) return sqlErr(208, 16, 1, line, `Invalid object name '${r[1]}'.`);
    if ((r = /no such column: (\S+)/.exec(m))) return sqlErr(207, 16, 1, line, `Invalid column name '${r[1].split(".").pop()}'.`);
    if ((r = /(?:table|view) "?([^"\s]+)"? already exists/.exec(m))) return sqlErr(2714, 16, 6, line, `There is already an object named '${r[1]}' in the database.`);
    if ((r = /UNIQUE constraint failed: (\w+)\.(\w+)/.exec(m))) return sqlErr(2627, 14, 1, line, `Violation of PRIMARY KEY constraint 'PK_${r[1]}'. Cannot insert duplicate key in object 'dbo.${r[1]}'.`);
    if ((r = /NOT NULL constraint failed: (\w+)\.(\w+)/.exec(m))) return sqlErr(515, 16, 2, line, `Cannot insert the value NULL into column '${r[2]}', table 'dbo.${r[1]}'; column does not allow nulls. INSERT fails.`);
    if (/FOREIGN KEY constraint failed/.test(m)) return sqlErr(547, 16, 0, line, `The statement conflicted with a FOREIGN KEY constraint. The conflict occurred in database, table 'dbo'.`);
    if ((r = /near "([^"]*)": syntax error/.exec(m))) return sqlErr(102, 15, 1, line, `Incorrect syntax near '${r[1]}'.`);
    if (/incomplete input/.test(m)) return sqlErr(102, 15, 1, line, `Incorrect syntax near the end of the batch.`);
    if ((r = /no such function: (\w+)/.exec(m))) return sqlErr(195, 15, 10, line, `'${r[1]}' is not a recognized built-in function name.`);
    if ((r = /wrong number of arguments to function (\w+)/.exec(m))) return sqlErr(174, 15, 1, line, `The ${r[1].replace(/^__/, "")} function requires a different number of arguments.`);
    if (/Conversion failed|Error converting|is not allowed|Arithmetic overflow/.test(m)) { const x = /Msg (\d+)[^\n]*\n([\s\S]*)/.exec(m); if (x) return sqlErr(+x[1], 16, 1, line, x[2]); return sqlErr(245, 16, 1, line, m); }
    if ((r = /^Msg (\d+)\|(.*)$/s.exec(m))) return sqlErr(+r[1], 16, 1, line, r[2]);
    return sqlErr(50000, 16, 1, line, m);
  }
  function sparkErr(e) {
    if (e.isSpark) return e;
    let m = String(e.message || e);
    if (N.__udfErr) { m = N.__udfErr; N.__udfErr = null; }
    let r, out;
    if ((r = /no such table: (?:main\.|temp\.)?(\S+)/.exec(m))) out = `[TABLE_OR_VIEW_NOT_FOUND] The table or view \`${r[1]}\` cannot be found. Verify the spelling and correctness of the schema and catalog.`;
    else if ((r = /no such column: (\S+)/.exec(m))) out = `[UNRESOLVED_COLUMN.WITHOUT_SUGGESTION] A column, variable, or function parameter with name \`${r[1]}\` cannot be resolved.`;
    else if ((r = /near "([^"]*)": syntax error/.exec(m))) out = `[PARSE_SYNTAX_ERROR] Syntax error at or near '${r[1]}'.`;
    else if ((r = /no such function: (\w+)/.exec(m))) out = `[UNRESOLVED_ROUTINE] Cannot resolve routine \`${r[1]}\` on search path [\`system\`.\`builtin\`, \`system\`.\`session\`].`;
    else if ((r = /(?:table|view) "?([^"\s]+)"? already exists/.exec(m))) out = `[TABLE_OR_VIEW_ALREADY_EXISTS] Cannot create table or view \`${r[1]}\` because it already exists.`;
    else out = m;
    const x = new Error(out); x.isSpark = true; return x;
  }

  /* ======================= date & conversion helpers (shared UDFs) ======================= */
  const p2 = (n) => String(n).padStart(2, "0");
  const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

  /* Parse a date the way SQL Server does with us_english defaults (style 0 = lenient, 126/127 = ISO only, 103 = dmy, 101 = mdy, 112 = yyyymmdd) */
  function parseDate(v, style) {
    if (v === null || v === undefined) return null;
    if (typeof v === "number") return null;
    const s = String(v).trim();
    let m;
    const mk = (y, mo, d, h = 0, mi = 0, se = 0, ms = 0) => {
      const dt = new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +se, +ms));
      if (dt.getUTCFullYear() !== +y || dt.getUTCMonth() !== +mo - 1 || dt.getUTCDate() !== +d || +h > 23 || +mi > 59 || +se > 59) return null;
      return dt;
    };
    const iso = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,7}))?)?)?\s*(Z|[+-]\d{2}:?\d{2})?$/.exec(s);
    if (iso) {
      if ((style === 126 || style === 127) && iso[4] !== undefined && !/T/.test(s)) return null;
      return mk(iso[1], iso[2], iso[3], iso[4] || 0, iso[5] || 0, iso[6] || 0, iso[7] ? +(iso[7] + "00").slice(0, 3) : 0);
    }
    if (style === 126 || style === 127 || style === 23 || style === 120 || style === 121) return null;
    if ((m = /^(\d{4})(\d{2})(\d{2})$/.exec(s))) return mk(m[1], m[2], m[3]);
    if (style === 112) return null;
    if ((m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(s))) {
      return style === 103 || style === 104 || style === 105 ? mk(m[3], m[2], m[1], m[4] || 0, m[5] || 0, m[6] || 0) : mk(m[3], m[1], m[2], m[4] || 0, m[5] || 0, m[6] || 0);
    }
    if (style) return null;
    if ((m = /^([A-Za-z]{3,9})\s+(\d{1,2}),?\s+(\d{4})$/.exec(s))) { const mo = MONTHS.findIndex((x) => x.toLowerCase().startsWith(m[1].toLowerCase().slice(0, 3))); if (mo >= 0) return mk(m[3], mo + 1, m[2]); }
    return null;
  }
  const fmtDate = (d) => `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())}`;
  const fmtDT = (d) => `${fmtDate(d)} ${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}:${p2(d.getUTCSeconds())}${d.getUTCMilliseconds() ? "." + String(d.getUTCMilliseconds()).padStart(3, "0") : ""}`;
  const isDateOnly = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v));
  const dateOut = (d, likeDateOnly) => (likeDateOnly ? fmtDate(d) : fmtDT(d));

  function normType(t) { return String(t || "").toLowerCase().replace(/\s+/g, "").replace(/^\[|\]$/g, ""); }
  function srcType(v) { return typeof v === "number" ? (Number.isInteger(v) ? "int" : "numeric") : "nvarchar"; }
  function convFail(v, t) {
    const base = t.replace(/\(.*$/, "");
    if (/^(int|bigint|smallint|tinyint|bit)$/.test(base)) return new Error(`Msg 245\nConversion failed when converting the ${srcType(v)} value '${v}' to data type ${base}.`);
    if (/^(decimal|numeric|money|smallmoney)$/.test(base)) return new Error(`Msg 8114\nError converting data type ${srcType(v)} to numeric.`);
    if (/^(float|real)$/.test(base)) return new Error(`Msg 8114\nError converting data type ${srcType(v)} to float.`);
    if (/date|time/.test(base)) return new Error(`Msg 241\nConversion failed when converting date and/or time from character string.`);
    return new Error(`Msg 245\nConversion failed when converting the value '${v}' to data type ${base}.`);
  }
  /* T-SQL CAST/CONVERT semantics. Throws a Msg-formatted Error on failure. */
  function tsqlConvert(v, type, style) {
    if (v === null || v === undefined) return null;
    const t = normType(type), base = t.replace(/\(.*$/, "");
    const args = (/\(([^)]*)\)/.exec(t) || [])[1];
    const s = typeof v === "string" ? v.trim() : v;
    if (/^(int|bigint|smallint|tinyint)$/.test(base)) {
      if (typeof v === "number") return Math.trunc(v);
      if (/^[+-]?\d+$/.test(s)) return parseInt(s, 10);
      throw convFail(v, t);
    }
    if (base === "bit") {
      if (typeof v === "number") return v ? 1 : 0;
      if (/^(1|true)$/i.test(s)) return 1; if (/^(0|false)$/i.test(s)) return 0;
      throw convFail(v, t);
    }
    if (/^(decimal|numeric|money|smallmoney)$/.test(base)) {
      const scale = base.includes("money") ? 4 : args ? +(args.split(",")[1] || 0) : 0;
      const n = typeof v === "number" ? v : /^[+-]?(\d+\.?\d*|\.\d+)$/.test(s) ? parseFloat(s) : NaN;
      if (isNaN(n)) throw convFail(v, t);
      const prec = args ? +args.split(",")[0] : 18;
      const r = Math.round((n + Number.EPSILON * Math.sign(n)) * 10 ** scale) / 10 ** scale;
      if (Math.abs(Math.trunc(r)).toString().length > prec - scale) throw new Error(`Msg 8115\nArithmetic overflow error converting ${srcType(v)} to data type numeric.`);
      return r;
    }
    if (/^(float|real)$/.test(base)) {
      const n = typeof v === "number" ? v : /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(s) ? parseFloat(s) : NaN;
      if (isNaN(n)) throw convFail(v, t);
      return n;
    }
    if (/^(date|datetime|datetime2|smalldatetime|datetimeoffset)$/.test(base)) {
      if (typeof v === "number") throw new Error(`Msg 529\nExplicit conversion from data type int to ${base} is not allowed.`);
      const d = parseDate(s, style ? +style : 0);
      if (!d) throw convFail(v, t);
      return base === "date" ? fmtDate(d) : fmtDT(d);
    }
    if (/^(n?varchar|n?char|sysname|text|ntext|uniqueidentifier)$/.test(base)) {
      let out;
      if (style && typeof v === "string" && parseDate(v) && /^\d{4}-\d{2}-\d{2}/.test(v)) {
        const d = parseDate(v), st = +style;
        out = { 23: fmtDate(d), 112: fmtDate(d).replace(/-/g, ""), 103: `${p2(d.getUTCDate())}/${p2(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`, 101: `${p2(d.getUTCMonth() + 1)}/${p2(d.getUTCDate())}/${d.getUTCFullYear()}`, 120: fmtDT(d).slice(0, 19), 121: fmtDT(d), 126: fmtDT(d).replace(" ", "T"), 127: fmtDT(d).replace(" ", "T") + "Z" }[st] ?? String(v);
      } else out = typeof v === "number" ? String(v) : String(v);
      const len = args && args !== "max" ? +args : base === "uniqueidentifier" || base === "text" || base === "ntext" ? Infinity : args === "max" ? Infinity : 30;
      return out.length > len ? out.slice(0, len) : out;
    }
    return v;
  }

  const DP = { year: "y", yy: "y", yyyy: "y", quarter: "q", qq: "q", q: "q", month: "m", mm: "m", m: "m", dayofyear: "dy", dy: "dy", y: "dy", day: "d", dd: "d", d: "d", week: "wk", wk: "wk", ww: "wk", weekday: "dw", dw: "dw", w: "dw", hour: "h", hh: "h", minute: "mi", mi: "mi", n: "mi", second: "s", ss: "s", s: "s", millisecond: "ms", ms: "ms", iso_week: "isowk", isowk: "isowk", isoww: "isowk" };
  const part = (p) => { const k = DP[String(p).toLowerCase().replace(/['"\s]/g, "")]; if (!k) throw new Error(`Msg 155\n'${p}' is not a recognized datepart option.`); return k; };
  const toD = (v) => { const d = v instanceof Date ? v : parseDate(v); if (!d) throw convFail(v, "datetime2"); return d; };
  function dateadd(p, n, v) {
    if (v === null || n === null) return null;
    const d = new Date(toD(v).getTime()); n = Math.trunc(Number(n));
    switch (part(p)) {
      case "y": d.setUTCFullYear(d.getUTCFullYear() + n); break;
      case "q": d.setUTCMonth(d.getUTCMonth() + 3 * n); break;
      case "m": { const day = d.getUTCDate(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + n); const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate(); d.setUTCDate(Math.min(day, last)); break; }
      case "dy": case "d": case "dw": d.setUTCDate(d.getUTCDate() + n); break;
      case "wk": d.setUTCDate(d.getUTCDate() + 7 * n); break;
      case "h": d.setUTCHours(d.getUTCHours() + n); break;
      case "mi": d.setUTCMinutes(d.getUTCMinutes() + n); break;
      case "s": d.setUTCSeconds(d.getUTCSeconds() + n); break;
      case "ms": d.setUTCMilliseconds(d.getUTCMilliseconds() + n); break;
    }
    return dateOut(d, isDateOnly(v));
  }
  const dayNum = (d) => Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / 86400000);
  function datediff(p, a, b) {
    if (a === null || b === null) return null;
    const x = toD(a), y = toD(b);
    switch (part(p)) {
      case "y": return y.getUTCFullYear() - x.getUTCFullYear();
      case "q": return (y.getUTCFullYear() * 4 + Math.floor(y.getUTCMonth() / 3)) - (x.getUTCFullYear() * 4 + Math.floor(x.getUTCMonth() / 3));
      case "m": return (y.getUTCFullYear() * 12 + y.getUTCMonth()) - (x.getUTCFullYear() * 12 + x.getUTCMonth());
      case "d": case "dy": case "dw": return dayNum(y) - dayNum(x);
      case "wk": return Math.floor((dayNum(y) + 4) / 7) - Math.floor((dayNum(x) + 4) / 7);
      case "h": return Math.floor(y / 3600000) - Math.floor(x / 3600000);
      case "mi": return Math.floor(y / 60000) - Math.floor(x / 60000);
      case "s": return Math.floor(y / 1000) - Math.floor(x / 1000);
      case "ms": return y - x;
    }
    return null;
  }
  function isoWeek(d) { const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())); const day = t.getUTCDay() || 7; t.setUTCDate(t.getUTCDate() + 4 - day); const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1)); return Math.ceil(((t - y0) / 86400000 + 1) / 7); }
  function datepart(p, v) {
    if (v === null) return null;
    const d = toD(v);
    switch (part(p)) {
      case "y": return d.getUTCFullYear(); case "q": return Math.floor(d.getUTCMonth() / 3) + 1; case "m": return d.getUTCMonth() + 1;
      case "dy": return dayNum(d) - dayNum(new Date(Date.UTC(d.getUTCFullYear(), 0, 1))) + 1;
      case "d": return d.getUTCDate();
      case "wk": { const j1 = new Date(Date.UTC(d.getUTCFullYear(), 0, 1)); return Math.floor((dayNum(d) - dayNum(j1) + j1.getUTCDay()) / 7) + 1; }
      case "dw": return d.getUTCDay() + 1;
      case "h": return d.getUTCHours(); case "mi": return d.getUTCMinutes(); case "s": return d.getUTCSeconds(); case "ms": return d.getUTCMilliseconds();
      case "isowk": return isoWeek(d);
    }
    return null;
  }
  function datename(p, v) {
    if (v === null) return null;
    const k = part(p), d = toD(v);
    if (k === "m") return MONTHS[d.getUTCMonth()];
    if (k === "dw") return DAYS[d.getUTCDay()];
    return String(datepart(p, v));
  }
  /* .NET-style FORMAT for dates and numbers */
  function netFormat(v, f) {
    if (v === null) return null;
    f = String(f);
    if (typeof v === "number") {
      const m = /^([NFP])(\d*)$/i.exec(f);
      if (m) { const dp = m[2] === "" ? 2 : +m[2]; if (m[1].toUpperCase() === "P") return (v * 100).toFixed(dp) + " %"; return m[1].toUpperCase() === "N" ? v.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp }) : v.toFixed(dp); }
      const z = /^[#,0]*\.?(0*)$/.exec(f); if (z) return v.toLocaleString("en-US", { minimumFractionDigits: z[1].length, maximumFractionDigits: z[1].length, useGrouping: f.includes(",") });
      return String(v);
    }
    const d = parseDate(v); if (!d) return null;
    return f.replace(/yyyy|yy|MMMM|MMM|MM|M|dddd|ddd|dd|d|HH|H|hh|mm|ss|tt/g, (t) => ({
      yyyy: d.getUTCFullYear(), yy: String(d.getUTCFullYear()).slice(2), MMMM: MONTHS[d.getUTCMonth()], MMM: MONTHS[d.getUTCMonth()].slice(0, 3), MM: p2(d.getUTCMonth() + 1), M: d.getUTCMonth() + 1,
      dddd: DAYS[d.getUTCDay()], ddd: DAYS[d.getUTCDay()].slice(0, 3), dd: p2(d.getUTCDate()), d: d.getUTCDate(), HH: p2(d.getUTCHours()), H: d.getUTCHours(), hh: p2(d.getUTCHours() % 12 || 12), mm: p2(d.getUTCMinutes()), ss: p2(d.getUTCSeconds()), tt: d.getUTCHours() < 12 ? "AM" : "PM",
    })[t]);
  }
  /* Spark / Java datetime pattern formatting & parsing */
  function javaFormat(v, f) {
    const d = parseDate(v); if (!d) return null;
    return String(f || "yyyy-MM-dd").replace(/yyyy|yy|MMMM|MMM|MM|M|EEEE|EEE|E|dd|d|HH|H|mm|ss|SSS/g, (t) => ({
      yyyy: d.getUTCFullYear(), yy: String(d.getUTCFullYear()).slice(2), MMMM: MONTHS[d.getUTCMonth()], MMM: MONTHS[d.getUTCMonth()].slice(0, 3), MM: p2(d.getUTCMonth() + 1), M: d.getUTCMonth() + 1,
      EEEE: DAYS[d.getUTCDay()], EEE: DAYS[d.getUTCDay()].slice(0, 3), E: DAYS[d.getUTCDay()].slice(0, 3), dd: p2(d.getUTCDate()), d: d.getUTCDate(), HH: p2(d.getUTCHours()), H: d.getUTCHours(), mm: p2(d.getUTCMinutes()), ss: p2(d.getUTCSeconds()), SSS: String(d.getUTCMilliseconds()).padStart(3, "0"),
    })[t]);
  }
  function javaParse(v, f) {
    if (v === null || v === undefined) return null;
    if (!f) return parseDate(String(v).replace(" ", "T").replace(/T(\d{2}:\d{2})$/, "T$1:00"));
    const s = String(v).trim();
    const re = String(f).replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/yyyy|MM|dd|HH|mm|ss|M|d|H/g, (t) => `(?<${t[0] === "M" ? "M" : t[0] === "d" ? "d" : t[0] === "H" ? "H" : t}>\\d{${t.length === 1 ? "1,2" : t.length}})`);
    const m = new RegExp("^" + re + "$").exec(s);
    if (!m) return null;
    const g = m.groups;
    const d = new Date(Date.UTC(+g.yyyy, (+g.M || 1) - 1, +g.d || 1, +(g.H || 0), +(g.mm || 0), +(g.ss || 0)));
    return isNaN(d) ? null : d;
  }

  /* ======================= UDF registration ======================= */
  function reg(db, name, fn, arities) {
    const f2 = (...a) => { try { return fn(...a); } catch (e) { N.__udfErr = e.message; throw e; } };
    const makers = [() => f2(), (a) => f2(a), (a, b) => f2(a, b), (a, b, c) => f2(a, b, c), (a, b, c, d) => f2(a, b, c, d)];
    for (const n of arities) db.create_function(name, makers[n]);
  }
  N.registerSqlFunctions = (db) => {
    /* sql.js export() closes and reopens the connection, dropping custom functions and temp views: re-check every time */
    try { db.exec("SELECT __now()"); ensureCatalogViews(db); return; } catch (e) {}
    const safe = (f) => (...a) => { try { return f(...a); } catch (e) { throw e; } };
    reg(db, "__cast", safe((v, t) => tsqlConvert(v, t)), [2]);
    reg(db, "__try_cast", (v, t) => { try { return tsqlConvert(v, t); } catch (e) { return null; } }, [2]);
    reg(db, "__convert", (t, v, st) => tsqlConvert(v, t, st), [2, 3]);
    reg(db, "__try_convert", (t, v, st) => { try { return tsqlConvert(v, t, st); } catch (e) { return null; } }, [2, 3]);
    /* SQL Server rounds exact decimals half away from zero; doubles must be de-noised first (29.325 → 29.33, not 29.32) */
    const sqlRound = (x, n, trunc) => { if (x === null || x === undefined) return null; x = Number(x); n = Number(n) || 0; const f = Math.pow(10, n); const scaled = Number((Math.abs(x) * f).toPrecision(15)); const r = trunc ? Math.trunc(scaled) : Math.round(scaled); return (Math.sign(x) * r) / f; };
    reg(db, "round", sqlRound, [1, 2, 3]);
    reg(db, "__dateadd", dateadd, [3]);
    reg(db, "__datediff", datediff, [3]);
    reg(db, "__datepart", datepart, [2]);
    reg(db, "__datename", datename, [2]);
    reg(db, "year", (v) => (v === null ? null : toD(v).getUTCFullYear()), [1]);
    reg(db, "month", (v) => (v === null ? null : toD(v).getUTCMonth() + 1), [1]);
    reg(db, "day", (v) => (v === null ? null : toD(v).getUTCDate()), [1]);
    reg(db, "eomonth", (v, n) => { if (v === null) return null; const d = toD(v); return fmtDate(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1 + (Number(n) || 0), 0))); }, [1, 2]);
    reg(db, "datefromparts", (y, m, d) => (y === null || m === null || d === null ? null : fmtDate(new Date(Date.UTC(y, m - 1, d)))), [3]);
    reg(db, "format", netFormat, [2, 3]);
    reg(db, "__charindex", (sub, s, st) => (sub === null || s === null ? null : String(s).indexOf(String(sub), Math.max(0, (Number(st) || 1) - 1)) + 1), [2, 3]);
    reg(db, "__left", (s, n) => (s === null ? null : String(s).slice(0, Math.max(0, n))), [2]);
    reg(db, "__right", (s, n) => (s === null ? null : n <= 0 ? "" : String(s).slice(-n)), [2]);
    reg(db, "replicate", (s, n) => (s === null ? null : String(s).repeat(Math.max(0, n))), [2]);
    reg(db, "reverse", (s) => (s === null ? null : String(s).split("").reverse().join("")), [1]);
    reg(db, "space", (n) => " ".repeat(Math.max(0, n)), [1]);
    reg(db, "isnumeric", (v) => (v === null ? 0 : typeof v === "number" || /^\s*[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?\s*$/.test(String(v)) ? 1 : 0), [1]);
    reg(db, "ceiling", (v) => (v === null ? null : Math.ceil(v)), [1]);
    reg(db, "ceil", (v) => (v === null ? null : Math.ceil(v)), [1]);
    reg(db, "floor", (v) => (v === null ? null : Math.floor(v)), [1]);
    reg(db, "power", (a, b) => (a === null || b === null ? null : Math.pow(a, b)), [2]);
    reg(db, "pow", (a, b) => (a === null || b === null ? null : Math.pow(a, b)), [2]);
    reg(db, "sqrt", (v) => (v === null ? null : Math.sqrt(v)), [1]);
    reg(db, "square", (v) => (v === null ? null : v * v), [1]);
    reg(db, "log", (v, b) => (v === null ? null : b ? Math.log(v) / Math.log(b) : Math.log(v)), [1, 2]);
    reg(db, "log10", (v) => (v === null ? null : Math.log10(v)), [1]);
    reg(db, "exp", (v) => (v === null ? null : Math.exp(v)), [1]);
    reg(db, "sign", (v) => (v === null ? null : Math.sign(v)), [1]);
    reg(db, "pi", () => Math.PI, [0]);
    reg(db, "__newid", () => (crypto.randomUUID ? crypto.randomUUID() : N.uid()).toUpperCase(), [0]);
    reg(db, "__now", () => fmtDT(new Date()), [0]);
    reg(db, "__curdate", () => fmtDate(new Date()), [0]);
    /* Spark */
    reg(db, "__s_to_date", (v, f) => { const d = javaParse(v, f); return d ? fmtDate(d) : null; }, [1, 2]);
    reg(db, "__s_to_ts", (v, f) => { const d = javaParse(v, f); return d ? fmtDT(d) : null; }, [1, 2]);
    reg(db, "date_format", (v, f) => javaFormat(v, f), [2]);
    reg(db, "__s_datediff", (e, s) => (e === null || s === null ? null : dayNum(toD(e)) - dayNum(toD(s))), [2]);
    reg(db, "date_add", (d, n) => (d === null ? null : dateadd("day", n, String(d).slice(0, 10))), [2]);
    reg(db, "date_sub", (d, n) => (d === null ? null : dateadd("day", -n, String(d).slice(0, 10))), [2]);
    reg(db, "add_months", (d, n) => (d === null ? null : dateadd("month", n, String(d).slice(0, 10))), [2]);
    reg(db, "dayofmonth", (v) => (v === null ? null : toD(v).getUTCDate()), [1]);
    reg(db, "dayofweek", (v) => (v === null ? null : toD(v).getUTCDay() + 1), [1]);
    reg(db, "weekofyear", (v) => (v === null ? null : isoWeek(toD(v))), [1]);
    reg(db, "hour", (v) => (v === null ? null : toD(v).getUTCHours()), [1]);
    reg(db, "minute", (v) => (v === null ? null : toD(v).getUTCMinutes()), [1]);
    reg(db, "date_trunc", (u, v) => { if (v === null) return null; const d = toD(v); u = String(u).toLowerCase(); const t = new Date(Date.UTC(d.getUTCFullYear(), u === "year" ? 0 : u === "quarter" ? Math.floor(d.getUTCMonth() / 3) * 3 : d.getUTCMonth(), ["year", "quarter", "month"].includes(u) ? 1 : d.getUTCDate(), ["hour", "minute"].includes(u) ? d.getUTCHours() : 0, u === "minute" ? d.getUTCMinutes() : 0)); if (u === "week") t.setUTCDate(t.getUTCDate() - ((t.getUTCDay() + 6) % 7)); return fmtDT(t); }, [2]);
    reg(db, "__startswith", (s, p) => (s === null || p === null ? null : String(s).startsWith(String(p)) ? 1 : 0), [2]);
    reg(db, "__endswith", (s, p) => (s === null || p === null ? null : String(s).endsWith(String(p)) ? 1 : 0), [2]);
    try { db.run("PRAGMA foreign_keys = ON"); } catch (e) {}
    ensureCatalogViews(db);
  };
  function ensureCatalogViews(db) {
    try {
      db.run(`CREATE TEMP VIEW IF NOT EXISTS __is_tables AS SELECT 'nimbus' AS TABLE_CATALOG, 'dbo' AS TABLE_SCHEMA, name AS TABLE_NAME, CASE type WHEN 'table' THEN 'BASE TABLE' ELSE 'VIEW' END AS TABLE_TYPE FROM main.sqlite_master WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '\\_\\_%' ESCAPE '\\'`);
      db.run(`CREATE TEMP VIEW IF NOT EXISTS __is_columns AS SELECT 'nimbus' AS TABLE_CATALOG, 'dbo' AS TABLE_SCHEMA, m.name AS TABLE_NAME, p.name AS COLUMN_NAME, p.cid + 1 AS ORDINAL_POSITION, CASE WHEN p."notnull" THEN 'NO' ELSE 'YES' END AS IS_NULLABLE, lower(p.type) AS DATA_TYPE FROM main.sqlite_master m JOIN pragma_table_info(m.name) p WHERE m.type IN ('table','view') AND m.name NOT LIKE 'sqlite_%' AND m.name NOT LIKE '\\_\\_%' ESCAPE '\\'`);
      db.run(`CREATE TEMP VIEW IF NOT EXISTS __sys_tables AS SELECT name, rowid AS object_id, 'U' AS type, 'USER_TABLE' AS type_desc FROM main.sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '\\_\\_%' ESCAPE '\\'`);
      db.run(`CREATE TEMP VIEW IF NOT EXISTS __sys_views AS SELECT name, rowid AS object_id, 'V' AS type FROM main.sqlite_master WHERE type = 'view'`);
    } catch (e) {}
  }

  /* ======================= T-SQL: statement splitting ======================= */
  const STARTERS = new Set(["SELECT", "INSERT", "UPDATE", "DELETE", "MERGE", "CREATE", "DROP", "ALTER", "TRUNCATE", "DECLARE", "SET", "EXEC", "EXECUTE", "PRINT", "THROW", "RAISERROR", "USE", "RETURN", "IF", "ELSE", "WHILE", "BEGIN", "END", "COMMIT", "ROLLBACK", "WITH", "GRANT", "DENY", "REVOKE", "BREAK", "CONTINUE"]);
  function splitUnits(text) {
    const units = [];
    let cur = null, depth = 0, caseDepth = 0, prev = "", prev2 = "";
    const start = (i) => { cur = { start: i, first: "", sawSet: false, sawMain: false, sawBody: false, words: 0 }; };
    const end = (i, semi) => { if (cur) { const t = text.slice(cur.start, i); if (t.trim()) units.push({ text: t, line: lineOf(text, cur.start + t.search(/\S/)), semi: !!semi, first: cur.first }); } cur = null; };
    const re = /[A-Za-z_@#][\w@#$]*|\(|\)|;|\S/g;
    let m;
    while ((m = re.exec(text))) {
      const tok = m[0], i = m.index;
      if (tok === "(") { if (!cur) start(i); depth++; prev2 = prev; prev = tok; continue; }
      if (tok === ")") { depth--; prev2 = prev; prev = tok; continue; }
      if (tok === ";" && depth === 0) { end(i, true); caseDepth = 0; prev = ";"; continue; }
      if (!/^[A-Za-z_@#]/.test(tok)) { if (!cur) start(i); prev2 = prev; prev = tok; continue; }
      const W = tok.toUpperCase();
      if (depth > 0 || !cur) {
        if (!cur) { start(i); cur.first = W; }
        prev2 = prev; prev = W; continue;
      }
      if (W === "VALUES" && (cur.first === "INSERT" || cur.insertMode)) cur.sawBody = true;
      if (W === "CASE") { caseDepth++; prev2 = prev; prev = W; continue; }
      if (W === "END" && caseDepth > 0) { caseDepth--; prev2 = prev; prev = W; continue; }
      if (caseDepth > 0 || !STARTERS.has(W)) { prev2 = prev; prev = W; continue; }
      const F = cur.first;
      let split = true;
      if (F === "MERGE" && !["CREATE", "DROP", "DECLARE", "IF", "PRINT", "EXEC", "EXECUTE"].includes(W)) split = false;
      else if (W === "IF" && ["TABLE", "VIEW", "PROCEDURE", "PROC", "USER", "FUNCTION", "INDEX", "SCHEMA", "TRIGGER", "DATABASE", "COLUMN", "CONSTRAINT", "DROP"].includes(prev)) split = false;
      else if (W === "SELECT") {
        if (["UNION", "ALL", "EXCEPT", "INTERSECT", "AS", "FOR"].includes(prev)) split = false;
        else if ((F === "INSERT" || cur.insertMode) && !cur.sawBody) { split = false; cur.sawBody = true; }
        else if (F === "WITH" && !cur.sawMain) { split = false; cur.sawMain = true; }
      } else if (W === "SET") {
        if (F === "UPDATE" && !cur.sawSet) { split = false; cur.sawSet = true; }
        else if (F === "WITH" && !cur.sawSet) { split = false; cur.sawSet = true; }
        else if (prev === "ON" || prev === "DELETE" || prev === "UPDATE") split = false;
      } else if (W === "INSERT" || W === "UPDATE" || W === "DELETE") {
        if (F === "WITH" && !cur.sawMain) { split = false; cur.sawMain = true; if (W === "INSERT") cur.insertMode = true; if (W === "UPDATE") cur.sawSet = false; }
        else if (["ON", "FOR", "INSTEAD", "AFTER", "OF", "THEN"].includes(prev)) split = false;
      } else if (W === "MERGE") { if (F === "WITH" && !cur.sawMain) { split = false; cur.sawMain = true; } }
      else if (W === "WITH") { split = /^WITH\s+[\w\[\]"]+\s*(\([^)]*\))?\s*AS\s*\(/i.test(text.slice(i)); }
      else if (W === "ALTER" && prev === "OR") split = false;
      else if ((W === "DROP" || W === "ADD") && F === "ALTER") split = false;
      else if (W === "SET" && F === "ALTER") split = false;
      else if (W === "EXEC" && F === "INSERT") split = false;
      else if ((W === "EXEC" || W === "EXECUTE") && ["GRANT", "DENY", "REVOKE"].includes(prev)) split = false;
      else if ((W === "BEGIN" || W === "COMMIT" || W === "ROLLBACK") && F === "BEGIN" && cur.words <= 1 && W !== "BEGIN") split = true;
      if (split) { end(i); start(i); cur.first = W; } else cur.words++;
      prev2 = prev; prev = W;
    }
    end(text.length);
    return units;
  }
  /* Build a statement tree with IF/ELSE, WHILE, BEGIN…END and TRY…CATCH */
  function parseTree(units) {
    let p = 0;
    const head = (u) => u.text.trim().toUpperCase();
    function stmt() {
      const u = units[p];
      if (!u) return null;
      const h = head(u);
      if (/^IF\b/.test(h)) {
        p++;
        const node = { type: "if", cond: u.text.trim().replace(/^IF\s+/i, ""), line: u.line, then: stmt(), else: null };
        if (units[p] && /^ELSE$/.test(head(units[p]))) { p++; node.else = stmt(); }
        return node;
      }
      if (/^WHILE\b/.test(h)) { p++; return { type: "while", cond: u.text.trim().replace(/^WHILE\s+/i, ""), line: u.line, body: stmt() }; }
      if (/^BEGIN\s+TRY$/.test(h)) {
        p++; const tryB = block(/^END\s+TRY$/);
        if (!units[p] || !/^BEGIN\s+CATCH$/.test(head(units[p]))) throw sqlErr(102, 15, 1, u.line, "Incorrect syntax near 'END TRY'. A BEGIN CATCH block must follow.");
        p++; const catchB = block(/^END\s+CATCH$/);
        return { type: "try", tryB, catchB, line: u.line };
      }
      if (/^BEGIN$/.test(h)) { p++; return { type: "block", body: block(/^END$/), line: u.line }; }
      if (/^(END|ELSE|END\s+TRY|END\s+CATCH|BEGIN\s+CATCH)$/.test(h)) throw sqlErr(156, 15, 1, u.line, `Incorrect syntax near the keyword '${h.split(/\s+/)[0]}'.`);
      p++;
      return { type: "stmt", text: u.text, line: u.line, semi: u.semi };
    }
    function block(endRe) {
      const out = [];
      while (p < units.length && !endRe.test(head(units[p]))) out.push(stmt());
      if (p >= units.length) throw sqlErr(102, 15, 1, units[units.length - 1].line, "Incorrect syntax near the end of the batch. Missing END.");
      p++;
      return out;
    }
    const out = [];
    while (p < units.length) out.push(stmt());
    return out;
  }

  /* ======================= T-SQL: translation ======================= */
  const SQLITE_ONLY_FNS = ["IFNULL", "SUBSTR", "INSTR", "STRFTIME", "JULIANDAY", "DATETIME", "DATE", "GROUP_CONCAT", "PRINTF", "RANDOM", "TYPEOF", "TOTAL", "UNIXEPOCH", "JSON_GROUP_ARRAY"];
  function strictCheck(t, line, lits) {
    let m;
    if ((m = /\b(read_csv|read_json|read_files|read_table|read_lake)\s*\(/i.exec(t))) throw sqlErr(195, 15, 10, line, `'${m[1]}' is not a recognized built-in function name.\n(Nimbus: lake helpers do not exist in Azure SQL Database. Load files with an ADF Copy activity, or switch Realism to Guided in Settings.)`);
    if ((m = /\b(LIMIT)\b/i.exec(t))) throw sqlErr(102, 15, 1, line, `Incorrect syntax near 'LIMIT'.\n(Nimbus: T-SQL uses SELECT TOP (n) … or ORDER BY … OFFSET 0 ROWS FETCH NEXT n ROWS ONLY.)`);
    if (/\bAUTOINCREMENT\b/i.test(t)) throw sqlErr(102, 15, 1, line, `Incorrect syntax near 'AUTOINCREMENT'.\n(Nimbus: T-SQL uses INT IDENTITY(1,1).)`);
    if (/\bWITH\s+RECURSIVE\b/i.test(t)) throw sqlErr(102, 15, 1, line, `Incorrect syntax near 'RECURSIVE'.\n(Nimbus: T-SQL CTEs are recursive without a keyword.)`);
    if (/\bCREATE\s+(TEMP\s+|TEMPORARY\s+)?TABLE\s+[\w\[\]."]+\s+AS\s*(\(?\s*SELECT|WITH)\b/i.test(t)) throw sqlErr(156, 15, 1, line, `Incorrect syntax near the keyword 'AS'.\n(Nimbus: Azure SQL Database has no CREATE TABLE AS SELECT. Use SELECT … INTO new_table FROM …)`);
    if (/\bINSERT\s+OR\b/i.test(t)) throw sqlErr(156, 15, 1, line, `Incorrect syntax near the keyword 'OR'.`);
    if (/\bON\s+CONFLICT\b/i.test(t)) throw sqlErr(102, 15, 1, line, `Incorrect syntax near 'CONFLICT'.\n(Nimbus: use MERGE for upserts.)`);
    if (/\bRETURNING\b/i.test(t)) throw sqlErr(102, 15, 1, line, `Incorrect syntax near 'RETURNING'.`);
    if (/\bPRAGMA\b/i.test(t)) throw sqlErr(102, 15, 1, line, `Incorrect syntax near 'PRAGMA'.\n(Nimbus: query INFORMATION_SCHEMA.COLUMNS or sys.tables.)`);
    if (/\bsqlite_\w+/i.test(t)) throw sqlErr(208, 16, 1, line, `Invalid object name '${/\bsqlite_\w+/i.exec(t)[0]}'.\n(Nimbus: use INFORMATION_SCHEMA.TABLES.)`);
    if (/::\s*[a-z]/i.test(t)) throw sqlErr(102, 15, 1, line, `Incorrect syntax near ':'.`);
    if ((m = /\b(TRUE|FALSE)\b/i.exec(t)) && !/\bSET\s+\w+\s+(ON|OFF)\b/i.test(t)) throw sqlErr(207, 16, 1, line, `Invalid column name '${m[1]}'.\n(Nimbus: T-SQL has no boolean literals; use 1 and 0 with BIT.)`);
    for (const f of SQLITE_ONLY_FNS) { const r = new RegExp("(^|[^\\w.@])" + f + "\\s*\\(", "i"); if (r.test(t)) throw sqlErr(195, 15, 10, line, `'${f.toLowerCase()}' is not a recognized built-in function name.`); }
  }

  function translateTsql(t, ctx) {
    const { lits, db } = ctx;
    t = t.replace(/\[dbo\]\s*\.\s*/gi, "").replace(/\bdbo\s*\.\s*/gi, "");
    t = t.replace(/\bOPTION\s*\([^)]*\)/gi, "");
    t = t.replace(/^\s*CREATE\s+TABLE\s+#/i, "CREATE TEMP TABLE #").replace(/#(\w+)/g, "tmp_$1");
    t = t.replace(/\bWITH\s*\(\s*(NOLOCK|READUNCOMMITTED|TABLOCK|HOLDLOCK|UPDLOCK|ROWLOCK)\s*\)/gi, "");
    t = t.replace(/\bINFORMATION_SCHEMA\s*\.\s*TABLES\b/gi, "temp.__is_tables").replace(/\bINFORMATION_SCHEMA\s*\.\s*COLUMNS\b/gi, "temp.__is_columns").replace(/\bsys\s*\.\s*tables\b/gi, "temp.__sys_tables").replace(/\bsys\s*\.\s*views\b/gi, "temp.__sys_views");
    t = rewriteCalls(t, "OBJECT_ID", (a) => {
      const name = (litOf(a[0], lits) || "").replace(/^\[?dbo\]?\./i, "").replace(/[\[\]]/g, "");
      const type = (litOf(a[1], lits) || "").toUpperCase();
      const r = db.exec(`SELECT rowid, type FROM main.sqlite_master WHERE lower(name) = lower(${sq(name)}) AND type IN ('table','view')`);
      if (!r.length) return "NULL";
      const [id, ty] = r[0].values[0];
      if (type && ((type === "U" && ty !== "table") || (type === "V" && ty !== "view"))) return "NULL";
      return String(id);
    });
    // IF OBJECT_ID handled by IF node; plain DROP … IF EXISTS is native.
    t = t.replace(/^\s*TRUNCATE\s+TABLE\s+/i, "DELETE FROM ");
    t = t.replace(/\b(N?VARCHAR|VARBINARY)\s*\(\s*MAX\s*\)/gi, "$1");
    t = t.replace(/\s+(NON)?CLUSTERED\b/gi, "");
    t = t.replace(/\bDEFAULT\s*\(?\s*(GETDATE|GETUTCDATE|SYSDATETIME|SYSUTCDATETIME|CURRENT_TIMESTAMP)\s*(\(\s*\))?\s*\)?/gi, "DEFAULT CURRENT_TIMESTAMP");
    if (/^\s*CREATE\s+TABLE\b/i.test(t) && /\bIDENTITY\b/i.test(t)) {
      const col = /([\w\[\]"]+)\s+(?:BIG|SMALL|TINY)?INT\s+(?:NOT\s+NULL\s+)?IDENTITY\s*(?:\(\s*\d+\s*,\s*\d+\s*\))?/i.exec(t);
      if (col) {
        t = t.replace(col[0], `${col[1]} INTEGER PRIMARY KEY`).replace(new RegExp(`(${col[1].replace(/[\[\]]/g, "\\$&")}\\s+INTEGER PRIMARY KEY)((?:\\s+(?:NOT\\s+NULL|NULL|PRIMARY\\s+KEY))*)`, "i"), "$1");
        const bare = col[1].replace(/[\[\]"]/g, "");
        t = t.replace(new RegExp(`,\\s*(?:CONSTRAINT\\s+[\\w\\[\\]]+\\s+)?PRIMARY\\s+KEY\\s*\\(\\s*\\[?${bare}\\]?\\s*\\)`, "i"), "");
      }
    }
    let m;
    if ((m = /^\s*ALTER\s+TABLE\s+([\w\[\]"]+)\s+ADD\s+(?!CONSTRAINT\b|PRIMARY\b|FOREIGN\b)(?:COLUMN\s+)?([\s\S]+)$/i.exec(t))) {
      const cols = splitTop(m[2]);
      return cols.map((c) => `ALTER TABLE ${m[1]} ADD COLUMN ${c.trim()}`);
    }
    if (/^\s*ALTER\s+TABLE\b[\s\S]*\b(ALTER\s+COLUMN|ADD\s+CONSTRAINT|ADD\s+PRIMARY|ADD\s+FOREIGN)\b/i.test(t)) throw sqlErr(50000, 16, 1, ctx.line, "The Nimbus engine cannot ALTER COLUMN or add constraints to an existing table. Azure SQL can. In the sandbox, recreate the table with the new definition.");
    // SELECT … INTO new_table FROM single_table: keep exact source column types, like SQL Server
    const pre = [];
    if ((m = /^\s*SELECT\s+((?:DISTINCT\s+)?(?:TOP\s*\(?\s*\d+\s*\)?\s+)?)([\s\S]+?)\s+INTO\s+([#\w\[\]".]+)\s+FROM\s+([\w\[\]"]+)(?:\s+(?:AS\s+)?(?!WHERE\b|ORDER\b|GROUP\b|JOIN\b|INNER\b|LEFT\b|CROSS\b|OPTION\b)(\w+))?(\s+(?:WHERE|ORDER\s+BY)\b[\s\S]*)?\s*$/i.exec(t)) && !/\b(JOIN|GROUP\s+BY|UNION)\b/i.test(m[6] || "")) {
      const src = m[4].replace(/[\[\]"]/g, ""), target = m[3];
      let info = [];
      try { const r = db.exec(`PRAGMA table_info(${N.qid(src)})`); info = r.length ? r[0].values.map((v) => ({ name: v[1], type: v[2], notnull: !!v[3] })) : []; } catch (e) {}
      const items = splitTop(m[2]).map((x) => x.trim());
      let defs = [];
      if (info.length) for (const it of items) {
        if (it === "*" || /^\w+\.\*$/.test(it)) { defs.push(...info.map((c) => `${N.qid(c.name)} ${c.type || ""}${c.notnull ? " NOT NULL" : ""}`)); continue; }
        const cm = /^(?:\w+\.)?\[?(\w+)\]?(?:\s+(?:AS\s+)?\[?(\w+)\]?)?$/i.exec(it);
        const c = cm && info.find((x) => x.name.toLowerCase() === cm[1].toLowerCase());
        if (!c) { defs = null; break; }
        defs.push(`${N.qid(cm[2] || c.name)} ${c.type || ""}${c.notnull ? " NOT NULL" : ""}`);
      }
      if (defs && defs.length) {
        const isTemp = /^#|^tmp_/.test(target);
        pre.push(`CREATE ${isTemp ? "TEMP " : ""}TABLE ${target} (${defs.join(", ")})`);
        t = `INSERT INTO ${target} SELECT ${m[1]}${m[2]} FROM ${m[4]}${m[5] ? " AS " + m[5] : ""}${m[6] || ""}`;
      }
    }
    // other SELECT … INTO new_table FROM …  →  CREATE TABLE new_table AS SELECT … FROM …
    if (!pre.length && /^\s*(SELECT|WITH)\b/i.test(t)) {
      const into = findTopKw(t, "INTO");
      if (into >= 0 && !/\bINSERT\s+$/i.test(t.slice(0, into))) {
        const after = t.slice(into + 4);
        const nm = /^\s*([#\w\[\]".]+)\s*/.exec(after);
        if (nm) {
          const rest = after.slice(nm[0].length);
          const name = nm[1];
          t = `CREATE ${/^tmp_/.test(name) ? "TEMP " : ""}TABLE ${name} AS ${t.slice(0, into)} ${rest}`;
        }
      }
    }
    // TOP (n) [PERCENT] → LIMIT
    if ((m = /\bSELECT\s+(DISTINCT\s+)?TOP\s*\(?\s*(\d+)\s*\)?\s*(PERCENT\b)?/i.exec(t))) {
      if (m[3]) throw sqlErr(50000, 16, 1, ctx.line, "TOP … PERCENT is valid T-SQL but not supported by the Nimbus engine.");
      t = t.replace(m[0], "SELECT " + (m[1] || "")) + ` LIMIT ${m[2]}`;
    }
    if ((m = /\bOFFSET\s+(\d+)\s+ROWS?\s*(?:FETCH\s+(?:NEXT|FIRST)\s+(\d+)\s+ROWS?\s+ONLY)?/i.exec(t))) t = t.replace(m[0], `LIMIT ${m[2] || -1} OFFSET ${m[1]}`);
    // UPDATE alias SET … FROM target alias JOIN src ON cond [WHERE w]
    if ((m = /^\s*UPDATE\s+([\w\[\]"]+)\s+SET\s+([\s\S]+?)\s+FROM\s+([\s\S]+)$/i.exec(t))) {
      const alias = m[1], sets = m[2], from = m[3];
      const whereIdx = findTopKw(from, "WHERE");
      const fromPart = whereIdx >= 0 ? from.slice(0, whereIdx) : from, where = whereIdx >= 0 ? from.slice(whereIdx + 5) : "";
      const first = /^\s*([\w\[\]"]+)(?:\s+(?:AS\s+)?([\w\[\]"]+))?\s*/i.exec(fromPart);
      const fAlias = first && first[2] && !/^(INNER|LEFT|JOIN|RIGHT|CROSS|WHERE)$/i.test(first[2]) ? first[2] : first && first[1];
      const setsFixed = splitTop(sets).map((s) => s.replace(/^\s*[\w\[\]"]+\s*\.\s*/, "")).join(", ");
      if (first && fAlias && fAlias.toLowerCase() === alias.toLowerCase()) {
        const target = first[1];
        let rest = fromPart.slice(first[0].length).trim();
        const j = /^(?:INNER\s+)?JOIN\s+([\s\S]+?)\s+ON\s+([\s\S]+)$/i.exec(rest);
        if (!rest) t = `UPDATE ${target} AS ${alias} SET ${setsFixed}${where ? " WHERE " + where : ""}`;
        else if (j) {
          const onIdx = findTopKw(rest, "ON");
          const src = rest.slice(rest.search(/JOIN/i) + 4, onIdx).trim();
          const cond = rest.slice(onIdx + 2).trim();
          t = `UPDATE ${target} AS ${alias} SET ${setsFixed} FROM ${src} WHERE (${cond})${where ? ` AND (${where})` : ""}`;
        } else throw sqlErr(50000, 16, 1, ctx.line, "The Nimbus engine supports UPDATE … FROM with one INNER JOIN. Azure SQL supports more; rewrite with EXISTS or a MERGE.");
      } else t = `UPDATE ${alias} SET ${setsFixed} FROM ${fromPart}${where ? " WHERE " + where : ""}`;
    } else if ((m = /^\s*UPDATE\s+([\w\[\]"]+)(?:\s+AS\s+(\w+))?\s+SET\s+/i.exec(t))) {
      t = t.replace(/(\bSET\s+)([\s\S]*?)(\s+WHERE\b|$)/i, (all, a, sets, b) => a + splitTop(sets).map((s) => s.replace(/^\s*[\w\[\]"]+\s*\.\s*(?=[\w\[\]"]+\s*=)/, "")).join(", ") + b);
    }
    // DELETE alias FROM target alias JOIN src ON cond [WHERE]
    if ((m = /^\s*DELETE\s+([\w\[\]"]+)\s+FROM\s+([\w\[\]"]+)\s+(?:AS\s+)?([\w\[\]"]+)\s+(?:INNER\s+)?JOIN\s+([\s\S]+?)\s+ON\s+([\s\S]+?)(?:\s+WHERE\s+([\s\S]+))?$/i.exec(t)) && m[1].toLowerCase() === m[3].toLowerCase()) {
      t = `DELETE FROM ${m[2]} AS ${m[3]} WHERE EXISTS (SELECT 1 FROM ${m[4]} WHERE ${m[5]}${m[6] ? ` AND ${m[6]}` : ""})`;
    }
    // functions
    t = rewriteCalls(t, "TRY_CAST", (a, inner) => { const k = findTopKw(inner, "AS"); return k < 0 ? null : `__try_cast(${inner.slice(0, k)}, ${addLit(lits, inner.slice(k + 2).trim())})`; });
    t = rewriteCalls(t, "CAST", (a, inner) => { const k = findTopKw(inner, "AS"); return k < 0 ? null : `__cast(${inner.slice(0, k)}, ${addLit(lits, inner.slice(k + 2).trim())})`; });
    t = rewriteCalls(t, "TRY_CONVERT", (a) => `__try_convert(${addLit(lits, a[0])}, ${a.slice(1).join(", ")})`);
    t = rewriteCalls(t, "CONVERT", (a) => `__convert(${addLit(lits, a[0])}, ${a.slice(1).join(", ")})`);
    t = rewriteCalls(t, "ISNULL", (a) => `IFNULL(${a.join(", ")})`);
    t = rewriteCalls(t, "LEN", (a) => `length(rtrim(${a[0]}))`);
    t = rewriteCalls(t, "DATALENGTH", (a) => `length(${a[0]})`);
    t = rewriteCalls(t, "CHARINDEX", (a) => `__charindex(${a.join(", ")})`);
    t = rewriteCalls(t, "DATEADD", (a) => `__dateadd(${addLit(lits, a[0])}, ${a[1]}, ${a[2]})`);
    t = rewriteCalls(t, "DATEDIFF", (a) => `__datediff(${addLit(lits, a[0])}, ${a[1]}, ${a[2]})`);
    t = rewriteCalls(t, "DATEPART", (a) => `__datepart(${addLit(lits, a[0])}, ${a[1]})`);
    t = rewriteCalls(t, "DATENAME", (a) => `__datename(${addLit(lits, a[0])}, ${a[1]})`);
    t = rewriteCalls(t, "LEFT", (a) => `__left(${a.join(", ")})`);
    t = rewriteCalls(t, "RIGHT", (a) => `__right(${a.join(", ")})`);
    t = rewriteCalls(t, "COUNT_BIG", (a, inner) => `COUNT(${inner})`);
    t = rewriteCalls(t, "NEWID", () => "__newid()");
    t = rewriteCalls(t, "SCOPE_IDENTITY", () => "last_insert_rowid()");
    t = t.replace(/\bSTRING_AGG\s*\(([^()]*(?:\([^()]*\)[^()]*)*)\)\s*WITHIN\s+GROUP\s*\(\s*ORDER\s+BY\s+([^)]*)\)/gi, "group_concat($1 ORDER BY $2)");
    t = rewriteCalls(t, "STRING_AGG", (a) => `group_concat(${a.join(", ")})`);
    t = t.replace(/\b(GETDATE|GETUTCDATE|SYSDATETIME|SYSUTCDATETIME)\s*\(\s*\)/gi, "__now()").replace(/@@ROWCOUNT\b/gi, "changes()").replace(/@@TRANCOUNT\b/gi, ctx.tx && ctx.tx.inTran ? "1" : "0").replace(/@@ERROR\b/gi, "0").replace(/@@IDENTITY\b/gi, "last_insert_rowid()").replace(/@@VERSION\b/gi, addLit(lits, "Microsoft SQL Azure (RTM) - 12.0 (Nimbus sandbox emulation)")).replace(/@@SERVERNAME\b/gi, addLit(lits, ctx.server || "nimbus"));
    // string concatenation with +
    t = t.replace(/(\u0001\d+\u0002)\s*\+(?!=)/g, "$1 ||").replace(/\+\s*(\u0001\d+\u0002)/g, "|| $1");
    t = t.replace(/^\s*WITH\b(?!\s+RECURSIVE)/i, "WITH RECURSIVE");
    t = t.replace(/\bAS\s+WITH\b(?!\s+RECURSIVE)/i, "AS WITH RECURSIVE");
    return [...pre, t];
  }
  const sq = (s) => "'" + String(s).replace(/'/g, "''") + "'";

  /* MERGE target [AS] t USING src [AS] s ON cond WHEN … ;  → UPDATE / INSERT / DELETE */
  function translateMerge(t, ctx) {
    t = t.replace(/\[dbo\]\s*\.\s*/gi, "").replace(/\bdbo\s*\.\s*/gi, "");
    const head = /^\s*MERGE\s+(?:INTO\s+)?([\w\[\]"]+)\s+(?:AS\s+)?(\w+)\s+USING\s+/i.exec(t);
    if (!head) throw sqlErr(102, 15, 1, ctx.line, "Incorrect syntax near 'MERGE'. Expected MERGE target AS t USING source AS s ON … WHEN …");
    let rest = t.slice(head[0].length);
    let src, srcAlias;
    if (rest.trim().startsWith("(")) {
      const o = rest.indexOf("("), c = matchParen(rest, o);
      src = rest.slice(o, c + 1); rest = rest.slice(c + 1);
    } else { const n = /^\s*([\w\[\]"]+)/.exec(rest); src = n[1]; rest = rest.slice(n[0].length); }
    const al = /^\s*(?:AS\s+)?(\w+)\s+ON\s+/i.exec(rest);
    if (!al) throw sqlErr(102, 15, 1, ctx.line, "Incorrect syntax in MERGE: the source needs an alias, e.g. USING src AS s ON …");
    srcAlias = al[1]; rest = rest.slice(al[0].length);
    const target = head[1], ta = head[2];
    const firstWhen = findTopKw(rest, "WHEN");
    const on = rest.slice(0, firstWhen).trim();
    const clauses = [];
    let idx = firstWhen;
    while (idx >= 0) {
      const next = findTopKw(rest, "WHEN", idx + 4);
      clauses.push(rest.slice(idx, next < 0 ? rest.length : next).trim());
      idx = next;
    }
    const out = [];
    const srcFrom = `${src} AS ${srcAlias}`;
    let notMatchedBySource = null;
    for (const c of clauses) {
      let m;
      if ((m = /^WHEN\s+MATCHED\s*(?:AND\s+([\s\S]+?))?\s+THEN\s+UPDATE\s+SET\s+([\s\S]+)$/i.exec(c))) {
        const sets = splitTop(m[2]).map((s) => s.replace(/^\s*[\w\[\]"]+\s*\.\s*(?=[\w\[\]"]+\s*=)/, "")).join(", ");
        out.push(`UPDATE ${target} AS ${ta} SET ${sets} FROM ${srcFrom} WHERE (${on})${m[1] ? ` AND (${m[1]})` : ""}`);
      } else if ((m = /^WHEN\s+MATCHED\s*(?:AND\s+([\s\S]+?))?\s+THEN\s+DELETE$/i.exec(c))) {
        out.push(`DELETE FROM ${target} AS ${ta} WHERE EXISTS (SELECT 1 FROM ${srcFrom} WHERE (${on})${m[1] ? ` AND (${m[1]})` : ""})`);
      } else if ((m = /^WHEN\s+NOT\s+MATCHED\s*(?:BY\s+TARGET\s*)?(?:AND\s+([\s\S]+?))?\s+THEN\s+INSERT\s*(\([^)]*\))?\s*VALUES\s*\(([\s\S]+)\)$/i.exec(c))) {
        out.push({ insert: `INSERT INTO ${target} ${m[2] || ""} SELECT ${m[3]} FROM ${srcFrom} WHERE NOT EXISTS (SELECT 1 FROM ${target} AS ${ta} WHERE ${on})${m[1] ? ` AND (${m[1]})` : ""}` });
      } else if ((m = /^WHEN\s+NOT\s+MATCHED\s+BY\s+SOURCE\s*(?:AND\s+([\s\S]+?))?\s+THEN\s+DELETE$/i.exec(c))) {
        notMatchedBySource = `DELETE FROM ${target} AS ${ta} WHERE NOT EXISTS (SELECT 1 FROM ${srcFrom} WHERE ${on})${m[1] ? ` AND (${m[1]})` : ""}`;
      } else if (/^WHEN\s+NOT\s+MATCHED\s+BY\s+SOURCE\s*(?:AND\s+[\s\S]+?)?\s+THEN\s+UPDATE/i.test(c)) {
        throw sqlErr(50000, 16, 1, ctx.line, "WHEN NOT MATCHED BY SOURCE THEN UPDATE is valid T-SQL but not supported by the Nimbus engine (DELETE is).");
      } else throw sqlErr(102, 15, 1, ctx.line, `Incorrect syntax near '${c.slice(0, 40)}'.`);
    }
    // order like SQL Server: matches evaluated against the original target → delete-by-source and updates first, inserts last
    const ordered = [...(notMatchedBySource ? [notMatchedBySource] : []), ...out.filter((x) => typeof x === "string"), ...out.filter((x) => typeof x !== "string").map((x) => x.insert)];
    return ordered;
  }

  /* ======================= T-SQL: interpreter ======================= */
  function ensureProcTable(db) { db.run("CREATE TABLE IF NOT EXISTS __nimbus_procs (name TEXT PRIMARY KEY, params TEXT, body TEXT)"); }

  function runTsql(db, sql, opts = {}) {
    N.registerSqlFunctions(db);
    const strict = opts.strict !== false;
    const t0 = performance.now();
    const results = [], messages = [];
    let totalChanges = 0;
    const vars = opts.vars || {};
    const tx = opts.tx || { inTran: false };
    const batches = String(sql).split(/^\s*GO\s*(?:\d+)?\s*;?\s*$/gim);
    let lineBase = 0;
    for (const batch of batches) {
      const batchLines = batch.split("\n").length;
      if (!batch.trim()) { lineBase += batchLines; continue; }
      const { text, lits } = mask(batch);
      // CREATE PROCEDURE takes the whole batch (SQL Server rule)
      const proc = /^\s*CREATE\s+(?:OR\s+ALTER\s+)?PROC(?:EDURE)?\s+([\w\[\]".]+)\s*([\s\S]*?)\bAS\b([\s\S]*)$/i.exec(text);
      if (proc) {
        ensureProcTable(db);
        const name = proc[1].replace(/^\[?dbo\]?\./i, "").replace(/[\[\]"]/g, "");
        const params = splitTop(proc[2].trim().replace(/^\(([\s\S]*)\)$/, "$1")).map((p) => p.trim()).filter(Boolean).map((p) => {
          const pm = /^(@\w+)\s+([\w]+(?:\s*\([^)]*\))?)(?:\s*=\s*([\s\S]+?))?(\s+OUTPUT)?$/i.exec(unmask(p, lits));
          if (!pm) throw sqlErr(102, 15, 1, lineBase + 1, `Incorrect syntax near '${p}'.`);
          return { name: pm[1].toLowerCase(), type: pm[2], def: pm[3] ? pm[3].trim() : null };
        });
        let body = unmask(proc[3], lits).trim().replace(/^BEGIN\b/i, "").replace(/\bEND\s*;?\s*$/i, "");
        if (/^\s*CREATE\s+PROC/i.test(text) && !/OR\s+ALTER/i.test(text) && db.exec(`SELECT 1 FROM __nimbus_procs WHERE lower(name)=lower(${sq(name)})`).length) throw sqlErr(2714, 16, 3, lineBase + 1, `There is already an object named '${name}' in the database.`);
        db.run("INSERT OR REPLACE INTO __nimbus_procs VALUES (?, ?, ?)", [name, JSON.stringify(params), body]);
        messages.push("Commands completed successfully.");
        lineBase += batchLines;
        continue;
      }
      const units = splitUnits(text);
      if (strict) {
        units.forEach((u, i) => {
          if (/^\s*CREATE\s+(OR\s+ALTER\s+)?(VIEW|FUNCTION|TRIGGER)\b/i.test(u.text) && i > 0) throw sqlErr(111, 15, 1, lineBase + u.line, `'CREATE ${/VIEW|FUNCTION|TRIGGER/i.exec(u.text)[0].toUpperCase()}' must be the first statement in a query batch.\n(Nimbus: put GO on its own line before it, or run it as its own script block in ADF.)`);
        });
      }
      const tree = parseTree(units);
      const ctx = { db, lits, strict, vars, results, messages, lineBase, server: opts.server, depth: (opts.depth || 0), onStatement: opts.onStatement, tx };
      try { execNodes(tree, ctx); }
      catch (e) { if (tx.inTran && !opts.tx) { try { db.run("ROLLBACK"); } catch (x) {} tx.inTran = false; messages.push("The open transaction was rolled back because the batch failed."); } throw e; }
      totalChanges += ctx.changes || 0;
      lineBase += batchLines;
    }
    if (tx.inTran && !opts.tx) { try { db.run("COMMIT"); } catch (x) {} tx.inTran = false; messages.push("Warning: the batch ended with an open transaction. Nimbus committed it; Azure SQL would keep it open and hold locks until you COMMIT or ROLLBACK."); }
    return { results, messages, ms: Math.round(performance.now() - t0), changes: totalChanges };
  }

  function substVars(t, ctx) {
    t = t.replace(/@@TRANCOUNT\b/gi, ctx.tx && ctx.tx.inTran ? "1" : "0").replace(/@@ROWCOUNT\b/gi, "changes()").replace(/@@ERROR\b/gi, "0");
    return t.replace(/(^|[^@\w])@(\w+)/g, (all, pre, name) => {
      const k = "@" + name.toLowerCase();
      if (!(k in ctx.vars)) throw sqlErr(137, 15, 2, ctx.line, `Must declare the scalar variable "@${name}".`);
      const v = ctx.vars[k];
      return pre + (v === null || v === undefined ? "NULL" : typeof v === "number" ? String(v) : addLit(ctx.lits, v));
    });
  }
  function evalScalar(expr, ctx) {
    const [sql] = translateTsql(substVars(expr, ctx), ctx);
    const r = ctx.db.exec(unmask("SELECT " + sql, ctx.lits));
    return r.length && r[0].values.length ? r[0].values[0][0] : null;
  }
  function evalCond(cond, ctx) {
    const v = evalScalar(`CASE WHEN ${cond} THEN 1 ELSE 0 END`, ctx);
    return v === 1;
  }

  function execNodes(nodes, ctx) {
    for (const n of nodes) {
      const r = execNode(n, ctx);
      if (r === "RETURN" || r === "BREAK" || r === "CONTINUE") return r;
    }
  }
  function execNode(n, ctx) {
    ctx.line = ctx.lineBase + n.line;
    try {
      switch (n.type) {
        case "block": return execNodes(n.body, ctx);
        case "if": if (evalCond(n.cond, ctx)) return n.then && execNode(n.then, ctx); return n.else && execNode(n.else, ctx);
        case "while": {
          let guard = 0;
          while (evalCond(n.cond, ctx)) {
            if (++guard > 10000) throw sqlErr(50000, 16, 1, ctx.line, "WHILE loop stopped after 10,000 iterations (Nimbus safety limit).");
            const r = execNode(n.body, ctx);
            if (r === "BREAK") break; if (r === "RETURN") return r;
          }
          return;
        }
        case "try": {
          try { return execNodes(n.tryB, ctx); }
          catch (e) {
            const err = e.isSql ? e : translateSqliteError(e, ctx.line);
            const saved = ctx.err; ctx.err = err;
            try { return execNodes(n.catchB, ctx); } finally { ctx.err = saved; }
          }
        }
        case "stmt": return execStmt(n, ctx);
      }
    } catch (e) { throw e.isSql ? e : translateSqliteError(e, ctx.line); }
  }

  function execStmt(n, ctx) {
    N.__udfErr = null;
    let t = n.text.trim();
    const { db, lits } = ctx;
    const U = t.toUpperCase();
    // error functions inside CATCH
    if (ctx.err) {
      t = t.replace(/\bERROR_MESSAGE\s*\(\s*\)/gi, addLit(lits, ctx.err.sqlText)).replace(/\bERROR_NUMBER\s*\(\s*\)/gi, String(ctx.err.sqlNumber)).replace(/\bERROR_LINE\s*\(\s*\)/gi, String(ctx.line)).replace(/\bERROR_SEVERITY\s*\(\s*\)/gi, "16").replace(/\bERROR_STATE\s*\(\s*\)/gi, "1").replace(/\bERROR_PROCEDURE\s*\(\s*\)/gi, "NULL");
    }
    if (/^(SET\s+(NOCOUNT|XACT_ABORT|ANSI_NULLS|QUOTED_IDENTIFIER|ANSI_WARNINGS|ARITHABORT|DATEFIRST|LANGUAGE|IDENTITY_INSERT)\b|USE\s)/i.test(t)) return;
    if (/^RETURN\b/i.test(t)) return "RETURN";
    if (/^BREAK$/i.test(t)) return "BREAK";
    if (/^CONTINUE$/i.test(t)) return "CONTINUE";
    if (/^BEGIN\s+TRAN(SACTION)?\b/i.test(t)) { if (!ctx.tx.inTran) { db.run("BEGIN"); ctx.tx.inTran = true; } ctx.tx.depth = (ctx.tx.depth || 0) + 1; return; }
    if (/^COMMIT(\s+TRAN(SACTION)?)?\b/i.test(t)) { if (!ctx.tx.inTran) throw sqlErr(3902, 16, 1, ctx.line, "The COMMIT TRANSACTION request has no corresponding BEGIN TRANSACTION."); ctx.tx.depth = Math.max(0, (ctx.tx.depth || 1) - 1); if (!ctx.tx.depth) { db.run("COMMIT"); ctx.tx.inTran = false; } return; }
    if (/^ROLLBACK(\s+TRAN(SACTION)?)?\b/i.test(t)) { if (!ctx.tx.inTran) throw sqlErr(3903, 16, 1, ctx.line, "The ROLLBACK TRANSACTION request has no corresponding BEGIN TRANSACTION."); db.run("ROLLBACK"); ctx.tx.inTran = false; ctx.tx.depth = 0; return; }
    if (/^(GRANT|DENY|REVOKE)\b/i.test(t)) { if (ctx.onStatement) { ctx.onStatement(unmask(t, lits), ctx); return; } ctx.messages.push("Commands completed successfully."); return; }
    if (/^DECLARE\b/i.test(t)) {
      if (/\bTABLE\s*\(/i.test(t)) throw sqlErr(50000, 16, 1, ctx.line, "Table variables are valid T-SQL but not supported by the Nimbus engine. Use a #temp table (created with SELECT … INTO #name).");
      if (/\bCURSOR\b/i.test(t)) throw sqlErr(50000, 16, 1, ctx.line, "Cursors are not supported by the Nimbus engine (and are rarely the right tool in data engineering: think in sets).");
      for (const d of splitTop(t.replace(/^DECLARE\s+/i, ""))) {
        const m = /^\s*(@\w+)\s+(?:AS\s+)?([\w]+(?:\s*\([^)]*\))?)\s*(?:=\s*([\s\S]+))?$/i.exec(d);
        if (!m) throw sqlErr(102, 15, 1, ctx.line, `Incorrect syntax near '${unmask(d, lits).trim()}'.`);
        const k = m[1].toLowerCase();
        ctx.vars[k] = m[3] ? tsqlConvert(evalScalar(m[3], ctx), m[2]) : null;
        ctx.varTypes = ctx.varTypes || {}; ctx.varTypes[k] = m[2];
      }
      return;
    }
    let m;
    if ((m = /^SET\s+(@\w+)\s*(=|\+=|-=)\s*([\s\S]+)$/i.exec(t))) {
      const k = m[1].toLowerCase();
      if (!(k in ctx.vars)) throw sqlErr(137, 15, 1, ctx.line, `Must declare the scalar variable "${m[1]}".`);
      let v = evalScalar(m[3], ctx);
      if (m[2] === "+=") v = typeof ctx.vars[k] === "number" ? ctx.vars[k] + v : (ctx.vars[k] || "") + v;
      if (m[2] === "-=") v = ctx.vars[k] - v;
      ctx.vars[k] = ctx.varTypes && ctx.varTypes[k] ? tsqlConvert(v, ctx.varTypes[k]) : v;
      return;
    }
    if ((m = /^PRINT\s+([\s\S]+)$/i.exec(t))) { ctx.messages.push(String(evalScalar(m[1], ctx) ?? "")); return; }
    if ((m = /^THROW\b\s*([\s\S]*)$/i.exec(t))) {
      if (!m[1].trim()) { if (ctx.err) throw ctx.err; throw sqlErr(10704, 16, 1, ctx.line, "To rethrow an error, a THROW statement must be used inside a CATCH block."); }
      const a = splitTop(substVars(m[1], ctx));
      const num = Number(evalScalar(a[0], ctx)), msg = String(evalScalar(a[1], ctx));
      if (num < 50000) throw sqlErr(35100, 16, 10, ctx.line, `Error number ${num} in the THROW statement is outside the valid range. Specify an error number in the valid range of 50000 to 2147483647.`);
      throw sqlErr(num, 16, Number(evalScalar(a[2] || "1", ctx)), ctx.line, msg);
    }
    if ((m = /^RAISERROR\s*\(([\s\S]+)\)\s*(WITH\s+\w+)?$/i.exec(t))) { const a = splitTop(substVars(m[1], ctx)); throw sqlErr(50000, Number(evalScalar(a[1] || "16", ctx)), 1, ctx.line, String(evalScalar(a[0], ctx))); }
    if ((m = /^EXEC(?:UTE)?\s+([\w\[\]".]+)\s*([\s\S]*)$/i.exec(t))) return execProc(m[1], m[2], ctx);
    if (/^(CREATE|DROP)\s+USER\b|^ALTER\s+ROLE\b/i.test(t)) { if (ctx.onStatement) { ctx.onStatement(unmask(t, lits), ctx); return; } throw sqlErr(15151, 16, 1, ctx.line, "Cannot manage users here."); }
    if (/^CREATE\s+SCHEMA\b/i.test(t)) throw sqlErr(50000, 16, 1, ctx.line, "Schemas other than dbo are valid in Azure SQL but not supported by the Nimbus engine. Use a name prefix instead (stg_, dim_, fact_).");
    if (/^MERGE\b/i.test(t) && ctx.strict && !n.semi) throw sqlErr(10713, 15, 1, ctx.line, "A MERGE statement must be terminated by a semi-colon (;).");
    if (ctx.strict) strictCheck(t, ctx.line, lits);
    t = substVars(t, ctx);
    let stmts;
    if (/^MERGE\b/i.test(t)) stmts = translateMerge(t, ctx).flatMap((s) => translateTsql(s, ctx));
    else if ((m = /^CREATE\s+OR\s+ALTER\s+VIEW\s+([\w\[\]".]+)/i.exec(t))) stmts = [`DROP VIEW IF EXISTS ${m[1].replace(/^\[?dbo\]?\./i, "")}`, ...translateTsql(t.replace(/^CREATE\s+OR\s+ALTER\s+VIEW/i, "CREATE VIEW"), ctx)];
    else stmts = translateTsql(t, ctx);
    const isMerge = /^MERGE\b/i.test(t);
    let affected = 0;
    const sp = isMerge;
    if (sp) db.run("SAVEPOINT nimbus_merge");
    try {
      for (const s of stmts) {
        const sql = unmask(s, lits);
        if (ctx.trace) ctx.trace.push(sql);
        const before = db.getRowsModified ? null : null;
        const res = db.exec(sql);
        const ch = db.getRowsModified();
        const rowsReturned = res.length && /^\s*(SELECT|WITH)\b/i.test(sql);
        if (rowsReturned) { res.forEach((r) => ctx.results.push(r)); ctx.messages.push(`(${res[res.length - 1].values.length} row${res[res.length - 1].values.length === 1 ? "" : "s"} affected)`); }
        else if (/^\s*(INSERT|UPDATE|DELETE|CREATE\s+TABLE\s+\S+\s+AS)/i.test(sql)) affected += ch;
      }
      if (sp) db.run("RELEASE nimbus_merge");
    } catch (e) { if (sp) { try { db.run("ROLLBACK TO nimbus_merge"); db.run("RELEASE nimbus_merge"); } catch (x) {} } throw e; }
    if (/^(INSERT|UPDATE|DELETE|MERGE|TRUNCATE)\b/i.test(t) || /\bINTO\b/i.test(t) && /^(SELECT|WITH)/i.test(t)) { ctx.messages.push(`(${affected} row${affected === 1 ? "" : "s"} affected)`); ctx.changes = (ctx.changes || 0) + affected; }
    else if (/^(CREATE|DROP|ALTER)\b/i.test(t)) ctx.messages.push("Commands completed successfully.");
  }

  function execProc(nameRaw, argText, ctx) {
    const name = nameRaw.replace(/^\[?dbo\]?\./i, "").replace(/[\[\]"]/g, "");
    if (/^sp_/i.test(name)) throw sqlErr(2812, 16, 62, ctx.line, `Could not find stored procedure '${name}'. (System procedures are not emulated by Nimbus; query INFORMATION_SCHEMA instead.)`);
    let r;
    try { r = ctx.db.exec(`SELECT params, body FROM __nimbus_procs WHERE lower(name) = lower(${sq(name)})`); } catch (e) { r = []; }
    if (!r.length) throw sqlErr(2812, 16, 62, ctx.line, `Could not find stored procedure '${name}'.`);
    const params = JSON.parse(r[0].values[0][0]), body = r[0].values[0][1];
    const args = argText.trim() ? splitTop(argText.trim()) : [];
    const vars = {};
    params.forEach((p) => (vars[p.name] = p.def != null ? tsqlConvert(p.def.replace(/^'(.*)'$/, "$1"), p.type) : undefined));
    args.forEach((a, i) => {
      const named = /^\s*(@\w+)\s*=\s*([\s\S]+)$/.exec(a);
      const target = named ? named[1].toLowerCase() : params[i] && params[i].name;
      const p = params.find((x) => x.name === target);
      if (!p) throw sqlErr(8145, 16, 2, ctx.line, `${named ? named[1] : "Argument " + (i + 1)} is not a parameter for procedure ${name}.`);
      vars[target] = tsqlConvert(evalScalar(named ? named[2] : a, ctx), p.type);
    });
    params.forEach((p) => { if (vars[p.name] === undefined) throw sqlErr(201, 16, 4, ctx.line, `Procedure or function '${name}' expects parameter '${p.name}', which was not supplied.`); });
    if (ctx.depth > 30) throw sqlErr(217, 16, 1, ctx.line, "Maximum stored procedure nesting level exceeded (limit 32).");
    const sub = runTsql(ctx.db, body, { strict: ctx.strict, vars, server: ctx.server, onStatement: ctx.onStatement, tx: ctx.tx, depth: ctx.depth + 1 });
    sub.results.forEach((x) => ctx.results.push(x));
    ctx.messages.push(...sub.messages);
    ctx.changes = (ctx.changes || 0) + sub.changes;
  }

  /* ======================= Spark SQL (notebooks) ======================= */
  /* ctx.load(path, {format, header}) → {table, structCols}; ctx.write(path, format, header, columns, rows) */
  function runSpark(db, sql, ctx) {
    N.registerSqlFunctions(db);
    const t0 = performance.now();
    const { text, lits } = mask(sql, { dq: true });
    const stmts = splitTop(text, ";").map((s) => s.trim()).filter(Boolean);
    const results = [], messages = [];
    const structCols = db.__structCols || (db.__structCols = new Set());
    for (let s of stmts) {
      try {
        let m;
        if (/^(SHOW\s+TABLES)$/i.test(s)) { const r = db.exec("SELECT 'default' AS namespace, name AS tableName, CASE WHEN type = 'view' THEN 1 ELSE 0 END AS isTemporary FROM sqlite_master WHERE type IN ('table','view') AND name NOT LIKE '\\_\\_%' ESCAPE '\\' UNION ALL SELECT '', name, 1 FROM temp.sqlite_master WHERE type = 'view' AND name NOT LIKE '\\_\\_%' ESCAPE '\\'"); results.push(r[0] || { columns: ["namespace", "tableName", "isTemporary"], values: [] }); continue; }
        if ((m = /^(?:DESCRIBE|DESC)\s+(?:TABLE\s+)?([\w`]+)$/i.exec(s))) { const r = db.exec(`SELECT name AS col_name, lower(type) AS data_type, NULL AS comment FROM pragma_table_info('${m[1].replace(/`/g, "")}')`); if (!r.length) throw new Error(`no such table: ${m[1]}`); results.push(r[0]); continue; }
        // sources
        const loadSrc = (path, opts) => { const r = ctx.load(path, opts); (r.structCols || []).forEach((c) => structCols.add(c)); return r.table; };
        s = rewriteCalls(s, "read_files", (a) => {
          const path = litOf(a[0], lits);
          if (path == null) throw new Error("[INVALID_PARAMETER_VALUE] read_files requires a path string as its first argument.");
          const opts = {};
          a.slice(1).forEach((x) => { const kv = /^(\w+)\s*=>\s*([\s\S]+)$/.exec(x); if (kv) { const v = litOf(kv[2], lits); opts[kv[1].toLowerCase()] = v != null ? v : kv[2].trim().toLowerCase(); } });
          return loadSrc(path, { format: opts.format, header: String(opts.header) === "true", readFiles: true });
        });
        s = s.replace(/\b(csv|json|text)\s*\.\s*`([^`]+)`/gi, (all, fmt, path) => loadSrc(path, { format: fmt.toLowerCase(), header: false }));
        s = rewriteCalls(s, "read_table", (a) => { const n = litOf(a[0], lits); if (n == null) throw new Error("read_table needs a 'database.table' string"); return ctx.loadTable(n); });
        s = s.replace(/\b(read_csv|read_json|read_lake)\s*\(\s*(\u0001\d+\u0002)\s*\)/gi, (all, fn, ph) => loadSrc(litOf(ph, lits), { format: fn === "read_json" ? "json" : fn === "read_csv" ? "csv" : undefined, header: true, nimbus: true }));
        // struct field access on JSON columns: device.type → json_extract(device, '$.type')
        for (const c of structCols) s = s.replace(new RegExp("\\b((?:\\w+\\.)?" + c + ")\\.(\\w+)\\b", "g"), (all, col, f) => `json_extract(${col}, '$.${f}')`);
        // writes
        let write = null;
        if ((m = /^INSERT\s+OVERWRITE\s+(?:LOCAL\s+)?DIRECTORY\s+(\u0001\d+\u0002)\s+USING\s+(\w+)\s*(?:OPTIONS\s*\(([\s\S]*?)\))?\s*([\s\S]+)$/i.exec(s))) {
          const opts = {};
          (m[3] || "").split(",").forEach((kv) => { const p = /^\s*(\u0001\d+\u0002|\w+)\s*=?\s*(\u0001\d+\u0002|\w+)\s*$/.exec(kv); if (p) opts[(litOf(p[1], lits) ?? p[1]).toLowerCase()] = (litOf(p[2], lits) ?? p[2]).toLowerCase(); });
          write = { path: litOf(m[1], lits), format: m[2].toLowerCase(), header: opts.header === "true" };
          s = m[4];
        }
        if ((m = /^CREATE\s+OR\s+REPLACE\s+(TEMP|TEMPORARY)\s+VIEW\s+([\w`]+)\s+AS\s+([\s\S]+)$/i.exec(s))) { db.run(`DROP VIEW IF EXISTS temp.${m[2]}`); s = `CREATE TEMP VIEW ${m[2]} AS ${m[3]}`; }
        else if ((m = /^CREATE\s+(TEMP|TEMPORARY)\s+VIEW\s+/i.exec(s))) s = s.replace(m[0], "CREATE TEMP VIEW ");
        if ((m = /^CREATE\s+OR\s+REPLACE\s+TABLE\s+([\w`.]+)/i.exec(s))) { db.run(`DROP TABLE IF EXISTS ${m[1]}`); s = s.replace(/^CREATE\s+OR\s+REPLACE\s+TABLE/i, "CREATE TABLE"); }
        s = s.replace(/\s+USING\s+(DELTA|PARQUET|CSV|JSON)\b/i, "");
        s = s.replace(/\bCAST\s*\(/gi, "CAST(");
        s = rewriteCalls(s, "CAST", (a, inner) => {
          const k = findTopKw(inner, "AS"); if (k < 0) return null;
          const ty = inner.slice(k + 2).trim().toLowerCase(), ex = inner.slice(0, k);
          if (ty === "string") return `CAST(${ex} AS TEXT)`;
          if (ty === "date") return `__s_to_date(${ex})`;
          if (ty === "timestamp") return `__s_to_ts(${ex})`;
          if (/^(int|integer|bigint|smallint|tinyint|long)$/.test(ty)) return `CAST(${ex} AS INTEGER)`;
          if (/^(double|float|real)$/.test(ty)) return `CAST(${ex} AS REAL)`;
          if (/^decimal/.test(ty)) { const sc = /,\s*(\d+)/.exec(ty); return `ROUND(CAST(${ex} AS REAL), ${sc ? sc[1] : 0})`; }
          if (ty === "boolean") return `(CASE WHEN ${ex} THEN 1 ELSE 0 END)`;
          return null;
        });
        s = rewriteCalls(s, "to_date", (a) => `__s_to_date(${a.join(", ")})`);
        s = rewriteCalls(s, "to_timestamp", (a) => `__s_to_ts(${a.join(", ")})`);
        s = rewriteCalls(s, "datediff", (a) => `__s_datediff(${a.join(", ")})`);
        s = rewriteCalls(s, "current_date", () => "__curdate()").replace(/\bcurrent_date\b(?!\s*\()/gi, "__curdate()");
        s = rewriteCalls(s, "current_timestamp", () => "__now()");
        s = rewriteCalls(s, "now", () => "__now()");
        s = rewriteCalls(s, "count_if", (a) => `SUM(CASE WHEN ${a[0]} THEN 1 ELSE 0 END)`);
        s = rewriteCalls(s, "collect_list", (a) => `json_group_array(${a[0]})`);
        s = rewriteCalls(s, "collect_set", (a) => `json_group_array(DISTINCT ${a[0]})`);
        s = rewriteCalls(s, "size", (a) => `json_array_length(${a[0]})`);
        s = rewriteCalls(s, "nvl", (a) => `IFNULL(${a.join(", ")})`);
        s = rewriteCalls(s, "approx_count_distinct", (a) => `COUNT(DISTINCT ${a[0]})`);
        s = rewriteCalls(s, "startswith", (a) => `__startswith(${a.join(", ")})`);
        s = rewriteCalls(s, "endswith", (a) => `__endswith(${a.join(", ")})`);
        s = s.replace(/\btrue\b/gi, "1").replace(/\bfalse\b/gi, "0");
        const sqlText = unmask(s, lits);
        const r = db.exec(sqlText);
        if (write) {
          const st = db.prepare(sqlText); const cols = st.getColumnNames(); st.free();
          const rows = r.length ? r[r.length - 1].values : [];
          ctx.write(write.path, write.format, write.header, cols, rows);
          messages.push(`Wrote ${rows.length} rows to ${write.path}`);
        } else if (r.length) results.push(r[r.length - 1]);
        else messages.push("OK");
      } catch (e) { throw sparkErr(e); }
    }
    return { results, messages, ms: Math.round(performance.now() - t0) };
  }

  /* ======================= ADF data flow expression language → SQL ======================= */
  function dfelToSql(src, { aggregate = false } = {}) {
    const toks = [];
    const s = String(src || "");
    let i = 0;
    while (i < s.length) {
      const c = s[i];
      if (/\s/.test(c)) { i++; continue; }
      if (c === "'" || c === '"') {
        let j = i + 1, v = "";
        while (j < s.length && s[j] !== c) { if (s[j] === "\\" && j + 1 < s.length) { v += s[j + 1]; j += 2; continue; } v += s[j++]; }
        if (j >= s.length) throw new Error(`Unterminated string in expression: ${src}`);
        toks.push({ k: "str", v }); i = j + 1; continue;
      }
      if (/\d/.test(c)) { let v = ""; while (i < s.length && /[\d.]/.test(s[i])) v += s[i++]; if (/[lLdD]/.test(s[i] || "")) i++; toks.push({ k: "num", v }); continue; }
      if (/[A-Za-z_$]/.test(c)) { let v = ""; while (i < s.length && /[\w$]/.test(s[i])) v += s[i++]; toks.push({ k: "id", v }); continue; }
      if (c === "{") { const j = s.indexOf("}", i); toks.push({ k: "id", v: s.slice(i + 1, j) }); i = j + 1; continue; }
      const two = s.slice(i, i + 3) === "===" ? "===" : s.slice(i, i + 2);
      if (["===", "==", "!=", "<>", ">=", "<=", "&&", "||"].includes(two)) { toks.push({ k: "op", v: two }); i += two.length; continue; }
      if ("()[],+-*/%<>!".includes(c)) { toks.push({ k: c === "(" || c === ")" || c === "[" || c === "]" || c === "," ? c : "op", v: c }); i++; continue; }
      throw new Error(`Unexpected character "${c}" in expression: ${src}`);
    }
    let p = 0;
    const id = (n) => '"' + n.replace(/"/g, '""') + '"';
    const F = {
      toInteger: (a) => `CAST(${a[0]} AS INTEGER)`, toLong: (a) => `CAST(${a[0]} AS INTEGER)`, toShort: (a) => `CAST(${a[0]} AS INTEGER)`,
      toDouble: (a) => `CAST(${a[0]} AS REAL)`, toFloat: (a) => `CAST(${a[0]} AS REAL)`, toDecimal: (a) => (a[2] ? `ROUND(CAST(${a[0]} AS REAL), ${a[2]})` : `CAST(${a[0]} AS REAL)`),
      toString: (a) => (a[1] ? `date_format(${a[0]}, ${a[1]})` : `CAST(${a[0]} AS TEXT)`), toBoolean: (a) => `(CASE WHEN lower(${a[0]}) IN ('true','1','t','yes') THEN 1 ELSE 0 END)`,
      toDate: (a) => `__s_to_date(${a.join(", ")})`, toTimestamp: (a) => `__s_to_ts(${a.join(", ")})`,
      iif: (a) => `(CASE WHEN ${a[0]} THEN ${a[1]} ELSE ${a[2] ?? "NULL"} END)`,
      case: (a) => { let o = "(CASE"; for (let k = 0; k + 1 < a.length; k += 2) o += ` WHEN ${a[k]} THEN ${a[k + 1]}`; if (a.length % 2) o += ` ELSE ${a[a.length - 1]}`; return o + " END)"; },
      isNull: (a) => `(${a[0]} IS NULL)`, isNotNull: (a) => `(${a[0]} IS NOT NULL)`, notNull: (a) => `(${a[0]} IS NOT NULL)`, coalesce: (a) => `COALESCE(${a.join(", ")})`, iifNull: (a) => `IFNULL(${a.join(", ")})`,
      concat: (a) => `(${a.join(" || ")})`, concatWS: (a) => `concat_ws(${a.join(", ")})`, lower: (a) => `lower(${a[0]})`, upper: (a) => `upper(${a[0]})`, trim: (a) => `trim(${a[0]})`, ltrim: (a) => `ltrim(${a[0]})`, rtrim: (a) => `rtrim(${a[0]})`,
      length: (a) => `length(${a[0]})`, substring: (a) => `substr(${a.join(", ")})`, left: (a) => `substr(${a[0]}, 1, ${a[1]})`, right: (a) => `substr(${a[0]}, -${a[1]})`, replace: (a) => `replace(${a.join(", ")})`,
      startsWith: (a) => `__startswith(${a.join(", ")})`, endsWith: (a) => `__endswith(${a.join(", ")})`, contains: (a) => `(instr(${a[0]}, ${a[1]}) > 0)`,
      round: (a) => `ROUND(${a[0]}, ${a[1] ?? 0})`, abs: (a) => `abs(${a[0]})`, floor: (a) => `floor(${a[0]})`, ceil: (a) => `ceiling(${a[0]})`,
      year: (a) => `year(${a[0]})`, month: (a) => `month(${a[0]})`, dayOfMonth: (a) => `dayofmonth(${a[0]})`, dayOfWeek: (a) => `dayofweek(${a[0]})`, hour: (a) => `hour(${a[0]})`,
      currentDate: () => "__curdate()", currentTimestamp: () => "__now()", currentUTC: () => "__now()", addDays: (a) => `date_add(${a[0]}, ${a[1]})`, subDays: (a) => `date_sub(${a[0]}, ${a[1]})`,
      sum: (a) => `SUM(${a[0]})`, avg: (a) => `AVG(${a[0]})`, min: (a) => `MIN(${a[0]})`, max: (a) => `MAX(${a[0]})`, count: (a) => (a.length ? `COUNT(${a[0]})` : "COUNT(*)"),
      countDistinct: (a) => `COUNT(DISTINCT ${a[0]})`, sumIf: (a) => `SUM(CASE WHEN ${a[0]} THEN ${a[1]} ELSE 0 END)`, countIf: (a) => `SUM(CASE WHEN ${a[0]} THEN 1 ELSE 0 END)`, first: (a) => `MIN(${a[0]})`, last: (a) => `MAX(${a[0]})`,
      null: () => "NULL", byName: (a) => a[0].replace(/^'(.*)'$/, '"$1"'),
      in: (a) => { if (!a[0].startsWith("(")) throw new Error("in() takes an array first: in(['a','b'], column)"); return `(${a[1]} IN ${a[0]})`; },
    };
    const AGG = ["sum", "avg", "min", "max", "count", "countDistinct", "sumIf", "countIf", "first", "last"];
    function seq(stops) {
      let out = "";
      while (p < toks.length && !stops.includes(toks[p].k)) {
        const t = toks[p];
        if (t.k === "str") { out += "'" + t.v.replace(/'/g, "''") + "' "; p++; continue; }
        if (t.k === "num") { out += t.v + " "; p++; continue; }
        if (t.k === "(") { p++; out += "(" + seq([")"]) + ") "; p++; continue; }
        if (t.k === "[") { p++; const items = []; while (p < toks.length && toks[p].k !== "]") { items.push(seq([",", "]"])); if (toks[p] && toks[p].k === ",") p++; } p++; out += "(" + items.join(", ") + ") "; continue; }
        if (t.k === "op") { out += ({ "==": "=", "===": "=", "!=": "<>", "&&": "AND", "||": "OR", "!": "NOT " }[t.v] ?? t.v) + " "; p++; continue; }
        if (t.k === "id") {
          if (toks[p + 1] && toks[p + 1].k === "(") {
            const name = t.v; p += 2;
            const args = [];
            while (p < toks.length && toks[p].k !== ")") { args.push(seq([",", ")"]).trim()); if (toks[p] && toks[p].k === ",") p++; }
            p++;
            const fn = Object.keys(F).find((k) => k.toLowerCase() === name.toLowerCase());
            if (!fn) throw new Error(`Unknown data flow function '${name}()'. Nimbus supports: ${Object.keys(F).filter((k) => k !== "byName").join(", ")}.`);
            if (!aggregate && AGG.includes(fn)) throw new Error(`Aggregate function '${fn}()' is only allowed in an Aggregate transformation.`);
            out += F[fn](args) + " ";
            continue;
          }
          if (/^(true|false)$/i.test(t.v)) { out += (t.v.toLowerCase() === "true" ? "1" : "0") + " "; p++; continue; }
          out += id(t.v) + " "; p++; continue;
        }
        throw new Error(`Unexpected "${t.v || t.k}" in expression: ${src}`);
      }
      return out.trim();
    }
    const r = seq([]);
    if (p < toks.length) throw new Error(`Unexpected "${toks[p].v || toks[p].k}" in expression: ${src}`);
    return r;
  }

  N.tsql = { run: runTsql, convert: tsqlConvert, parseDate, splitUnits, mask, translateSqliteError, sqlErr };
  N.spark = { run: runSpark };
  N.dfel = { toSql: dfelToSql };
  N.dt = { fmtDate, fmtDT, parseDate, javaFormat };
})(window.N);
