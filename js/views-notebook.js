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
      html: `<div class="blade">${N.overview(res, [["Pricing tier", esc(res.props.tier || "Standard")], ["Notebooks", list.length], ["Languages", "SQL, Markdown"], ["Compute", "In-browser session per notebook"]],
        `<p>Real workspaces attach notebooks to a Spark cluster and support Python and Scala. Here every notebook gets its own in-browser SQL session, which is enough to practise Spark SQL patterns: reading files, CTEs, joins and window functions.</p>`)}
        <div class="btn-row"><button class="btn btn-primary" data-go='${esc(JSON.stringify({ view: "resource", id: res.id, tab: "notebooks" }))}'>Open notebooks</button></div></div>`,
      mount: (root) => N.mountOverview(root, res),
    };
  }

  function starterCells(acct) {
    const a = acct || "<account>";
    return [
      { type: "md", src: "# Explore ShopStream\nThis notebook reads raw files straight from the lake. Run a cell with **Ctrl+Enter** or the play button. Tables you create live in this notebook's session until you restart it." },
      { type: "sql", src: `-- How many orders per day, and how much money?\nSELECT date(order_ts) AS day,\n       COUNT(*) AS orders,\n       ROUND(SUM(quantity * unit_price * (1 - discount_pct / 100.0)), 2) AS revenue\nFROM read_csv('lake://${a}/bronze/shopstream/orders/*.csv')\nGROUP BY day\nORDER BY day;` },
      { type: "sql", src: `-- Clickstream: JSON lines. Nested device.type becomes device_type.\nSELECT event_type, device_type, COUNT(*) AS events\nFROM read_json('lake://${a}/bronze/shopstream/events/*.json')\nGROUP BY event_type, device_type\nORDER BY events DESC;` },
      { type: "sql", src: `-- Session table for later cells\nCREATE TABLE orders AS\nSELECT * FROM read_csv('lake://${a}/bronze/shopstream/orders/*.csv');\n\nCREATE TABLE products AS\nSELECT * FROM read_csv('lake://${a}/bronze/shopstream/products/products.csv');\n\nSELECT COUNT(*) AS orders_loaded FROM orders;` },
      { type: "sql", src: `-- Window function: rank products by revenue inside each category\nWITH rev AS (\n  SELECT p.category, p.product_name,\n         ROUND(SUM(o.quantity * o.unit_price), 2) AS revenue\n  FROM orders o JOIN products p ON p.product_id = o.product_id\n  WHERE o.status IN ('completed', 'shipped')\n  GROUP BY p.category, p.product_name\n)\nSELECT category, product_name, revenue,\n       RANK() OVER (PARTITION BY category ORDER BY revenue DESC) AS rank_in_category\nFROM rev\nORDER BY category, rank_in_category;` },
      { type: "sql", src: `%%write lake://${a}/silver/events/events_clean.csv\n-- The first line saves this cell's result to the lake (silver zone)\nSELECT event_id, ts AS event_ts, session_id, customer_id,\n       LOWER(event_type) AS event_type, page, device_type, device_os\nFROM read_json('lake://${a}/bronze/shopstream/events/*.json')\nWHERE event_id IS NOT NULL;` },
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

  function runCell(nb, cell) {
    if (cell.type !== "sql") return;
    let src = cell.src;
    let write = null;
    const m = src.match(/^\s*%%write\s+(\S+)\s*\n?/);
    if (m) { write = m[1]; src = src.slice(m[0].length); }
    const t0 = performance.now();
    try {
      if (!src.trim()) throw new Error("The cell is empty.");
      const r = S.runSQL(session(nb), src);
      N.sqlFlags(src);
      if (/read_(csv|json|lake)\s*\(/i.test(src)) S.flag("nb-readlake");
      let note = "";
      if (write) {
        const last = r.results[r.results.length - 1];
        if (!last) throw new Error("%%write needs the cell to end with a SELECT that returns rows.");
        if (/^sql:\/\//i.test(write)) {
          const [dbName, table] = write.replace(/^sql:\/\//i, "").split("/");
          if (!table) throw new Error("Use %%write sql://<database>/<table>");
          S.loadTable(S.db(dbName), table, last.columns, last.values, "overwrite"); S.markDb(dbName);
        } else S.writeLake(write, last.columns, last.values);
        S.flag("nb-write");
        note = `<div class="callout callout-ok">${I("check")} Wrote ${last.values.length} rows to <code>${esc(write)}</code></div>`;
      }
      outputs[cell.id] = note + N.resultsHtml(r);
      cell.ran = { ok: true, ms: Math.round(performance.now() - t0), t: Date.now() };
    } catch (e) {
      outputs[cell.id] = `<div class="callout callout-error"><b>Error</b><p>${esc(e.message)}</p><button class="btn btn-sm" data-explain="${cell.id}">${I("tutor")} Ask tutor why</button></div>`;
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
        <div class="nb-help muted">Helpers: <code>read_csv('lake://…')</code>, <code>read_json('lake://…')</code>, <code>read_table('db.table')</code>. First line <code>%%write lake://acct/container/file.csv</code> or <code>%%write sql://db/table</code> saves the result.</div>
        <div class="cell-add top"><button class="btn btn-xs" data-addsql="-1">+ SQL</button><button class="btn btn-xs" data-addmd="-1">+ Markdown</button></div>
        <div id="cells">${nb.cells.map(cellHtml).join("")}</div></div>`,
      mount(root) {
        const save = () => { nb.modified = Date.now(); S.save(); };
        const rerender = () => N.rerender();
        const findCell = (id) => nb.cells.find((c) => c.id === id);
        const doRun = (id) => {
          const c = findCell(id); runCell(nb, c); save();
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
        root.querySelector("#runall").onclick = () => { for (const c of nb.cells) if (c.type === "sql") { runCell(nb, c); if (c.ran && !c.ran.ok) break; } save(); rerender(); };
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
