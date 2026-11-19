/* Nimbus Portal — analytics workspace & notebooks */
(function (N) {
  const S = N.store, esc = N.esc, I = N.icon;
  const sessions = {};      // notebook id → SQL.Database (session state, not persisted, like a Spark session)
  const outputs = {};       // cell id → output html

  N.resourceTabs.workspace = [
    { id: "overview", label: "Overview", icon: "info", render: overview },
    { id: "notebooks", label: "Notebooks", icon: "workspace", render: notebooks },
  ];

  function overview(res) {
    const list = S.state.notebooks[res.name] || [];
    return {
      html: `<div class="blade">${N.overview(res, [["Pricing tier", esc(res.props.tier || "premium")], ["Workspace URL", `<code>${esc(N.armJson(res).properties.workspaceUrl)}</code>`], ["Notebooks", list.length], ["Languages", "SQL (Spark SQL dialect), Markdown"], ["Identity used for storage", `${esc(res.name)} (managed identity)`]],
        `<p>In Azure Databricks, notebooks attach to a cluster and run Python, Scala, R or SQL. Storage access goes through Unity Catalog: an <b>Access Connector for Azure Databricks</b> (a managed identity) gets <i>Storage Blob Data Contributor</i>, wrapped in a storage credential and an external location. Nimbus models that with the workspace's own identity, so give <b>${esc(res.name)}</b> a Storage Blob Data role on your lake.</p><p>Python is not available in Nimbus; Spark SQL covers the same transformations.</p>`)}
        <div class="btn-row"><button class="btn btn-primary" data-go='${esc(JSON.stringify({ view: "resource", id: res.id, tab: "notebooks" }))}'>Open notebooks</button></div></div>`,
      mount: (root) => N.mountOverview(root, res),
    };
  }

  function starterCells(acct) {
    const a = acct || "<account>";
    const p = (c, path) => `abfss://${c}@${a}.dfs.core.windows.net/${path}`;
    return [
      { type: "md", src: "# Explore ShopStream\nSpark SQL, Databricks dialect. Run a cell with **Ctrl+Enter**. Tables and views you create live in this notebook's session (like a cluster's Spark session) until you restart it.\n\nThe notebook reads storage as the workspace's managed identity, so that identity needs a **Storage Blob Data** role on the account." },
      { type: "sql", src: `-- CSV without header => true: Spark names columns _c0, _c1… and the header line becomes a data row.\nSELECT * FROM read_files('${p("bronze", "shopstream/orders/orders_2026-11-01.csv")}', format => 'csv')\nLIMIT 5;` },
      { type: "sql", src: `-- Orders and revenue per day across all daily files\nSELECT to_date(order_ts) AS day,\n       count(*) AS orders,\n       round(sum(quantity * unit_price * (1 - discount_pct / 100.0)), 2) AS revenue\nFROM read_files('${p("bronze", "shopstream/orders/")}', format => 'csv', header => true)\nGROUP BY to_date(order_ts)\nORDER BY day;` },
      { type: "sql", src: `-- JSON lines: device is a struct, read its fields with dot notation\nCREATE OR REPLACE TEMP VIEW events AS\nSELECT * FROM read_files('${p("bronze", "shopstream/events/")}', format => 'json');\n\nSELECT event_type, device.type AS device_type, count(*) AS events\nFROM events\nGROUP BY event_type, device.type\nORDER BY events DESC;` },
      { type: "sql", src: `-- Window function: rank products by revenue inside each category\nCREATE OR REPLACE TEMP VIEW orders AS\nSELECT * FROM read_files('${p("bronze", "shopstream/orders/")}', format => 'csv', header => true);\nCREATE OR REPLACE TEMP VIEW products AS\nSELECT * FROM read_files('${p("bronze", "shopstream/products/products.csv")}', format => 'csv', header => true);\n\nWITH rev AS (\n  SELECT p.category, p.product_name, round(sum(o.quantity * o.unit_price), 2) AS revenue\n  FROM orders o JOIN products p ON p.product_id = o.product_id\n  WHERE o.status IN ('completed', 'shipped')\n  GROUP BY p.category, p.product_name\n)\nSELECT category, product_name, revenue,\n       rank() OVER (PARTITION BY category ORDER BY revenue DESC) AS rank_in_category\nFROM rev\nORDER BY category, rank_in_category;` },
      { type: "sql", src: `-- Write a silver dataset. Spark writes a directory of part files plus _SUCCESS.\nINSERT OVERWRITE DIRECTORY '${p("silver", "events_clean")}'\nUSING CSV OPTIONS ('header' = 'true')\nSELECT event_id, ts AS event_ts, session_id, customer_id,\n       lower(event_type) AS event_type, page, device.type AS device_type, device.os AS device_os\nFROM events\nWHERE event_id IS NOT NULL;` },
    ];
  }

  function notebooks(res, r) {
    const list = S.state.notebooks[res.name];
    const nb = r.nb && list.find((x) => x.id === r.nb);
    if (nb) return editor(res, r, nb);
    return {
      html: `<div class="blade"><div class="blade-head"><h1>Notebooks</h1></div>
        ${N.cmdbar([{ icon: "plus", label: "Notebook", id: "new-nb" }])}
        ${list.length ? `<div class="table-wrap"><table class="list"><thead><tr><th>Name</th><th>Cells</th><th>Modified</th><th></th></tr></thead><tbody>${list.map((x) => `<tr><td><button class="link res-link" data-go='${esc(JSON.stringify({ view: "resource", id: res.id, tab: "notebooks", nb: x.id }))}'><span class="nav-ic">${I("workspace")}</span><span>${esc(x.name)}</span></button></td><td>${x.cells.length}</td><td class="muted">${N.fmtTime(x.modified)}</td><td class="right"><button class="icon-btn" data-del="${x.id}" aria-label="Delete notebook">${I("trash")}</button></td></tr>`).join("")}</tbody></table></div>`
          : `<div class="empty"><p>No notebooks yet. Start with the guided starter notebook.</p></div>`}</div>`,
      mount(root) {
        root.querySelector("#new-nb").onclick = () => N.modal({
          title: "New notebook",
          body: `<div class="field"><label for="nbn">Name</label><input id="nbn" value="explore_shopstream" autocomplete="off"></div><div class="field"><label class="check"><input type="checkbox" id="nbs" checked> Start from the ShopStream starter cells</label></div>`,
          actions: [{ label: "Create", kind: "primary", onClick: (c, w) => {
            const name = w.querySelector("#nbn").value.trim();
            if (!name) { N.toast("Enter a name.", "error"); return false; }
            const acct = (S.resOfType("storage")[0] || {}).name;
            const cells = (w.querySelector("#nbs").checked ? starterCells(acct) : [{ type: "sql", src: "SELECT 1 AS hello;" }]).map((x) => ({ ...x, id: N.uid("c") }));
            const nb = { id: N.uid("nb"), name, cells, modified: Date.now() };
            list.push(nb); S.log("Create notebook", res.name + "/" + name); S.changed("resource");
            N.go({ view: "resource", id: res.id, tab: "notebooks", nb: nb.id });
          } }, { label: "Cancel" }],
        });
        root.querySelectorAll("[data-del]").forEach((b) => (b.onclick = async () => {
          if (await N.confirmDialog("Delete notebook", "Its cells are deleted. Files it wrote to the lake stay.")) {
            const i = list.findIndex((x) => x.id === b.dataset.del); list.splice(i, 1); S.changed("resource"); N.rerender();
          }
        }));
      },
    };
  }

  function md(src) {
    let h = esc(src);
    h = h.replace(/```([\s\S]*?)```/g, (m, c) => `<pre>${c}</pre>`);
    h = h.replace(/^### (.*)$/gm, "<h4>$1</h4>").replace(/^## (.*)$/gm, "<h3>$1</h3>").replace(/^# (.*)$/gm, "<h2>$1</h2>");
    h = h.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/(^|[^*])\*(?!\s)(.+?)\*/g, "$1<i>$2</i>").replace(/`([^`]+)`/g, "<code>$1</code>");
    h = h.replace(/(?:^|\n)((?:- .*(?:\n|$))+)/g, (m, block) => `\n<ul>${block.trim().split("\n").map((l) => `<li>${l.slice(2)}</li>`).join("")}</ul>\n`);
    return h.split(/\n{2,}/).map((p) => (/^\s*<(h\d|ul|pre)/.test(p) ? p : `<p>${p.replace(/\n/g, "<br>")}</p>`)).join("");
  }

  function session(nb) {
    if (!sessions[nb.id]) sessions[nb.id] = new S.SQL.Database();
    return sessions[nb.id];
  }

  /* Parse abfss://container@account.dfs.core.windows.net/path or lake://account/container/path */
  function parsePath(p) {
    let m = /^abfss:\/\/([^@/]+)@([^./]+)\.dfs\.core\.windows\.net\/?(.*)$/i.exec(String(p).trim());
    if (m) return { cont: m[1], acct: m[2], path: m[3] };
    m = /^(?:lake:\/\/)([^/]+)\/([^/]+)\/?(.*)$/i.exec(String(p).trim());
    if (m) return { acct: m[1], cont: m[2], path: m[3] };
    const e = new Error(`[INVALID_PATH] Unsupported path '${p}'. Use abfss://<container>@<account>.dfs.core.windows.net/<path>`); e.isSpark = true; throw e;
  }
  const abfss = (x) => `abfss://${x.cont}@${x.acct}.dfs.core.windows.net/${x.path}`;
  function sparkCtx(res, nb) {
    const db = session(nb);
    let n = 0;
    return {
      load(path, opts) {
        const x = parsePath(path);
        if (!S.state.lake[x.acct] || !S.container(x.acct, x.cont)) { const e = new Error(`[PATH_NOT_FOUND] Path does not exist: ${abfss(x)}.`); e.isSpark = true; throw e; }
        S.checkLake(res.name, x.acct, x.cont, "read", "spark");
        const files = S.matchFiles(x.acct, x.cont, x.path).filter((f) => !/(^|\/)_[^/]*$/.test(f));
        if (!files.length) { const e = new Error(`[PATH_NOT_FOUND] Path does not exist: ${abfss(x)}.`); e.isSpark = true; throw e; }
        const fmt = (opts.format || S.formatOf(files[0])).toLowerCase();
        let columns = [], rows = [], structCols = [];
        for (const f of files) {
          const content = S.container(x.acct, x.cont).files[f].content;
          if (fmt === "json") {
            const objs = content.trim().startsWith("[") ? JSON.parse(content) : content.split(/\n+/).filter((l) => l.trim()).map((l) => JSON.parse(l));
            objs.forEach((o) => Object.keys(o).forEach((k) => { if (!columns.includes(k)) columns.push(k); if (o[k] && typeof o[k] === "object" && !structCols.includes(k)) structCols.push(k); }));
            objs.forEach((o) => rows.push(columns.map((c) => (o[c] === undefined ? null : o[c] && typeof o[c] === "object" ? JSON.stringify(o[c]) : o[c]))));
          } else {
            const lines = N.parseCSV(content);
            let cols = lines.columns, data = lines.rows.map((r) => cols.map((c) => r[c]));
            if (!opts.header) { data = [cols, ...data]; cols = cols.map((c, i) => "_c" + i); }
            cols.forEach((c) => { if (!columns.includes(c)) columns.push(c); });
            data.forEach((r) => rows.push(columns.map((c) => { const i = cols.indexOf(c); return i < 0 || r[i] === "" ? null : r[i]; })));
          }
        }
        const infer = fmt === "json" || opts.readFiles || opts.nimbus;
        const tmp = `__src_${++n}_${Math.random().toString(36).slice(2, 6)}`;
        const withRescue = opts.readFiles ? [...columns, "_rescued_data"] : columns;
        const types = withRescue.map((c, i) => (c === "_rescued_data" ? "TEXT" : infer && !structCols.includes(c) ? N.inferType(rows.slice(0, 2000).map((r) => r[i])) : "TEXT"));
        db.run(`CREATE TEMP TABLE ${tmp} (${withRescue.map((c, i) => `${N.qid(c)} ${types[i]}`).join(", ")})`);
        if (rows.length) {
          const st = db.prepare(`INSERT INTO temp.${tmp} VALUES (${withRescue.map(() => "?").join(",")})`);
          db.run("BEGIN");
          rows.forEach((r) => st.run(withRescue.map((c, i) => (c === "_rescued_data" ? null : N.coerce(r[i], types[i])))));
          db.run("COMMIT"); st.free();
        }
        return { table: `temp.${tmp}`, structCols };
      },
      loadTable(name) {
        const [dbName, tbl] = name.includes(".") ? name.split(".") : [null, name];
        if (!dbName || !S.res("sqldb", dbName)) { const e = new Error(`[TABLE_OR_VIEW_NOT_FOUND] read_table('${name}'): use 'database.table'. (Nimbus helper; in Databricks you would read Azure SQL over JDBC.)`); e.isSpark = true; throw e; }
        S.checkSqlNetwork(dbName, "azure"); S.checkSqlAuth(res.name, dbName, new Set(["read"]));
        const r = S.db(dbName).exec(`SELECT * FROM ${N.qid(tbl)}`);
        const tmp = `__tbl_${++n}`;
        const st = S.db(dbName).prepare(`SELECT * FROM ${N.qid(tbl)}`); const cols = st.getColumnNames(); st.free();
        S.loadTable(db, tmp, cols, r.length ? r[0].values : [], "overwrite");
        return tmp;
      },
      write(path, format, header, cols, rows) {
        const x = parsePath(path);
        if (!S.container(x.acct, x.cont)) { const e = new Error(`[PATH_NOT_FOUND] Container does not exist: ${abfss(x)}`); e.isSpark = true; throw e; }
        S.checkLake(res.name, x.acct, x.cont, "write", "spark");
        const dir = x.path.replace(/\/+$/, "");
        const c = S.container(x.acct, x.cont);
        Object.keys(c.files).filter((f) => f.startsWith(dir + "/") && !f.slice(dir.length + 1).includes("/")).forEach((f) => S.deleteFile(x.acct, x.cont, f));
        const id = crypto.randomUUID ? crypto.randomUUID() : N.uid();
        const body = format === "json" ? N.toJSONLines(cols, rows) : header ? N.toCSV(cols, rows) : N.toCSV(cols, rows).split("\n").slice(1).join("\n");
        S.putFile(x.acct, x.cont, `${dir}/part-00000-tid-${Math.abs(id.length * 7919)}-${id}-c000.${format === "json" ? "json" : "csv"}`, body, { source: "notebook" });
        S.putFile(x.acct, x.cont, `${dir}/_SUCCESS`, "", { source: "notebook", silent: true });
        S.flag("nb-write");
      },
    };
  }

  function runCell(res, nb, cell) {
    if (cell.type !== "sql") return;
    let src = cell.src;
    let write = null;
    const m = src.match(/^\s*%%write\s+(\S+)\s*\n?/);
    if (m) { write = m[1]; src = src.slice(m[0].length); }
    src = src.replace(/^\s*%sql\s*\n/, "");
    const t0 = performance.now();
    try {
      if (!src.trim()) throw new Error("The cell is empty.");
      const ctx = sparkCtx(res, nb);
      const r = N.spark.run(session(nb), src, ctx);
      N.sqlFlags(src);
      if (/read_files\s*\(|\b(csv|json)\s*\.\s*`/i.test(src) || /read_(csv|json)\s*\(/i.test(src)) S.flag("nb-readlake");
      let note = "";
      if (write) {
        const last = r.results[r.results.length - 1];
        if (!last) throw new Error("%%write needs the cell to end with a SELECT that returns rows.");
        if (/^sql:\/\//i.test(write)) {
          const [dbName, table] = write.replace(/^sql:\/\//i, "").split("/");
          S.checkSqlNetwork(dbName, "azure"); S.checkSqlAuth(res.name, dbName, new Set(["ddl", "write"]));
          S.loadTable(S.db(dbName), table, last.columns, last.values, "overwrite"); S.markDb(dbName);
        } else ctx.write(write.replace(/\/[^/]*\.(csv|json)$/i, ""), /\.json$/i.test(write) ? "json" : "csv", true, last.columns, last.values);
        S.flag("nb-write");
        note = `<div class="callout callout-ok">${I("check")} Wrote ${last.values.length} rows (Nimbus %%write helper; in Databricks use INSERT OVERWRITE DIRECTORY or df.write).</div>`;
      }
      const msg = r.messages.filter((x) => x !== "OK");
      outputs[cell.id] = note + (msg.length ? `<div class="callout callout-ok">${I("check")} ${esc(msg.join(" · "))}</div>` : "") + (r.results.length ? N.resultsHtml({ results: r.results, messages: [], ms: r.ms, changes: 0 }) : msg.length ? "" : `<div class="empty-note">OK</div>`);
      cell.ran = { ok: true, ms: Math.round(performance.now() - t0), t: Date.now() };
    } catch (e) {
      outputs[cell.id] = `<div class="callout callout-error"><b>${e.isSpark ? "AnalysisException" : "Error"}</b><pre class="json">${esc(e.message)}</pre><button class="btn btn-sm" data-explain="${cell.id}">${I("tutor")} Ask tutor why</button></div>`;
      cell.ran = { ok: false, ms: Math.round(performance.now() - t0), t: Date.now(), err: e.message };
    }
  }

  function editor(res, r, nb) {
    const cellHtml = (c, i) => `<div class="cell ${c.type}" data-cell="${c.id}">
      <div class="cell-gutter"><button class="icon-btn run-cell" data-run="${c.id}" aria-label="Run cell" ${c.type !== "sql" ? "hidden" : ""}>${I("play")}</button><small>${c.ran ? `[${c.ran.ok ? "✓" : "!"}]` : "[ ]"}</small></div>
      <div class="cell-body">
        <div class="cell-tools"><select data-type="${c.id}" aria-label="Cell type"><option value="sql" ${c.type === "sql" ? "selected" : ""}>SQL</option><option value="md" ${c.type === "md" ? "selected" : ""}>Markdown</option></select>
          ${c.ran && c.type === "sql" ? `<small class="muted">${c.ran.ms} ms</small>` : ""}<span class="grow"></span>
          <button class="icon-btn" data-up="${i}" aria-label="Move cell up">${I("back")}</button><button class="icon-btn rot" data-down="${i}" aria-label="Move cell down">${I("back")}</button><button class="icon-btn" data-delc="${i}" aria-label="Delete cell">${I("trash")}</button></div>
        ${c.type === "md" && !c.editing ? `<div class="md" data-edit="${c.id}" title="Double-click to edit">${md(c.src)}</div>` : `<textarea class="code cell-src" data-src="${c.id}" spellcheck="false" rows="${Math.max(2, c.src.split("\n").length)}">${esc(c.src)}</textarea>`}
        <div class="cell-out" id="out-${c.id}">${outputs[c.id] || ""}</div>
      </div></div>
      <div class="cell-add"><button class="btn btn-xs" data-addsql="${i}">+ SQL</button><button class="btn btn-xs" data-addmd="${i}">+ Markdown</button></div>`;
    return {
      crumbs: [{ label: nb.name, route: r }],
      html: `<div class="nb">
        <div class="pe-head"><button class="icon-btn" data-go='${esc(JSON.stringify({ view: "resource", id: res.id, tab: "notebooks" }))}' aria-label="Back to notebooks">${I("back")}</button>${I("workspace")}<h1>${esc(nb.name)}</h1><span class="pill pill-ok">Session ${sessions[nb.id] ? "active" : "idle"}</span></div>
        ${N.cmdbar([{ icon: "play", label: "Run all", id: "runall" }, { icon: "refresh", label: "Restart session", id: "restart" }, "|", { icon: "table", label: "Session tables", id: "tables" }, { icon: "tutor", label: "Ask tutor", id: "ask" }])}
        <div class="nb-help muted">Spark SQL (Databricks syntax). Read files with <code>read_files('abfss://container@account.dfs.core.windows.net/path', format =&gt; 'csv', header =&gt; true)</code>; write with <code>INSERT OVERWRITE DIRECTORY 'abfss://…' USING CSV OPTIONS ('header' = 'true') SELECT …</code>. The notebook runs as the workspace's managed identity (${esc(res.name)}).</div>
        <div class="cell-add top"><button class="btn btn-xs" data-addsql="-1">+ SQL</button><button class="btn btn-xs" data-addmd="-1">+ Markdown</button></div>
        <div id="cells">${nb.cells.map(cellHtml).join("")}</div></div>`,
      mount(root) {
        const save = () => { nb.modified = Date.now(); S.save(); };
        const rerender = () => N.rerender();
        const findCell = (id) => nb.cells.find((c) => c.id === id);
        const doRun = (id) => {
          const c = findCell(id); runCell(res, nb, c); save();
          const host = root.querySelector(`[data-cell="${id}"]`);
          if (host) { host.querySelector(".cell-out").innerHTML = outputs[id] || ""; host.querySelector(".cell-gutter small").textContent = c.ran ? `[${c.ran.ok ? "✓" : "!"}]` : "[ ]"; N.wireResults(host.querySelector(".cell-out")); wireExplain(host); }
        };
        const wireExplain = (scope) => scope.querySelectorAll("[data-explain]").forEach((b) => (b.onclick = () => { const c = findCell(b.dataset.explain); N.askTutor(`My notebook SQL cell failed (Nimbus sandbox, SQLite engine; helpers read_csv/read_json read lake files).\n\nCell:\n${c.src}\n\nError: ${c.ran && c.ran.err}\n\nExplain the cause and the fix.`); }));
        root.querySelectorAll(".cell-out").forEach((o) => N.wireResults(o));
        wireExplain(root);
        root.querySelectorAll("[data-src]").forEach((ta) => {
          const c = findCell(ta.dataset.src);
          const grow = () => { ta.style.height = "auto"; ta.style.height = ta.scrollHeight + 2 + "px"; };
          grow();
          N.codeEditor(ta, () => { if (c.type === "md") { c.editing = false; save(); rerender(); } else doRun(c.id); });
          ta.addEventListener("input", () => { c.src = ta.value; grow(); save(); });
          if (c.type === "md") ta.addEventListener("blur", () => { c.editing = false; save(); setTimeout(rerender, 0); });
        });
        root.querySelectorAll("[data-edit]").forEach((d) => d.addEventListener("dblclick", () => { findCell(d.dataset.edit).editing = true; rerender(); }));
        root.querySelectorAll("[data-run]").forEach((b) => (b.onclick = () => doRun(b.dataset.run)));
        root.querySelectorAll("[data-type]").forEach((s) => (s.onchange = () => { const c = findCell(s.dataset.type); c.type = s.value; c.editing = s.value === "md"; save(); rerender(); }));
        const addAt = (i, type) => { nb.cells.splice(i + 1, 0, { id: N.uid("c"), type, src: type === "md" ? "## Notes" : "", editing: type === "md" }); save(); rerender(); };
        root.querySelectorAll("[data-addsql]").forEach((b) => (b.onclick = () => addAt(+b.dataset.addsql, "sql")));
        root.querySelectorAll("[data-addmd]").forEach((b) => (b.onclick = () => addAt(+b.dataset.addmd, "md")));
        root.querySelectorAll("[data-delc]").forEach((b) => (b.onclick = () => { nb.cells.splice(+b.dataset.delc, 1); save(); rerender(); }));
        root.querySelectorAll("[data-up]").forEach((b) => (b.onclick = () => { const i = +b.dataset.up; if (i > 0) { [nb.cells[i - 1], nb.cells[i]] = [nb.cells[i], nb.cells[i - 1]]; save(); rerender(); } }));
        root.querySelectorAll("[data-down]").forEach((b) => (b.onclick = () => { const i = +b.dataset.down; if (i < nb.cells.length - 1) { [nb.cells[i + 1], nb.cells[i]] = [nb.cells[i], nb.cells[i + 1]]; save(); rerender(); } }));
        root.querySelector("#runall").onclick = () => { for (const c of nb.cells) if (c.type === "sql") { runCell(res, nb, c); if (c.ran && !c.ran.ok) break; } save(); rerender(); };
        root.querySelector("#restart").onclick = () => { if (sessions[nb.id]) { sessions[nb.id].close(); delete sessions[nb.id]; } nb.cells.forEach((c) => { delete outputs[c.id]; delete c.ran; }); save(); rerender(); N.toast("Session restarted. Session tables are gone; lake files remain.", "info"); };
        root.querySelector("#tables").onclick = () => {
          const t = sessions[nb.id] ? S.tables(sessions[nb.id]) : [];
          N.modal({ title: "Session tables", body: t.length ? `<table class="list"><thead><tr><th>Table</th><th>Rows</th><th>Columns</th></tr></thead><tbody>${t.map((x) => `<tr><td><code>${esc(x.name)}</code></td><td>${x.rows}</td><td class="muted">${esc(x.cols.map((c) => c.name).join(", "))}</td></tr>`).join("")}</tbody></table>` : `<p class="muted">No tables in this session yet. CREATE TABLE in a cell to make one.</p>`, actions: [{ label: "Close" }] });
        };
        root.querySelector("#ask").onclick = () => N.askTutor(`I'm working in a SQL notebook in the Nimbus sandbox. Here are my cells:\n\n${nb.cells.map((c, i) => `-- Cell ${i + 1} (${c.type})\n${c.src}`).join("\n\n").slice(0, 10000)}\n\nSuggest what I could explore next and point out mistakes.`);
      },
    };
  }
})(window.N);
