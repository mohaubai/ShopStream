/* Nimbus Portal — SQL database blades */
(function (N) {
  const S = N.store, esc = N.esc, I = N.icon;

  N.resourceTabs.sqldb = [
    { id: "overview", label: "Overview", icon: "info", render: overview },
    { id: "query", label: "Query editor", icon: "code", render: queryEditor },
    { id: "tables", label: "Tables", icon: "table", render: tablesView },
  ];

  N.sqlFlags = (sql) => {
    if (/read_(csv|json|lake)\s*\(/i.test(sql)) S.flag("sql-readlake");
    if (/group\s+by/i.test(sql)) S.flag("sql-groupby");
    if (/\bjoin\b/i.test(sql)) S.flag("sql-join");
    if (/\bover\s*\(/i.test(sql)) S.flag("window-fn");
  };

  function overview(res) {
    const db = S.db(res.name);
    const t = S.tables(db);
    const size = db.export().length;
    return {
      html: `<div class="blade">${N.overview(res, [
        ["Server name", `<code>${esc(res.name)}.sql.nimbus.local</code>`],
        ["Compute tier", esc(res.props.tier || "Serverless")],
        ["Engine", "SQLite 3 (in-browser)"],
        ["Tables / views", `${t.filter((x) => x.type === "table").length} / ${t.filter((x) => x.type === "view").length}`],
        ["Data size", N.fmtBytes(size)],
      ], `<p>SQL dialect note: this engine is SQLite. Azure SQL uses T-SQL, so <code>LIMIT 10</code> becomes <code>TOP 10</code> and <code>date('now')</code> becomes <code>GETDATE()</code>. Joins, CTEs, window functions and GROUP BY are the same.</p>`)}
      <div class="btn-row"><button class="btn btn-primary" data-go='${esc(JSON.stringify({ view: "resource", id: res.id, tab: "query" }))}'>Open query editor</button></div></div>`,
      mount: (root) => N.mountOverview(root, res),
    };
  }

  function tablesView(res) {
    const t = S.tables(S.db(res.name));
    return {
      html: `<div class="blade"><div class="blade-head"><h1>Tables</h1></div>
        ${t.length ? t.map((x) => `<details class="tbl-card"><summary>${I(x.type === "view" ? "filter" : "table")}<b>${esc(x.name)}</b><span class="muted">${x.type} · ${x.rows ?? "?"} rows · ${x.cols.length} columns</span></summary>
          <table class="list"><thead><tr><th>Column</th><th>Type</th><th>Key</th><th>Nullable</th></tr></thead><tbody>${x.cols.map((c) => `<tr><td><code>${esc(c.name)}</code></td><td>${esc(c.type)}</td><td>${c.pk ? "PK" : ""}</td><td>${c.notnull ? "No" : "Yes"}</td></tr>`).join("")}</tbody></table></details>`).join("")
          : `<div class="empty"><p>No tables yet. Create one in the query editor or load one with a pipeline.</p><button class="btn btn-primary" data-go='${esc(JSON.stringify({ view: "resource", id: res.id, tab: "query" }))}'>Open query editor</button></div>`}</div>`,
    };
  }

  const SNIPPETS = [
    ["Create a table", `CREATE TABLE IF NOT EXISTS regions (\n  region_id INTEGER PRIMARY KEY,\n  name      TEXT NOT NULL\n);\nINSERT INTO regions (region_id, name) VALUES (1, 'Africa'), (2, 'Europe'), (3, 'Americas');\nSELECT * FROM regions;`],
    ["Read lake files", (acct) => `-- read_csv() is a sandbox helper. It reads one file or a wildcard.\nSELECT status, COUNT(*) AS orders, ROUND(SUM(quantity * unit_price), 2) AS gross\nFROM read_csv('lake://${acct}/bronze/shopstream/orders/*.csv')\nGROUP BY status\nORDER BY orders DESC;`],
    ["Load lake → table", (acct) => `DROP TABLE IF EXISTS stg_products;\nCREATE TABLE stg_products AS\nSELECT * FROM read_csv('lake://${acct}/bronze/shopstream/products/products.csv');\nSELECT COUNT(*) AS rows_loaded FROM stg_products;`],
    ["Join + aggregate", `-- Needs fact_sales and dim_product (lab 5)\nSELECT p.category, ROUND(SUM(f.revenue), 2) AS revenue, COUNT(*) AS lines\nFROM fact_sales f\nJOIN dim_product p ON p.product_id = f.product_id\nGROUP BY p.category\nORDER BY revenue DESC;`],
    ["Window: running total", `-- Daily revenue with a running total\nWITH daily AS (\n  SELECT order_date, ROUND(SUM(revenue), 2) AS revenue\n  FROM fact_sales GROUP BY order_date\n)\nSELECT order_date, revenue,\n       ROUND(SUM(revenue) OVER (ORDER BY order_date), 2) AS running_total\nFROM daily ORDER BY order_date;`],
    ["Find duplicates", `SELECT order_id, COUNT(*) AS copies\nFROM stg_orders_raw\nGROUP BY order_id\nHAVING COUNT(*) > 1;`],
    ["List tables", `SELECT name, type FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name;`],
  ];

  const draftKey = (n) => "nimbus-sql-draft-" + n;
  function queryEditor(res, r) {
    const db = S.db(res.name);
    const acct = (S.resOfType("storage")[0] || { name: "<account>" }).name;
    let sql = N.pendingQuery || (() => { try { return localStorage.getItem(draftKey(res.name)); } catch (e) { return null; } })() || `-- Welcome to the query editor. Press Ctrl+Enter (Cmd+Enter) to run.\n-- Try the snippets menu, or query a lake file directly:\nSELECT *\nFROM read_csv('lake://${acct}/bronze/shopstream/customers/customers.csv')\nLIMIT 20;`;
    N.pendingQuery = null;
    const tables = S.tables(db);
    return {
      html: `<div class="qe">
        <aside class="qe-tree"><div class="qe-tree-head">${I("sql")}<b>${esc(res.name)}</b><button class="icon-btn" id="tree-refresh" aria-label="Refresh tables">${I("refresh")}</button></div>
          <div id="tree">${treeHtml(tables)}</div></aside>
        <div class="qe-main">
          <div class="qe-bar">
            <button class="btn btn-primary btn-sm" id="run">${I("play")} Run</button>
            <select id="snip" aria-label="Insert snippet"><option value="">Snippets…</option>${SNIPPETS.map((s, i) => `<option value="${i}">${esc(s[0])}</option>`).join("")}</select>
            <button class="btn btn-sm" id="clear">Clear</button>
            <span class="grow"></span>
            <button class="btn btn-sm" id="ask">${I("tutor")} Explain query</button>
          </div>
          <textarea id="sql" class="code editor" spellcheck="false" aria-label="SQL editor">${esc(sql)}</textarea>
          <div id="out" class="qe-out"><div class="empty-note">Results appear here.</div></div>
        </div></div>`,
      mount(root) {
        const ta = root.querySelector("#sql"), out = root.querySelector("#out");
        N.codeEditor(ta, () => run());
        ta.addEventListener("input", () => { try { localStorage.setItem(draftKey(res.name), ta.value); } catch (e) {} });
        const run = () => {
          const text = (ta.selectionStart !== ta.selectionEnd ? ta.value.slice(ta.selectionStart, ta.selectionEnd) : ta.value).trim();
          if (!text) return;
          out.innerHTML = `<div class="empty-note"><span class="spin"></span> Running…</div>`;
          setTimeout(() => {
            try {
              const r2 = S.runSQL(res.name, text);
              N.sqlFlags(text);
              out.innerHTML = resultsHtml(r2);
              wireResults(out, r2);
              root.querySelector("#tree").innerHTML = treeHtml(S.tables(db));
            } catch (e) {
              out.innerHTML = `<div class="callout callout-error"><b>Query failed</b><p>${esc(e.message)}</p><button class="btn btn-sm" id="explain-err">${I("tutor")} Ask tutor why</button></div>`;
              out.querySelector("#explain-err").onclick = () => N.askTutor(`My SQL query failed in the Nimbus SQLite query editor.\n\nQuery:\n${text}\n\nError: ${e.message}\n\nExplain what went wrong and how to fix it.`);
            }
          }, 30);
        };
        root.querySelector("#run").onclick = run;
        root.querySelector("#clear").onclick = () => { ta.value = ""; ta.focus(); };
        root.querySelector("#snip").onchange = (e) => {
          const s = SNIPPETS[+e.target.value]; if (!s) return;
          ta.value = typeof s[1] === "function" ? s[1](acct) : s[1]; e.target.value = ""; ta.focus();
        };
        root.querySelector("#ask").onclick = () => N.askTutor(`Explain this SQL step by step for a learner, and suggest one improvement:\n\n${ta.value}`);
        root.querySelector("#tree-refresh").onclick = () => (root.querySelector("#tree").innerHTML = treeHtml(S.tables(db)));
        root.querySelector("#tree").addEventListener("click", (e) => {
          const b = e.target.closest("[data-tbl]");
          if (b) { ta.value = `SELECT *\nFROM ${N.qid(b.dataset.tbl).replace(/^"([a-z_][a-z0-9_]*)"$/i, "$1")}\nLIMIT 100;`; run(); }
        });
      },
    };
  }

  function treeHtml(tables) {
    if (!tables.length) return `<div class="empty-note">No tables yet.</div>`;
    return tables.map((t) => `<details class="tree-node"><summary>${I(t.type === "view" ? "filter" : "table")}<span>${esc(t.name)}</span><small>${t.rows ?? ""}</small></summary>
      <button class="link tree-sel" data-tbl="${esc(t.name)}">Select top 100</button>
      <ul>${t.cols.map((c) => `<li><code>${esc(c.name)}</code> <small>${esc(c.type)}${c.pk ? " · PK" : ""}</small></li>`).join("")}</ul></details>`).join("");
  }

  N.resultsHtml = resultsHtml;
  function resultsHtml(r) {
    const msgs = [`Completed in ${r.ms} ms.`];
    if (r.loaded.length) r.loaded.forEach((l) => msgs.push(`${l.fn}('${l.arg}') read ${l.rows} rows${l.files ? ` from ${l.files.length} file${l.files.length > 1 ? "s" : ""}` : ""}.`));
    if (!r.results.length) msgs.push(r.changes ? `${r.changes} row(s) affected.` : "Statement executed. No result set.");
    const last = r.results[r.results.length - 1];
    return `<div class="tabs small"><button class="tab active" data-rt="res">Results${r.results.length ? ` (${last.values.length})` : ""}</button><button class="tab" data-rt="chart">Chart</button><button class="tab" data-rt="msg">Messages</button></div>
      <div data-rp="res">${r.results.length ? r.results.map((x, i) => `${r.results.length > 1 ? `<div class="rs-cap">Result set ${i + 1}</div>` : ""}${N.grid(x.columns, x.values)}`).join("") : `<div class="empty-note">${esc(msgs[msgs.length - 1])}</div>`}</div>
      <div data-rp="chart" hidden>${last ? N.barChart(last.columns, last.values) : `<div class="empty-note">Nothing to chart.</div>`}</div>
      <div data-rp="msg" hidden><pre class="msgs">${esc(msgs.join("\n"))}</pre></div>`;
  }
  N.wireResults = wireResults;
  function wireResults(out) {
    out.querySelectorAll("[data-rt]").forEach((t) => (t.onclick = () => {
      out.querySelectorAll("[data-rt]").forEach((x) => x.classList.toggle("active", x === t));
      out.querySelectorAll("[data-rp]").forEach((p) => (p.hidden = p.dataset.rp !== t.dataset.rt));
    }));
  }

  /* Small editor behaviours for any code textarea: Tab indents, Ctrl/Cmd+Enter runs */
  N.codeEditor = (ta, onRun) => {
    ta.addEventListener("keydown", (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); onRun && onRun(); return; }
      if (e.key === "Tab" && !e.shiftKey) {
        e.preventDefault();
        const s = ta.selectionStart, en = ta.selectionEnd;
        ta.value = ta.value.slice(0, s) + "  " + ta.value.slice(en);
        ta.selectionStart = ta.selectionEnd = s + 2;
        ta.dispatchEvent(new Event("input"));
      }
    });
  };
})(window.N);
