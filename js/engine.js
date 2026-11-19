/* Nimbus Portal — pipeline expressions, activities, runner and triggers */
(function (N) {
  const S = N.store;

  /* ================= Expression language (subset of pipeline expressions) ================= */
  function tokenize(src) {
    const t = [];
    let i = 0;
    while (i < src.length) {
      const c = src[i];
      if (/\s/.test(c)) { i++; continue; }
      if (c === "'") {
        let s = ""; i++;
        while (i < src.length) {
          if (src[i] === "'" && src[i + 1] === "'") { s += "'"; i += 2; continue; }
          if (src[i] === "'") break;
          s += src[i++];
        }
        if (src[i] !== "'") throw new Error("Unclosed string in expression");
        i++; t.push({ k: "str", v: s }); continue;
      }
      if (/[0-9-]/.test(c) && /[0-9]/.test(src[i + (c === "-" ? 1 : 0)])) {
        let s = c; i++;
        while (i < src.length && /[0-9.]/.test(src[i])) s += src[i++];
        t.push({ k: "num", v: parseFloat(s) }); continue;
      }
      if (/[A-Za-z_]/.test(c)) {
        let s = "";
        while (i < src.length && /[A-Za-z0-9_]/.test(src[i])) s += src[i++];
        t.push({ k: "id", v: s }); continue;
      }
      if ("().,[]".includes(c)) { t.push({ k: c }); i++; continue; }
      throw new Error(`Unexpected character "${c}" in expression`);
    }
    return t;
  }

  const pad = (n, l = 2) => String(n).padStart(l, "0");
  function fmtDate(v, fmt = "yyyy-MM-ddTHH:mm:ssZ") {
    const d = v instanceof Date ? v : new Date(v);
    if (isNaN(d)) throw new Error(`"${v}" is not a valid date`);
    return fmt.replace(/yyyy|MM|dd|HH|mm|ss|fff/g, (m) => ({
      yyyy: d.getUTCFullYear(), MM: pad(d.getUTCMonth() + 1), dd: pad(d.getUTCDate()), HH: pad(d.getUTCHours()), mm: pad(d.getUTCMinutes()), ss: pad(d.getUTCSeconds()), fff: pad(d.getUTCMilliseconds(), 3),
    })[m]);
  }

  const FUNCS = {
    utcnow: (ctx, f) => (f ? fmtDate(new Date(), f) : new Date().toISOString()),
    formatdatetime: (ctx, v, f) => fmtDate(v, f),
    adddays: (ctx, v, n, f) => { const d = new Date(v); if (isNaN(d)) throw new Error(`"${v}" is not a valid date`); d.setUTCDate(d.getUTCDate() + Number(n)); return f ? fmtDate(d, f) : d.toISOString(); },
    addhours: (ctx, v, n, f) => { const d = new Date(v); d.setUTCHours(d.getUTCHours() + Number(n)); return f ? fmtDate(d, f) : d.toISOString(); },
    concat: (ctx, ...a) => a.map((x) => (x == null ? "" : String(x))).join(""),
    toupper: (ctx, s) => String(s).toUpperCase(),
    tolower: (ctx, s) => String(s).toLowerCase(),
    replace: (ctx, s, a, b) => String(s).split(String(a)).join(String(b)),
    substring: (ctx, s, st, len) => String(s).substr(Number(st), len === undefined ? undefined : Number(len)),
    split: (ctx, s, d) => String(s).split(String(d)),
    first: (ctx, a) => (Array.isArray(a) ? a[0] : String(a)[0]),
    last: (ctx, a) => (Array.isArray(a) ? a[a.length - 1] : String(a).slice(-1)),
    length: (ctx, a) => (a == null ? 0 : a.length),
    string: (ctx, v) => (typeof v === "object" ? JSON.stringify(v) : String(v)),
    int: (ctx, v) => parseInt(v, 10),
    add: (ctx, a, b) => Number(a) + Number(b),
    sub: (ctx, a, b) => Number(a) - Number(b),
    equals: (ctx, a, b) => a == b,
    if: (ctx, c, a, b) => (c && c !== "false" ? a : b),
    coalesce: (ctx, ...a) => a.find((x) => x !== null && x !== undefined && x !== ""),
    startswith: (ctx, s, p) => String(s).startsWith(String(p)),
    endswith: (ctx, s, p) => String(s).endsWith(String(p)),
    guid: () => (crypto.randomUUID ? crypto.randomUUID() : N.uid()),
    pipeline: (ctx) => ctx.pipeline,
    triggerbody: (ctx) => ctx.triggerBody || {},
    trigger: (ctx) => ctx.trigger || {},
    variables: (ctx, n) => { const v = ctx.variables || {}; if (!(n in v)) throw new Error(`The variable '${n}' is not declared in this pipeline.`); return v[n]; },
    activity: (ctx, n) => { const o = (ctx.outputs || {})[n]; if (o === undefined) throw new Error(`The output of activity '${n}' can't be referenced since it is either not an ancestor to the current activity or does not exist`); return { output: o }; },
    dataset: (ctx) => ctx.dataset || {},
    greater: (ctx, a, b) => cmp(a, b) > 0, greaterorequals: (ctx, a, b) => cmp(a, b) >= 0, less: (ctx, a, b) => cmp(a, b) < 0, lessorequals: (ctx, a, b) => cmp(a, b) <= 0,
    and: (ctx, ...a) => a.every(Boolean), or: (ctx, ...a) => a.some(Boolean), not: (ctx, a) => !a,
    empty: (ctx, a) => a == null || a === "" || (Array.isArray(a) && !a.length) || (typeof a === "object" && !Object.keys(a).length),
    mul: (ctx, a, b) => Number(a) * Number(b), div: (ctx, a, b) => (Number.isInteger(+a) && Number.isInteger(+b) ? Math.trunc(a / b) : a / b), mod: (ctx, a, b) => a % b,
    float: (ctx, v) => parseFloat(v), bool: (ctx, v) => v === true || /^true$/i.test(String(v)) || v === 1,
    contains: (ctx, c, v) => (Array.isArray(c) ? c.includes(v) : typeof c === "object" && c ? v in c : String(c).includes(String(v))),
    indexof: (ctx, s, v) => String(s).indexOf(String(v)), trim: (ctx, s) => String(s).trim(), json: (ctx, s) => JSON.parse(s), createarray: (ctx, ...a) => a,
    startofday: (ctx, v, f) => { const d = new Date(v); d.setUTCHours(0, 0, 0, 0); return f ? fmtDate(d, f) : d.toISOString(); },
  };
  function cmp(a, b) { const x = Number(a), y = Number(b); if (!isNaN(x) && !isNaN(y) && a !== "" && b !== "") return x - y; return String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0; }

  function evalExpr(src, ctx) {
    const t = tokenize(src);
    let p = 0;
    const peek = () => t[p], eat = (k) => { if (!t[p] || t[p].k !== k) throw new Error(`Expected "${k}" in expression "${src}"`); return t[p++]; };
    function primary() {
      const tk = t[p++];
      if (!tk) throw new Error(`Unexpected end of expression "${src}"`);
      if (tk.k === "str" || tk.k === "num") return tk.v;
      if (tk.k === "(") { const v = expr(); eat(")"); return v; }
      if (tk.k === "id") {
        if (tk.v === "true") return true;
        if (tk.v === "false") return false;
        if (tk.v === "null") return null;
        if (peek() && peek().k === "(") {
          p++;
          const args = [];
          if (peek() && peek().k !== ")") { args.push(expr()); while (peek() && peek().k === ",") { p++; args.push(expr()); } }
          eat(")");
          const fn = FUNCS[tk.v.toLowerCase()];
          if (!fn) throw new Error(`Unknown function "${tk.v}()"`);
          return fn(ctx, ...args);
        }
        throw new Error(`"${tk.v}" must be a function call, e.g. ${tk.v}()`);
      }
      throw new Error(`Unexpected "${tk.k}" in expression "${src}"`);
    }
    function expr() {
      let v = primary();
      while (peek() && (peek().k === "." || peek().k === "[")) {
        if (peek().k === ".") {
          p++;
          const id = eat("id").v;
          if (v == null) throw new Error(`Cannot read "${id}" of null in "${src}"`);
          const key = Object.keys(v).find((k) => k.toLowerCase() === id.toLowerCase());
          if (key === undefined) throw new Error(`Property "${id}" does not exist in "${src}"`);
          v = v[key];
        } else {
          p++; const k = expr(); eat("]");
          v = v == null ? undefined : v[k];
        }
      }
      return v;
    }
    const v = expr();
    if (p < t.length) throw new Error(`Unexpected trailing text in expression "${src}"`);
    return v;
  }

  /* Resolve a field value: "@expr" → value; "...@{expr}..." → interpolated string; "@@" → literal "@" */
  function resolve(val, ctx) {
    if (typeof val !== "string") return val;
    if (val.startsWith("@@")) return val.slice(1);
    if (val.startsWith("@") && !val.startsWith("@{")) return evalExpr(val.slice(1), ctx);
    return val.replace(/@\{([^}]*)\}/g, (m, e) => {
      const v = evalExpr(e, ctx);
      return v == null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
    });
  }
  function resolveDeep(obj, ctx) {
    if (Array.isArray(obj)) return obj.map((x) => resolveDeep(x, ctx));
    if (obj && typeof obj === "object") { const o = {}; for (const [k, v] of Object.entries(obj)) o[k] = resolveDeep(v, ctx); return o; }
    return resolve(obj, ctx);
  }

  /* ================= Activities ================= */
  const ACT = {
    copy: { label: "Copy data", icon: "copyact", desc: "Move data from a source to a sink (lake ↔ SQL)." },
    script: { label: "Script (SQL)", icon: "script", desc: "Run SQL against a database. Use it for ELT transformations." },
    dataflow: { label: "Data flow", icon: "flow", desc: "Visual transformation: filter, derive, join, aggregate, sort." },
    validate: { label: "Validate data", icon: "shield", desc: "Fail the pipeline when a data quality rule is broken." },
    delete: { label: "Delete files", icon: "erase", desc: "Remove files from the lake (cleanup, archive patterns)." },
    wait: { label: "Wait", icon: "wait", desc: "Pause for a number of seconds." },
  };

  function newActivity(type, existing = []) {
    let i = 1;
    const base = { copy: "Copy", script: "Script", dataflow: "DataFlow", validate: "Validate", delete: "Delete", wait: "Wait" }[type];
    while (existing.some((a) => a.name === base + i)) i++;
    const a = { name: base + i, type, continueOnError: false };
    if (type === "copy") Object.assign(a, { source: { linked: "", path: "", query: "" }, sink: { linked: "", table: "", path: "", mode: "overwrite" } });
    if (type === "script") Object.assign(a, { linked: "", sql: "" });
    if (type === "dataflow") Object.assign(a, { source: { linked: "", path: "", query: "" }, steps: [], sink: { linked: "", table: "", path: "", mode: "overwrite" } });
    if (type === "validate") Object.assign(a, { linked: "", table: "", rule: "rowcount_min", column: "", min: 1, sql: "" });
    if (type === "delete") Object.assign(a, { linked: "", path: "" });
    if (type === "wait") Object.assign(a, { seconds: 2 });
    return a;
  }

  const linkedOf = (fac, name) => {
    const ls = fac.linked.find((l) => l.name === name);
    if (!ls) throw new Error(name ? `Linked service "${name}" does not exist in this factory.` : "No linked service selected.");
    return ls;
  };

  /* Read from a source spec → {columns, rows, info} */
  function readSource(fac, src) {
    const ls = linkedOf(fac, src.linked);
    if (ls.type === "lake") {
      if (!src.path) throw new Error("Source path is empty. Enter container/folder/file.csv (wildcards like *.csv allowed).");
      const uri = `lake://${ls.target}/${src.path.replace(/^\/+/, "")}`;
      const d = S.readLake(uri);
      return { columns: d.columns, rows: d.rows, info: { filesRead: d.files.length, files: d.files, source: uri } };
    }
    const q = (src.query || "").trim() || (src.table ? `SELECT * FROM ${N.qid(src.table)}` : "");
    if (!q) throw new Error("Source query is empty. Enter a SELECT statement or a table name.");
    const r = S.runSQL(ls.target, /^\s*select|^\s*with/i.test(q) ? q : `SELECT * FROM ${N.qid(q)}`);
    const last = r.results[r.results.length - 1];
    return { columns: last ? last.columns : [], rows: last ? last.values : [], info: { source: `sql://${ls.target}`, query: q } };
  }

  function writeSink(fac, sink, columns, rows) {
    const ls = linkedOf(fac, sink.linked);
    if (ls.type === "sql") {
      if (!sink.table) throw new Error("Sink table name is empty.");
      const db = S.db(ls.target);
      const n = S.loadTable(db, sink.table, columns, rows, sink.mode || "overwrite");
      S.markDb(ls.target);
      return { rowsWritten: n, sink: `sql://${ls.target}/${sink.table}`, mode: sink.mode || "overwrite" };
    }
    if (!sink.path) throw new Error("Sink path is empty. Enter container/folder/file.csv");
    const uri = `lake://${ls.target}/${sink.path.replace(/^\/+/, "")}`;
    S.writeLake(uri, columns, rows);
    return { rowsWritten: rows.length, sink: uri };
  }

  /* Build data flow SQL from steps */
  function buildFlowSQL(scratch, steps, ctxTables) {
    const ctes = ["s0 AS (SELECT * FROM src)"];
    const colsOf = (k) => {
      const st = scratch.prepare(`WITH ${ctes.join(", ")} SELECT * FROM s${k}`);
      const c = st.getColumnNames(); st.free(); return c;
    };
    steps.forEach((s, i) => {
      const prev = `s${i}`, cur = `s${i + 1}`;
      let body;
      switch (s.type) {
        case "filter": if (!s.expr) throw new Error(`Step ${i + 1} (filter) has no condition.`); body = `SELECT * FROM ${prev} WHERE ${s.expr}`; break;
        case "derive": {
          if (!s.name || !s.expr) throw new Error(`Step ${i + 1} (derived column) needs a column name and an expression.`);
          const cols = colsOf(i);
          body = cols.includes(s.name)
            ? `SELECT ${cols.map((c) => (c === s.name ? `(${s.expr}) AS ${N.qid(c)}` : N.qid(c))).join(", ")} FROM ${prev}`
            : `SELECT *, (${s.expr}) AS ${N.qid(s.name)} FROM ${prev}`;
          break;
        }
        case "select": if (!s.cols) throw new Error(`Step ${i + 1} (select) has no columns.`); body = `SELECT ${s.cols} FROM ${prev}`; break;
        case "aggregate": {
          if (!s.aggs) throw new Error(`Step ${i + 1} (aggregate) needs at least one aggregate, e.g. SUM(amount) AS revenue.`);
          body = s.groupBy ? `SELECT ${s.groupBy}, ${s.aggs} FROM ${prev} GROUP BY ${s.groupBy}` : `SELECT ${s.aggs} FROM ${prev}`;
          break;
        }
        case "join": {
          const rt = ctxTables["j" + i];
          if (!rt) throw new Error(`Step ${i + 1} (join) has no right-hand source.`);
          if (!s.on) throw new Error(`Step ${i + 1} (join) needs a condition, e.g. l.product_id = r.product_id`);
          const left = colsOf(i);
          const rs = scratch.prepare(`SELECT * FROM ${N.qid(rt)}`); const right = rs.getColumnNames(); rs.free();
          const extra = right.filter((c) => !left.includes(c)).map((c) => `r.${N.qid(c)}`);
          body = `SELECT l.*${extra.length ? ", " + extra.join(", ") : ""} FROM ${prev} AS l ${s.how === "left" ? "LEFT" : "INNER"} JOIN ${N.qid(rt)} AS r ON ${s.on}`;
          break;
        }
        case "sort": if (!s.by) throw new Error(`Step ${i + 1} (sort) has no sort columns.`); body = `SELECT * FROM ${prev} ORDER BY ${s.by}`; break;
        case "distinct": body = `SELECT DISTINCT * FROM ${prev}`; break;
        default: throw new Error(`Unknown step type "${s.type}"`);
      }
      ctes.push(`${cur} AS (\n  ${body}\n)`);
      colsOf(i + 1); // validates the step early, so errors name the step
    });
    return `WITH ${ctes.join(",\n")}\nSELECT * FROM s${steps.length}`;
  }

  async function execLegacy(fac, a, ctx) {
    switch (a.type) {
      case "wait": await N.sleep(Math.min(30, Number(a.seconds) || 0) * 1000); return { waitedSeconds: Number(a.seconds) || 0 };
      case "copy": {
        const src = readSource(fac, a.source);
        const w = writeSink(fac, a.sink, src.columns, src.rows);
        return { ...src.info, rowsRead: src.rows.length, ...w, columns: src.columns };
      }
      case "script": {
        const ls = linkedOf(fac, a.linked);
        if (ls.type !== "sql") throw new Error("Script activities need a SQL database linked service.");
        if (!a.sql || !a.sql.trim()) throw new Error("The script is empty.");
        const r = S.runSQL(ls.target, a.sql);
        const last = r.results[r.results.length - 1];
        return { database: ls.target, resultSets: r.results.length, rowsAffected: r.changes, firstRows: last ? { columns: last.columns, values: last.values.slice(0, 10) } : null };
      }
      case "dataflow": {
        const src = readSource(fac, a.source);
        const scratch = new S.SQL.Database();
        try {
          S.loadTable(scratch, "src", src.columns, src.rows, "overwrite");
          const extra = {};
          (a.steps || []).forEach((s, i) => {
            if (s.type === "join") {
              const r = readSource(fac, s.source || {});
              S.loadTable(scratch, "j" + i, r.columns, r.rows, "overwrite");
              extra["j" + i] = "j" + i;
            }
          });
          const sql = buildFlowSQL(scratch, a.steps || [], extra);
          const res = scratch.exec(sql);
          const st = scratch.prepare(sql); const columns = st.getColumnNames(); st.free();
          const rows = res.length ? res[0].values : [];
          const w = writeSink(fac, a.sink, columns, rows);
          return { ...src.info, rowsRead: src.rows.length, ...w, columns, generatedSql: sql };
        } finally { scratch.close(); }
      }
      case "validate": {
        const ls = linkedOf(fac, a.linked);
        if (ls.type !== "sql") throw new Error("Validate activities check a table in a SQL database.");
        const db = S.db(ls.target), t = N.qid(a.table || "");
        if (!a.table && a.rule !== "custom") throw new Error("Choose the table to validate.");
        let bad, detail;
        if (a.rule === "rowcount_min") {
          const n = db.exec(`SELECT COUNT(*) FROM ${t}`)[0].values[0][0];
          if (n < Number(a.min || 1)) throw new Error(`Row count check failed: ${a.table} has ${n} rows, expected at least ${a.min}.`);
          return { check: "row count", rows: n, min: Number(a.min || 1), passed: true };
        }
        if (a.rule === "not_null") { bad = db.exec(`SELECT COUNT(*) FROM ${t} WHERE ${N.qid(a.column)} IS NULL OR TRIM(${N.qid(a.column)}) = ''`)[0].values[0][0]; detail = `${bad} rows have an empty ${a.column}`; }
        else if (a.rule === "unique") { bad = db.exec(`SELECT COUNT(*) FROM (SELECT ${N.qid(a.column)} FROM ${t} GROUP BY ${N.qid(a.column)} HAVING COUNT(*) > 1)`)[0].values[0][0]; detail = `${bad} values of ${a.column} appear more than once`; }
        else {
          if (!a.sql) throw new Error("Custom rule needs a query that returns the number of bad rows.");
          const r = S.runSQL(ls.target, a.sql); bad = r.results.length ? Number(r.results[r.results.length - 1].values[0][0]) : 0; detail = `custom rule found ${bad} bad rows`;
        }
        if (bad > 0) throw new Error(`Data quality check failed: ${detail}.`);
        return { check: a.rule, badRows: 0, passed: true };
      }
      case "delete": {
        const ls = linkedOf(fac, a.linked);
        if (ls.type !== "lake") throw new Error("Delete activities need a lake linked service.");
        const { acct, cont, path } = S.parseLake(`lake://${ls.target}/${a.path}`);
        const files = S.matchFiles(acct, cont, path);
        files.forEach((f) => S.deleteFile(acct, cont, f));
        return { filesDeleted: files.length, files };
      }
    }
    throw new Error("Unknown activity type " + a.type);
  }


  N.engine = { evalExpr, resolve, resolveDeep, ACT, newActivity, execLegacy, readSource, writeSink, buildFlowSQL, fmtDate };
})(window.N);
