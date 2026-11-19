/* Nimbus Portal — pipeline factory blades: author, linked services, triggers, monitor */
(function (N) {
  const S = N.store, E = N.engine, esc = N.esc, I = N.icon;

  N.resourceTabs.factory = [
    { id: "overview", label: "Overview", icon: "info", render: overview },
    { group: "Author" },
    { id: "author", label: "Pipelines", icon: "factory", render: author },
    { id: "linked", label: "Linked services", icon: "link", render: linked },
    { id: "triggers", label: "Triggers", icon: "trigger", render: triggers },
    { group: "Monitor" },
    { id: "monitor", label: "Pipeline runs", icon: "monitor", render: (res, r) => N.monitorBlade(r, res.name), live: ["runs"] },
  ];
  const fac = (res) => S.state.factories[res.name];

  function overview(res) {
    const f = fac(res);
    const runs = S.state.runs.filter((x) => x.factory === res.name);
    const ok = runs.filter((x) => x.status === "Succeeded").length, bad = runs.filter((x) => x.status === "Failed").length;
    return {
      html: `<div class="blade">${N.overview(res, [
        ["Pipelines", f.pipelines.length], ["Linked services", f.linked.length], ["Triggers", `${f.triggers.length} (${f.triggers.filter((t) => t.enabled).length} enabled)`],
        ["Runs", `${runs.length} total · <span class="ok-text">${ok} succeeded</span> · <span class="bad-text">${bad} failed</span>`],
      ], `<p>The building blocks: <b>linked services</b> (connections) → <b>activities</b> (steps that read, transform and write) → <b>pipelines</b> (ordered activities with parameters) → <b>triggers</b> (when to run) → <b>monitor</b> (what happened).</p>`)}
      <div class="btn-row"><button class="btn btn-primary" data-go='${esc(JSON.stringify({ view: "resource", id: res.id, tab: "author" }))}'>Author pipelines</button><button class="btn" data-go='${esc(JSON.stringify({ view: "resource", id: res.id, tab: "linked" }))}'>Linked services</button></div></div>`,
      mount: (root) => N.mountOverview(root, res),
    };
  }

  /* ---------------- linked services ---------------- */
  function linked(res) {
    const f = fac(res);
    return {
      html: `<div class="blade"><div class="blade-head"><h1>Linked services</h1><p class="muted">Named connections that activities use. Swap a linked service to point the same pipeline at dev or prod.</p></div>
        ${N.cmdbar([{ icon: "plus", label: "New", id: "new-ls" }])}
        ${f.linked.length ? `<div class="table-wrap"><table class="list"><thead><tr><th>Name</th><th>Type</th><th>Connects to</th><th>Authentication</th><th></th></tr></thead><tbody>${f.linked.map((l, i) => `<tr><td>${I("link")} <b>${esc(l.name)}</b></td><td>${l.type === "lake" ? "Lake storage" : "SQL database"}</td><td><code>${esc(l.type === "lake" ? "lake://" + l.target : l.target + ".sql.nimbus.local")}</code>${(l.type === "lake" ? S.res("storage", l.target) : S.res("sqldb", l.target)) ? "" : ` <span class="pill pill-bad">missing</span>`}</td><td class="muted">Managed identity</td><td class="right"><button class="btn btn-sm" data-test="${i}">Test connection</button> <button class="icon-btn" data-del="${i}" aria-label="Delete ${esc(l.name)}">${I("trash")}</button></td></tr>`).join("")}</tbody></table></div>`
          : `<div class="empty"><p>No linked services. Add one for your lake and one for your SQL database.</p></div>`}</div>`,
      mount(root) {
        root.querySelector("#new-ls").onclick = () => {
          const lakes = S.resOfType("storage"), dbs = S.resOfType("sqldb");
          N.modal({
            title: "New linked service",
            body: `<div class="field"><label for="lt">Type</label><select id="lt"><option value="lake">Lake storage</option><option value="sql">SQL database</option></select></div>
              <div class="field"><label for="ln">Name</label><input id="ln" value="ls_lake" autocomplete="off"></div>
              <div class="field"><label for="lg">Account / database</label><select id="lg"></select></div>
              <div class="field"><label>Authentication</label><select disabled><option>System-assigned managed identity</option></select></div>`,
            onMount(w) {
              const sync = () => {
                const t = w.querySelector("#lt").value, list = t === "lake" ? lakes : dbs;
                w.querySelector("#lg").innerHTML = list.length ? list.map((x) => `<option>${esc(x.name)}</option>`).join("") : `<option value="">No ${t === "lake" ? "storage accounts" : "databases"} exist yet</option>`;
                const ln = w.querySelector("#ln"); if (/^ls_(lake|sql)\d*$/.test(ln.value)) ln.value = t === "lake" ? "ls_lake" : "ls_sql";
              };
              w.querySelector("#lt").onchange = sync; sync();
            },
            actions: [{ label: "Create", kind: "primary", onClick: (c, w) => {
              const name = w.querySelector("#ln").value.trim(), type = w.querySelector("#lt").value, target = w.querySelector("#lg").value;
              if (!/^[A-Za-z][\w]{0,59}$/.test(name)) { N.toast("Name must start with a letter: letters, digits and underscores.", "error"); return false; }
              if (f.linked.some((l) => l.name === name)) { N.toast("That name is taken.", "error"); return false; }
              if (!target) { N.toast("Create the target resource first.", "error"); return false; }
              f.linked.push({ name, type, target }); S.log("Create linked service", res.name + "/" + name); S.changed("resource"); N.rerender();
            } }, { label: "Cancel" }],
          });
        };
        root.querySelectorAll("[data-test]").forEach((b) => (b.onclick = () => {
          const l = f.linked[+b.dataset.test];
          const ok = l.type === "lake" ? !!S.res("storage", l.target) : !!S.res("sqldb", l.target);
          N.toast(ok ? `Connection to ${l.target} successful` : `Connection failed: ${l.target} does not exist`, ok ? "success" : "error");
        }));
        root.querySelectorAll("[data-del]").forEach((b) => (b.onclick = async () => {
          const l = f.linked[+b.dataset.del];
          if (await N.confirmDialog("Delete linked service", `Activities that use <b>${esc(l.name)}</b> will fail until you pick another.`)) { f.linked.splice(+b.dataset.del, 1); S.changed("resource"); N.rerender(); }
        }));
      },
    };
  }

  /* ---------------- triggers ---------------- */
  function triggers(res) {
    const f = fac(res);
    return {
      html: `<div class="blade"><div class="blade-head"><h1>Triggers</h1><p class="muted">Triggers run pipelines automatically. They work while this portal tab is open.</p></div>
        ${N.cmdbar([{ icon: "plus", label: "New", id: "new-trg" }])}
        ${f.triggers.length ? `<div class="table-wrap"><table class="list"><thead><tr><th>Name</th><th>Type</th><th>Pipeline</th><th>Condition</th><th>Status</th><th></th></tr></thead><tbody>${f.triggers.map((t, i) => `<tr><td>${I(t.type === "schedule" ? "clock" : "bolt")} <b>${esc(t.name)}</b></td><td>${t.type === "schedule" ? "Schedule" : "Storage event"}</td><td>${esc(t.pipeline)}</td><td class="muted">${t.type === "schedule" ? `Every ${t.everyMinutes} min` : `Blob created in <code>${esc(t.container)}/${esc(t.prefix || "")}*${esc(t.suffix || "")}</code>`}${Object.keys(t.params || {}).length ? `<br>Params: ${Object.entries(t.params).map(([k, v]) => `<code>${esc(k)}=${esc(v)}</code>`).join(" ")}` : ""}</td>
          <td>${N.statusPill(t.enabled ? "Started" : "Stopped")}</td><td class="right nowrap"><button class="btn btn-sm" data-tog="${i}">${t.enabled ? "Stop" : "Start"}</button> ${t.type === "schedule" ? `<button class="btn btn-sm" data-fire="${i}">Fire now</button>` : ""} <button class="icon-btn" data-del="${i}" aria-label="Delete trigger">${I("trash")}</button></td></tr>`).join("")}</tbody></table></div>`
          : `<div class="empty"><p>No triggers yet.</p></div>`}</div>`,
      mount(root) {
        root.querySelector("#new-trg").onclick = () => newTrigger(res);
        root.querySelectorAll("[data-tog]").forEach((b) => (b.onclick = () => { const t = f.triggers[+b.dataset.tog]; t.enabled = !t.enabled; t.lastFired = Date.now(); S.changed("resource"); N.rerender(); }));
        root.querySelectorAll("[data-fire]").forEach((b) => (b.onclick = () => { E.fireTrigger(res.name, f.triggers[+b.dataset.fire], {}); N.toast("Trigger fired", "success"); }));
        root.querySelectorAll("[data-del]").forEach((b) => (b.onclick = async () => { if (await N.confirmDialog("Delete trigger", "The pipeline stays; only the trigger is removed.")) { f.triggers.splice(+b.dataset.del, 1); S.changed("resource"); N.rerender(); } }));
      },
    };
  }

  function newTrigger(res, plName) {
    const f = fac(res);
    if (!f.pipelines.length) { N.toast("Create a pipeline first.", "error"); return; }
    const lakes = f.linked.filter((l) => l.type === "lake");
    N.modal({
      title: "New trigger",
      body: `<div class="field"><label for="tn">Name</label><input id="tn" value="trg_${esc((plName || f.pipelines[0].name).replace(/^pl_/, ""))}" autocomplete="off"></div>
        <div class="field"><label for="tp">Pipeline</label><select id="tp">${f.pipelines.map((p) => `<option ${p.name === plName ? "selected" : ""}>${esc(p.name)}</option>`).join("")}</select></div>
        <div class="field"><label for="tt">Type</label><select id="tt"><option value="storage">Storage event: when a file is created</option><option value="schedule">Schedule: every N minutes</option></select></div>
        <div id="t-sched" hidden><div class="field"><label for="te">Every (minutes)</label><input id="te" type="number" min="1" value="5"></div></div>
        <div id="t-store"><div class="field"><label for="tl">Lake linked service</label><select id="tl">${lakes.length ? lakes.map((l) => `<option>${esc(l.name)}</option>`).join("") : `<option value="">Add a lake linked service first</option>`}</select></div>
          <div class="field"><label for="tc">Container</label><input id="tc" value="bronze" autocomplete="off"></div>
          <div class="field"><label for="tpre">Blob path begins with</label><input id="tpre" value="shopstream/orders/" autocomplete="off"></div>
          <div class="field"><label for="tsuf">Blob path ends with</label><input id="tsuf" value=".csv" autocomplete="off"></div></div>
        <div id="t-params"></div>`,
      onMount(w) {
        const sync = () => {
          const st = w.querySelector("#tt").value === "storage";
          w.querySelector("#t-sched").hidden = st; w.querySelector("#t-store").hidden = !st;
          const pl = f.pipelines.find((p) => p.name === w.querySelector("#tp").value);
          w.querySelector("#t-params").innerHTML = (pl.params || []).length ? `<h3 class="form-sec">Parameter values</h3><p class="muted">Expressions allowed, e.g. <code>@triggerBody().fileName</code></p>${pl.params.map((p) => `<div class="field"><label>${esc(p.name)}</label><input data-pn="${esc(p.name)}" value="${st && /file/i.test(p.name) ? "@triggerBody().fileName" : esc(p.default || "")}" autocomplete="off"></div>`).join("")}` : "";
        };
        w.querySelector("#tt").onchange = sync; w.querySelector("#tp").onchange = sync; sync();
      },
      actions: [{ label: "Create", kind: "primary", onClick: (c, w) => {
        const name = w.querySelector("#tn").value.trim(), type = w.querySelector("#tt").value;
        if (!name || f.triggers.some((t) => t.name === name)) { N.toast("Enter a unique trigger name.", "error"); return false; }
        const t = { name, type, pipeline: w.querySelector("#tp").value, enabled: true, params: {} };
        w.querySelectorAll("[data-pn]").forEach((i) => { if (i.value) t.params[i.dataset.pn] = i.value; });
        if (type === "schedule") { t.everyMinutes = Math.max(1, +w.querySelector("#te").value || 5); t.lastFired = Date.now(); }
        else {
          t.linked = w.querySelector("#tl").value; t.container = w.querySelector("#tc").value.trim(); t.prefix = w.querySelector("#tpre").value.trim(); t.suffix = w.querySelector("#tsuf").value.trim();
          if (!t.linked) { N.toast("Add a lake linked service first.", "error"); return false; }
        }
        f.triggers.push(t); S.log("Create trigger", res.name + "/" + name); S.changed("resource");
        N.toast(`Trigger ${name} started`, "success"); N.rerender();
      } }, { label: "Cancel" }],
    });
  }

  /* ---------------- author ---------------- */
  function author(res, r) {
    const f = fac(res);
    const pl = r.pl && f.pipelines.find((p) => p.name === r.pl);
    if (pl) return editor(res, r, f, pl);
    return {
      html: `<div class="blade"><div class="blade-head"><h1>Pipelines</h1></div>
        ${N.cmdbar([{ icon: "plus", label: "New pipeline", id: "new-pl" }, { icon: "code", label: "Import JSON", id: "imp" }])}
        ${f.linked.length < 2 ? `<div class="callout callout-warn">${I("info")} Pipelines read and write through linked services. <button class="link" data-go='${esc(JSON.stringify({ view: "resource", id: res.id, tab: "linked" }))}'>Add your lake and SQL database first.</button></div>` : ""}
        ${f.pipelines.length ? `<div class="table-wrap"><table class="list"><thead><tr><th>Name</th><th>Activities</th><th>Parameters</th><th>Last run</th></tr></thead><tbody>${f.pipelines.map((p) => { const last = S.state.runs.find((x) => x.factory === res.name && x.pipeline === p.name); return `<tr><td><button class="link res-link" data-go='${esc(JSON.stringify({ view: "resource", id: res.id, tab: "author", pl: p.name }))}'><span class="nav-ic">${I("factory")}</span><span>${esc(p.name)}</span></button></td><td>${p.activities.map((a) => esc(E.ACT[a.type].label)).join(" → ") || "<span class='muted'>empty</span>"}</td><td>${(p.params || []).map((x) => `<code>${esc(x.name)}</code>`).join(" ")}</td><td>${last ? N.statusPill(last.status) + ` <small class="muted">${N.fmtTime(last.start)}</small>` : "<span class='muted'>never</span>"}</td></tr>`; }).join("")}</tbody></table></div>`
          : `<div class="empty"><p>No pipelines yet. A pipeline is an ordered list of activities.</p></div>`}</div>`,
      mount(root) {
        root.querySelector("#new-pl").onclick = () => N.modal({
          title: "New pipeline", body: `<div class="field"><label for="pn">Name</label><input id="pn" value="pl_load_orders" autocomplete="off"><small class="muted">Convention: <code>pl_&lt;verb&gt;_&lt;thing&gt;</code></small></div>`,
          actions: [{ label: "Create", kind: "primary", onClick: (c, w) => {
            const n = w.querySelector("#pn").value.trim();
            if (!/^[A-Za-z][\w-]{0,99}$/.test(n)) { N.toast("Start with a letter; use letters, digits, - and _.", "error"); return false; }
            if (f.pipelines.some((p) => p.name === n)) { N.toast("A pipeline with that name exists.", "error"); return false; }
            f.pipelines.push({ name: n, params: [], activities: [] }); S.log("Create pipeline", res.name + "/" + n); S.changed("pipeline");
            N.go({ view: "resource", id: res.id, tab: "author", pl: n });
          } }, { label: "Cancel" }],
        });
        root.querySelector("#imp").onclick = () => N.modal({
          title: "Import pipeline JSON", wide: true, body: `<textarea id="pj" class="code" rows="16" placeholder='{"name":"pl_example","params":[],"activities":[]}'></textarea>`,
          actions: [{ label: "Import", kind: "primary", onClick: (c, w) => {
            try {
              const p = JSON.parse(w.querySelector("#pj").value);
              if (!p.name || !Array.isArray(p.activities)) throw new Error("JSON needs a name and an activities array.");
              p.activities.forEach((a) => { if (!E.ACT[a.type]) throw new Error(`Unknown activity type "${a.type}"`); });
              p.params = p.params || [];
              const i = f.pipelines.findIndex((x) => x.name === p.name);
              if (i >= 0) f.pipelines[i] = p; else f.pipelines.push(p);
              S.changed("pipeline"); N.go({ view: "resource", id: res.id, tab: "author", pl: p.name });
            } catch (e) { N.toast(e.message, "error"); return false; }
          } }, { label: "Cancel" }],
        });
      },
    };
  }

  function lakePathOptions(f) {
    const out = new Set();
    f.linked.filter((l) => l.type === "lake").forEach((l) => {
      const a = S.state.lake[l.target]; if (!a) return;
      for (const [cn, c] of Object.entries(a.containers)) {
        out.add(cn + "/");
        for (const p of Object.keys(c.files)) {
          out.add(cn + "/" + p);
          const dir = p.slice(0, p.lastIndexOf("/") + 1);
          if (dir) { out.add(cn + "/" + dir + "*.csv"); out.add(cn + "/" + dir + "*.json"); }
        }
      }
    });
    return [...out].sort();
  }
  function tableOptions(f) {
    const out = new Set();
    f.linked.filter((l) => l.type === "sql").forEach((l) => { try { S.tables(S.db(l.target)).forEach((t) => out.add(t.name)); } catch (e) {} });
    return [...out].sort();
  }

  function editor(res, r, f, pl) {
    const sel = r.sel === undefined ? (pl.activities.length ? 0 : -1) : r.sel;
    const a = pl.activities[sel];
    const lastRun = S.state.runs.find((x) => x.factory === res.name && x.pipeline === pl.name);
    const lsOpts = (type, cur) => `<option value="">Select…</option>` + f.linked.filter((l) => !type || l.type === type).map((l) => `<option ${l.name === cur ? "selected" : ""}>${esc(l.name)}</option>`).join("");
    const lsType = (name) => (f.linked.find((l) => l.name === name) || {}).type;

    const srcFields = (src, key) => {
      const t = lsType(src.linked);
      return `<div class="field"><label>Linked service</label><select data-k="${key}.linked" data-re="1">${lsOpts("", src.linked)}</select></div>
        ${t === "lake" ? `<div class="field"><label>File path in lake <small class="muted">container/folder/file · wildcards * allowed · expressions allowed</small></label><input data-k="${key}.path" value="${esc(src.path || "")}" list="dl-paths" placeholder="bronze/shopstream/orders/*.csv" autocomplete="off"></div>` : ""}
        ${t === "sql" ? `<div class="field"><label>Query or table name</label><textarea class="code" rows="3" data-k="${key}.query" placeholder="SELECT * FROM stg_orders">${esc(src.query || "")}</textarea></div>` : ""}
        ${!t ? `<p class="muted">Pick a linked service to choose a path or query.</p>` : ""}`;
    };
    const sinkFields = (snk, key) => {
      const t = lsType(snk.linked);
      return `<div class="field"><label>Linked service</label><select data-k="${key}.linked" data-re="1">${lsOpts("", snk.linked)}</select></div>
        ${t === "sql" ? `<div class="field"><label>Table name</label><input data-k="${key}.table" value="${esc(snk.table || "")}" list="dl-tables" placeholder="stg_orders" autocomplete="off"></div>
          <div class="field"><label>Write behaviour</label><select data-k="${key}.mode"><option value="overwrite" ${snk.mode !== "append" ? "selected" : ""}>Overwrite: drop and recreate the table</option><option value="append" ${snk.mode === "append" ? "selected" : ""}>Append: insert rows (new columns are added)</option></select></div>` : ""}
        ${t === "lake" ? `<div class="field"><label>File path <small class="muted">.csv or .json (JSON lines)</small></label><input data-k="${key}.path" value="${esc(snk.path || "")}" placeholder="gold/daily_revenue/daily_revenue.csv" autocomplete="off"></div>` : ""}`;
    };
    const STEP_T = { filter: "Filter", derive: "Derived column", select: "Select / rename", aggregate: "Aggregate", join: "Join", sort: "Sort", distinct: "Distinct" };
    const stepFields = (s, i) => {
      const k = `steps.${i}`;
      switch (s.type) {
        case "filter": return `<input data-k="${k}.expr" value="${esc(s.expr || "")}" placeholder="status IN ('completed','shipped')">`;
        case "derive": return `<div class="two"><input data-k="${k}.name" value="${esc(s.name || "")}" placeholder="column name, e.g. revenue"><input data-k="${k}.expr" value="${esc(s.expr || "")}" placeholder="quantity * unit_price"></div>`;
        case "select": return `<input data-k="${k}.cols" value="${esc(s.cols || "")}" placeholder="order_id, customer_id AS cust, revenue">`;
        case "aggregate": return `<div class="two"><input data-k="${k}.groupBy" value="${esc(s.groupBy || "")}" placeholder="group by: order_date"><input data-k="${k}.aggs" value="${esc(s.aggs || "")}" placeholder="SUM(revenue) AS revenue, COUNT(*) AS orders"></div>`;
        case "sort": return `<input data-k="${k}.by" value="${esc(s.by || "")}" placeholder="order_date DESC">`;
        case "distinct": return `<p class="muted">Removes duplicate rows.</p>`;
        case "join": {
          s.source = s.source || { linked: "", path: "", query: "" };
          const t = lsType(s.source.linked);
          return `<div class="two"><select data-k="${k}.source.linked" data-re="1">${lsOpts("", s.source.linked)}</select>${t === "lake" ? `<input data-k="${k}.source.path" value="${esc(s.source.path || "")}" list="dl-paths" placeholder="bronze/shopstream/products/products.csv">` : t === "sql" ? `<input data-k="${k}.source.query" value="${esc(s.source.query || "")}" placeholder="dim_product">` : `<span class="muted">Pick the right-hand source</span>`}</div>
            <div class="two"><select data-k="${k}.how"><option value="inner" ${s.how !== "left" ? "selected" : ""}>Inner join</option><option value="left" ${s.how === "left" ? "selected" : ""}>Left outer join</option></select><input data-k="${k}.on" value="${esc(s.on || "")}" placeholder="l.product_id = r.product_id"></div>`;
        }
      }
      return "";
    };

    let props = "";
    if (!a) {
      props = `<h3 class="form-sec">Pipeline parameters</h3><p class="muted">Parameters make one pipeline reusable. Reference them as <code>@pipeline().parameters.name</code> or inside text as <code>@{pipeline().parameters.name}</code>.</p>
        <table class="list params"><thead><tr><th>Name</th><th>Default value</th><th></th></tr></thead><tbody>${(pl.params || []).map((p, i) => `<tr><td><input data-pk="${i}.name" value="${esc(p.name)}" aria-label="Parameter name"></td><td><input data-pk="${i}.default" value="${esc(p.default || "")}" aria-label="Default value"></td><td><button class="icon-btn" data-pdel="${i}" aria-label="Remove parameter">${I("trash")}</button></td></tr>`).join("")}</tbody></table>
        <button class="btn btn-sm" id="add-param">${I("plus")} Add parameter</button>`;
    } else {
      const tabs = a.type === "copy" ? ["general", "source", "sink"] : a.type === "dataflow" ? ["general", "source", "steps", "sink"] : ["general", "settings"];
      const at = tabs.includes(r.atab) ? r.atab : tabs[1] || "general";
      let body = "";
      if (at === "general") body = `<div class="field"><label>Name</label><input data-k="name" value="${esc(a.name)}" autocomplete="off"></div><div class="field"><label class="check"><input type="checkbox" data-k="continueOnError" ${a.continueOnError ? "checked" : ""}> Continue the pipeline if this activity fails</label></div><p class="muted">${esc(E.ACT[a.type].desc)}</p>`;
      if (at === "source") body = srcFields(a.source, "source");
      if (at === "sink") body = sinkFields(a.sink, "sink");
      if (at === "steps") body = `<p class="muted">Each step reads the previous one. Expressions are SQL. In joins, the left side is <code>l</code> and the right is <code>r</code>.</p>
        <ol class="steps-ed">${(a.steps || []).map((s, i) => `<li><div class="step-head"><b>${i + 1}. ${STEP_T[s.type]}</b><span class="grow"></span><button class="icon-btn" data-smv="${i}:-1" aria-label="Move up">${I("back")}</button><button class="icon-btn rot" data-smv="${i}:1" aria-label="Move down">${I("back")}</button><button class="icon-btn" data-sdel="${i}" aria-label="Remove step">${I("trash")}</button></div>${stepFields(s, i)}</li>`).join("")}</ol>
        <select id="add-step" aria-label="Add step"><option value="">+ Add step…</option>${Object.entries(STEP_T).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}</select>`;
      if (at === "settings") {
        if (a.type === "script") body = `<div class="field"><label>SQL linked service</label><select data-k="linked">${lsOpts("sql", a.linked)}</select></div><div class="field"><label>Script <small class="muted">Several statements allowed. read_csv('lake://…') works here too.</small></label><textarea class="code" rows="12" data-k="sql" spellcheck="false" placeholder="DROP TABLE IF EXISTS dim_customer;&#10;CREATE TABLE dim_customer AS SELECT ...">${esc(a.sql || "")}</textarea></div>`;
        if (a.type === "validate") body = `<div class="field"><label>SQL linked service</label><select data-k="linked">${lsOpts("sql", a.linked)}</select></div>
          <div class="field"><label>Rule</label><select data-k="rule" data-re="1">${[["rowcount_min", "Row count at least N"], ["not_null", "Column has no nulls or blanks"], ["unique", "Column values are unique"], ["custom", "Custom SQL returns 0 bad rows"]].map(([v, l]) => `<option value="${v}" ${a.rule === v ? "selected" : ""}>${l}</option>`).join("")}</select></div>
          ${a.rule !== "custom" ? `<div class="field"><label>Table</label><input data-k="table" value="${esc(a.table || "")}" list="dl-tables" autocomplete="off"></div>` : ""}
          ${a.rule === "not_null" || a.rule === "unique" ? `<div class="field"><label>Column</label><input data-k="column" value="${esc(a.column || "")}" autocomplete="off"></div>` : ""}
          ${a.rule === "rowcount_min" ? `<div class="field"><label>Minimum rows</label><input type="number" data-k="min" value="${esc(a.min ?? 1)}"></div>` : ""}
          ${a.rule === "custom" ? `<div class="field"><label>Query returning the number of bad rows</label><textarea class="code" rows="4" data-k="sql" placeholder="SELECT COUNT(*) FROM stg_orders_raw WHERE quantity <= 0">${esc(a.sql || "")}</textarea></div>` : ""}`;
        if (a.type === "delete") body = `<div class="field"><label>Lake linked service</label><select data-k="linked">${lsOpts("lake", a.linked)}</select></div><div class="field"><label>Path or wildcard</label><input data-k="path" value="${esc(a.path || "")}" list="dl-paths" placeholder="silver/tmp/*.csv" autocomplete="off"></div>`;
        if (a.type === "wait") body = `<div class="field"><label>Seconds (max 30)</label><input type="number" min="0" max="30" data-k="seconds" value="${esc(a.seconds)}"></div>`;
      }
      props = `<div class="tabs small">${tabs.map((t) => `<button class="tab ${t === at ? "active" : ""}" data-atab="${t}">${t[0].toUpperCase() + t.slice(1)}</button>`).join("")}</div><div class="props-body">${body}</div>`;
    }

    const actStatus = (name) => { const x = lastRun && lastRun.activities.find((y) => y.name === name); return x ? x.status : null; };
    return {
      crumbs: [{ label: pl.name, route: r }],
      html: `<div class="pe">
        <div class="pe-head"><button class="icon-btn" data-go='${esc(JSON.stringify({ view: "resource", id: res.id, tab: "author" }))}' aria-label="Back to pipelines">${I("back")}</button>${I("factory")}<h1>${esc(pl.name)}</h1><span id="run-strip">${runStrip(res, pl)}</span></div>
        ${N.cmdbar([{ icon: "check", label: "Validate", id: "validate" }, { icon: "play", label: "Trigger now", id: "run" }, { icon: "trigger", label: "Add trigger", id: "trg" }, "|", { icon: "code", label: "JSON", id: "json" }, { icon: "tutor", label: "Review with tutor", id: "review" }, { icon: "trash", label: "Delete", id: "delete" }])}
        <div class="pe-body">
          <div class="pe-left">
            <div class="palette"><div class="pal-title">Activities</div>${Object.entries(E.ACT).map(([k, v]) => `<button class="pal-item" data-add="${k}" title="${esc(v.desc)}">${I(v.icon)}<span>${esc(v.label)}</span></button>`).join("")}</div>
          </div>
          <div class="pe-main">
            <div class="canvas">${pl.activities.length ? pl.activities.map((x, i) => { const st = actStatus(x.name); return `${i ? `<span class="arrow" aria-hidden="true"><svg viewBox="0 0 40 12"><path d="M0 6h34M30 1l6 5-6 5" fill="none" stroke="currentColor" stroke-width="1.5"/></svg><small>on success</small></span>` : ""}<div class="act ${i === sel ? "sel" : ""} ${st ? "st-" + st.toLowerCase() : ""}" data-sel="${i}" tabindex="0" role="button" aria-label="${esc(x.name)}"><div class="act-type">${I(E.ACT[x.type].icon)}${esc(E.ACT[x.type].label)}</div><div class="act-name">${esc(x.name)}</div>${st ? `<div class="act-st">${N.statusPill(st)}</div>` : ""}<div class="act-tools"><button class="icon-btn" data-mv="${i}:-1" aria-label="Move left">${I("back")}</button><button class="icon-btn rot180" data-mv="${i}:1" aria-label="Move right">${I("back")}</button><button class="icon-btn" data-del="${i}" aria-label="Delete activity">${I("trash")}</button></div></div>`; }).join("")
              : `<div class="canvas-empty">Add an activity from the left to start. Activities run left to right; if one fails, the rest are skipped.</div>`}
              <button class="pipe-props ${sel === -1 ? "sel" : ""}" data-sel="-1">${I("gear")} Pipeline parameters (${(pl.params || []).length})</button></div>
            <div class="props">${props}</div>
          </div>
        </div>
        <datalist id="dl-paths">${lakePathOptions(f).map((p) => `<option value="${esc(p)}">`).join("")}</datalist>
        <datalist id="dl-tables">${tableOptions(f).map((p) => `<option value="${esc(p)}">`).join("")}</datalist>
      </div>`,
      mount(root) {
        const setSel = (i, atab) => { r.sel = i; if (atab !== undefined) r.atab = atab; N.rerender(); };
        const persist = () => { S.save(); };
        root.querySelectorAll("[data-add]").forEach((b) => (b.onclick = () => { pl.activities.push(E.newActivity(b.dataset.add, pl.activities)); persist(); setSel(pl.activities.length - 1, "_"); }));
        root.querySelectorAll("[data-sel]").forEach((el) => {
          el.addEventListener("click", (e) => { if (e.target.closest(".act-tools")) return; setSel(+el.dataset.sel); });
          el.addEventListener("keydown", (e) => { if (e.key === "Enter") setSel(+el.dataset.sel); });
        });
        root.querySelectorAll("[data-mv]").forEach((b) => (b.onclick = () => { const [i, d] = b.dataset.mv.split(":").map(Number); const j = i + d; if (j < 0 || j >= pl.activities.length) return; [pl.activities[i], pl.activities[j]] = [pl.activities[j], pl.activities[i]]; persist(); setSel(j); }));
        root.querySelectorAll("[data-del]").forEach((b) => (b.onclick = () => { pl.activities.splice(+b.dataset.del, 1); persist(); setSel(Math.min(sel, pl.activities.length - 1)); }));
        root.querySelectorAll("[data-atab]").forEach((b) => (b.onclick = () => setSel(sel, b.dataset.atab)));
        /* bind data-k fields to the activity object (dotted paths) */
        root.querySelectorAll("[data-k]").forEach((el) => {
          const ev = el.tagName === "SELECT" || el.type === "checkbox" ? "change" : "input";
          el.addEventListener(ev, () => {
            const path = el.dataset.k.split(".");
            let o = a; for (let i = 0; i < path.length - 1; i++) o = o[path[i]] = o[path[i]] || {};
            const last = path[path.length - 1];
            const old = o[last];
            o[last] = el.type === "checkbox" ? el.checked : el.type === "number" ? Number(el.value) : el.value;
            if (last === "name" && path.length === 1) {
              if (pl.activities.some((x) => x !== a && x.name === el.value)) { N.toast("Activity names must be unique.", "error"); o[last] = old; return; }
              root.querySelector(`.act.sel .act-name`).textContent = el.value;
            }
            persist();
            if (el.dataset.re) N.rerender();
          });
        });
        root.querySelectorAll("[data-pk]").forEach((el) => el.addEventListener("input", () => { const [i, k] = el.dataset.pk.split("."); pl.params[+i][k] = el.value; persist(); }));
        root.querySelectorAll("[data-pdel]").forEach((b) => (b.onclick = () => { pl.params.splice(+b.dataset.pdel, 1); persist(); N.rerender(); }));
        const ap = root.querySelector("#add-param"); if (ap) ap.onclick = () => { pl.params = pl.params || []; pl.params.push({ name: "param" + (pl.params.length + 1), default: "" }); persist(); N.rerender(); };
        const as = root.querySelector("#add-step"); if (as) as.onchange = () => { if (!as.value) return; a.steps = a.steps || []; a.steps.push({ type: as.value }); persist(); N.rerender(); };
        root.querySelectorAll("[data-sdel]").forEach((b) => (b.onclick = () => { a.steps.splice(+b.dataset.sdel, 1); persist(); N.rerender(); }));
        root.querySelectorAll("[data-smv]").forEach((b) => (b.onclick = () => { const [i, d] = b.dataset.smv.split(":").map(Number); const j = i + d; if (j < 0 || j >= a.steps.length) return; [a.steps[i], a.steps[j]] = [a.steps[j], a.steps[i]]; persist(); N.rerender(); }));

        root.querySelector("#validate").onclick = () => {
          const issues = validatePipeline(f, pl);
          N.modal({ title: issues.length ? `${issues.length} issue${issues.length > 1 ? "s" : ""} found` : "Validation passed", body: issues.length ? `<ul class="issues">${issues.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : `<div class="callout callout-ok">${I("check")} The pipeline has no configuration errors. Runtime errors (missing files, bad SQL) only show when it runs.</div>`, actions: [{ label: "Close" }] });
        };
        root.querySelector("#run").onclick = () => triggerNow(res, pl);
        root.querySelector("#trg").onclick = () => newTrigger(res, pl.name);
        root.querySelector("#review").onclick = () => N.askTutor(`Review this pipeline from my Nimbus pipeline factory (concepts mirror Azure Data Factory). Point out bugs, missing best practices (idempotency, incremental loading, data quality) and suggest one improvement.\n\nLinked services: ${JSON.stringify(f.linked)}\n\nPipeline JSON:\n${JSON.stringify(pl, null, 2).slice(0, 12000)}`);
        root.querySelector("#delete").onclick = async () => {
          if (await N.confirmDialog(`Delete ${pl.name}`, "Triggers that point at it will stop working.")) {
            f.pipelines.splice(f.pipelines.indexOf(pl), 1); S.changed("pipeline"); N.go({ view: "resource", id: res.id, tab: "author" });
          }
        };
        root.querySelector("#json").onclick = () => N.modal({
          title: `${pl.name} JSON`, wide: true,
          body: `<p class="muted">Pipelines are stored as JSON. In real projects this JSON lives in Git. You can edit it here.</p><textarea id="pj" class="code" rows="22" spellcheck="false">${esc(JSON.stringify(pl, null, 2))}</textarea>`,
          actions: [{ label: "Apply", kind: "primary", onClick: (c, w) => {
            try {
              const p = JSON.parse(w.querySelector("#pj").value);
              if (!Array.isArray(p.activities)) throw new Error("activities must be an array");
              p.activities.forEach((x) => { if (!E.ACT[x.type]) throw new Error(`Unknown activity type "${x.type}"`); });
              Object.keys(pl).forEach((k) => delete pl[k]); Object.assign(pl, p, { name: pl.name || p.name });
              pl.params = pl.params || [];
              S.changed("pipeline"); r.pl = pl.name; N.rerender();
            } catch (e) { N.toast("Invalid JSON: " + e.message, "error"); return false; }
          } }, { label: "Copy", onClick: (c, w) => { N.copyText(w.querySelector("#pj").value); return false; } }, { label: "Close" }],
        });
      },
    };
  }

  function runStrip(res, pl) {
    const last = S.state.runs.find((x) => x.factory === res.name && x.pipeline === pl.name);
    if (!last) return `<span class="muted">Not run yet</span>`;
    return `${N.statusPill(last.status)} <button class="link" data-go='${esc(JSON.stringify({ view: "resource", id: res.id, tab: "monitor", run: last.id }))}'>Last run ${N.fmtTime(last.start)}</button>`;
  }
  /* keep the editor's status strip and activity badges fresh without re-rendering forms */
  S.on((what) => {
    if (what !== "runs") return;
    const r = N.route();
    if (r.view !== "resource" || r.tab !== "author" || !r.pl) return;
    const res = S.resById(r.id); if (!res) return;
    const pl = fac(res).pipelines.find((p) => p.name === r.pl); if (!pl) return;
    const strip = document.getElementById("run-strip"); if (strip) strip.innerHTML = runStrip(res, pl);
    const last = S.state.runs.find((x) => x.factory === res.name && x.pipeline === pl.name);
    document.querySelectorAll(".canvas .act").forEach((el, i) => {
      const a = pl.activities[i]; if (!a || !last) return;
      const x = last.activities.find((y) => y.name === a.name);
      el.className = el.className.replace(/\bst-\w+/g, "").trim() + (x ? " st-" + x.status.toLowerCase() : "");
      let s = el.querySelector(".act-st");
      if (x) { if (!s) { s = document.createElement("div"); s.className = "act-st"; el.insertBefore(s, el.querySelector(".act-tools")); } s.innerHTML = N.statusPill(x.status); }
    });
  });

  function validatePipeline(f, pl) {
    const issues = [];
    if (!pl.activities.length) issues.push("The pipeline has no activities.");
    const lsT = (n) => (f.linked.find((l) => l.name === n) || {}).type;
    const names = new Set();
    pl.activities.forEach((a) => {
      const p = `${a.name}: `;
      if (names.has(a.name)) issues.push(p + "duplicate activity name."); names.add(a.name);
      if (a.type === "copy" || a.type === "dataflow") {
        if (!lsT(a.source.linked)) issues.push(p + "source linked service is missing.");
        else if (lsT(a.source.linked) === "lake" && !a.source.path) issues.push(p + "source path is empty.");
        else if (lsT(a.source.linked) === "sql" && !a.source.query) issues.push(p + "source query is empty.");
        if (!lsT(a.sink.linked)) issues.push(p + "sink linked service is missing.");
        else if (lsT(a.sink.linked) === "sql" && !a.sink.table) issues.push(p + "sink table is empty.");
        else if (lsT(a.sink.linked) === "lake" && !a.sink.path) issues.push(p + "sink path is empty.");
      }
      if (a.type === "dataflow") (a.steps || []).forEach((s, i) => {
        const need = { filter: ["expr"], derive: ["name", "expr"], select: ["cols"], aggregate: ["aggs"], sort: ["by"], join: ["on"] }[s.type] || [];
        need.forEach((k) => { if (!s[k]) issues.push(`${p}step ${i + 1} (${s.type}) is missing "${k}".`); });
      });
      if (a.type === "script" && (lsT(a.linked) !== "sql" || !a.sql)) issues.push(p + "needs a SQL linked service and a script.");
      if (a.type === "validate" && lsT(a.linked) !== "sql") issues.push(p + "needs a SQL linked service.");
      if (a.type === "delete" && (lsT(a.linked) !== "lake" || !a.path)) issues.push(p + "needs a lake linked service and a path.");
      const json = JSON.stringify(a);
      (json.match(/pipeline\(\)\.parameters\.(\w+)/g) || []).forEach((m) => { const n = m.split(".").pop(); if (!(pl.params || []).some((x) => x.name === n)) issues.push(`${p}uses parameter "${n}" which is not defined.`); });
    });
    return [...new Set(issues)];
  }

  function triggerNow(res, pl) {
    const issues = validatePipeline(fac(res), pl);
    const go = (params) => {
      E.runPipeline(res.name, pl.name, params).catch((e) => N.toast(e.message, "error"));
      N.toast(`Started ${pl.name}`, "info");
    };
    if (!(pl.params || []).length && !issues.length) return go({});
    N.modal({
      title: `Trigger ${pl.name}`,
      body: `${issues.length ? `<div class="callout callout-warn"><b>Validation found ${issues.length} issue${issues.length > 1 ? "s" : ""}</b><ul class="issues">${issues.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>You can still run it and read the error.</div>` : ""}
        ${(pl.params || []).map((p) => `<div class="field"><label>${esc(p.name)}</label><input data-pn="${esc(p.name)}" value="${esc(p.default || "")}" autocomplete="off"></div>`).join("")}`,
      actions: [{ label: "Run", kind: "primary", onClick: (c, w) => { const ps = {}; w.querySelectorAll("[data-pn]").forEach((i) => (ps[i.dataset.pn] = i.value)); go(ps); } }, { label: "Cancel" }],
    });
  }

  /* ---------------- Monitor (shared by factory tab and global Monitor) ---------------- */
  N.monitorBlade = (r, facName) => {
    const runs = S.state.runs.filter((x) => !facName || x.factory === facName);
    if (r.run) {
      const run = S.state.runs.find((x) => x.id === r.run);
      if (run) return runDetail(r, run);
    }
    const filt = r.status || "All";
    const shown = runs.filter((x) => filt === "All" || x.status === filt || (filt === "InProgress" && x.status === "Queued"));
    return {
      html: `<div class="blade"><div class="blade-head"><h1>Pipeline runs</h1><p class="muted">Every run with its trigger, duration and status. Open a run to see each activity's input, output and error.</p></div>
        <div class="filter-row">${["All", "Succeeded", "Failed", "InProgress"].map((s) => `<button class="chip ${s === filt ? "active" : ""}" data-st="${s}">${s === "InProgress" ? "In progress" : s} <small>${s === "All" ? runs.length : runs.filter((x) => x.status === s).length}</small></button>`).join("")}</div>
        ${shown.length ? `<div class="table-wrap"><table class="list"><thead><tr><th>Pipeline</th>${facName ? "" : "<th>Factory</th>"}<th>Run start</th><th>Duration</th><th>Triggered by</th><th>Status</th><th>Run ID</th></tr></thead><tbody>
          ${shown.map((x) => `<tr class="clickable" data-run="${x.id}"><td><button class="link">${esc(x.pipeline)}</button></td>${facName ? "" : `<td>${esc(x.factory)}</td>`}<td>${N.fmtTime(x.start)}</td><td>${N.fmtDur((x.end || Date.now()) - x.start)}</td><td>${esc(x.trigger.name)} <small class="muted">${esc(x.trigger.type)}</small></td><td>${N.statusPill(x.status)}</td><td><code class="muted">${esc(x.id)}</code></td></tr>`).join("")}
        </tbody></table></div>` : `<div class="empty-note">No runs${filt !== "All" ? " with this status" : ""}.</div>`}</div>`,
      mount(root) {
        root.querySelectorAll("[data-st]").forEach((b) => (b.onclick = () => { r.status = b.dataset.st; N.rerender(); }));
        root.querySelectorAll("[data-run]").forEach((tr) => (tr.onclick = () => N.go({ ...r, run: tr.dataset.run })));
      },
    };
  };

  function runDetail(r, run) {
    if (run.status === "Failed") S.flag("monitor-failed");
    const res = S.res("factory", run.factory);
    return {
      crumbs: [{ label: "Run " + run.id.slice(0, 8), route: r }],
      html: `<div class="blade">
        <div class="pe-head"><button class="icon-btn" id="back-runs" aria-label="Back to runs">${I("back")}</button><h1>${esc(run.pipeline)}</h1>${N.statusPill(run.status)}</div>
        ${N.cmdbar([{ icon: "refresh", label: "Rerun", id: "rerun", disabled: !res }, res ? { icon: "edit", label: "Open pipeline", go: { view: "resource", id: res.id, tab: "author", pl: run.pipeline } } : null, run.status === "Failed" ? { icon: "tutor", label: "Explain failure", id: "explain" } : null])}
        <table class="kv essentials"><tr><th>Run ID</th><td><code>${esc(run.id)}</code></td></tr><tr><th>Factory</th><td>${esc(run.factory)}</td></tr><tr><th>Triggered by</th><td>${esc(run.trigger.name)} (${esc(run.trigger.type)})</td></tr>
          <tr><th>Start</th><td>${N.fmtTime(run.start)}</td></tr><tr><th>Duration</th><td>${N.fmtDur((run.end || Date.now()) - run.start)}</td></tr>
          <tr><th>Parameters</th><td>${Object.keys(run.params || {}).length ? Object.entries(run.params).map(([k, v]) => `<code>${esc(k)} = ${esc(v)}</code>`).join("<br>") : "<span class='muted'>none</span>"}</td></tr></table>
        ${run.error ? `<div class="callout callout-error"><b>Error</b><p>${esc(run.error)}</p></div>` : ""}
        <h2 class="sec-title">Activity runs</h2>
        <div class="table-wrap"><table class="list"><thead><tr><th>Activity</th><th>Type</th><th>Status</th><th>Duration</th><th>Rows</th><th>Details</th></tr></thead><tbody>
          ${run.activities.map((a, i) => `<tr><td><b>${esc(a.name)}</b></td><td>${esc(E.ACT[a.type] ? E.ACT[a.type].label : a.type)}</td><td>${N.statusPill(a.status)}</td><td>${a.end ? N.fmtDur(a.end - a.start) : "—"}</td><td>${a.output && a.output.rowsWritten !== undefined ? `${a.output.rowsRead ?? "?"} → ${a.output.rowsWritten}` : a.output && a.output.rowsAffected !== undefined ? a.output.rowsAffected + " affected" : ""}</td>
            <td class="nowrap">${a.input ? `<button class="btn btn-sm" data-io="${i}:input">Input</button>` : ""} ${a.output ? `<button class="btn btn-sm" data-io="${i}:output">Output</button>` : ""} ${a.error ? `<button class="btn btn-sm btn-danger-soft" data-io="${i}:error">Error</button>` : ""}</td></tr>`).join("")}
        </tbody></table></div></div>`,
      mount(root) {
        root.querySelector("#back-runs").onclick = () => { const x = { ...r }; delete x.run; N.go(x); };
        const rr = root.querySelector("#rerun");
        if (rr) rr.onclick = () => { E.runPipeline(run.factory, run.pipeline, run.params, { type: "Manual", name: "Rerun of " + run.id.slice(0, 8) }).then((nr) => { if (N.route().run === run.id) N.go({ ...r, run: nr.id }, { replace: true }); }); N.toast("Rerun started", "info"); };
        const ex = root.querySelector("#explain");
        if (ex) ex.onclick = () => { const fa = run.activities.find((a) => a.status === "Failed"); N.askTutor(`My Nimbus pipeline run failed (concepts mirror Azure Data Factory).\nPipeline: ${run.pipeline}\nFailed activity: ${fa && fa.name} (${fa && fa.type})\nError: ${run.error}\nActivity input:\n${JSON.stringify(fa && fa.input, null, 2).slice(0, 6000)}\n\nExplain the cause and how to fix it.`); };
        root.querySelectorAll("[data-io]").forEach((b) => (b.onclick = () => {
          const [i, k] = b.dataset.io.split(":"); const a = run.activities[+i];
          if (k === "output" && a.type === "dataflow") S.flag("viewed-flow-sql");
          const val = k === "error" ? a.error : a[k];
          N.modal({ title: `${a.name} · ${k}`, wide: true, body: k === "output" && val.generatedSql ? `<div class="snippet"><b>Generated SQL</b><pre>${esc(val.generatedSql)}</pre></div><pre class="json">${esc(JSON.stringify({ ...val, generatedSql: undefined }, null, 2))}</pre>` : `<pre class="json">${esc(typeof val === "string" ? val : JSON.stringify(val, null, 2))}</pre>`, actions: [{ label: "Close" }] });
        }));
      },
    };
  }

  N.views.monitor = (r) => {
    const out = N.monitorBlade(r, null);
    return { live: ["runs"], crumbs: [{ label: "Monitor", route: { view: "monitor" } }, ...(out.crumbs || [])], html: out.html, mount: out.mount };
  };
})(window.N);
