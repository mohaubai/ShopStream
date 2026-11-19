/* Nimbus Portal — Data Factory: portal blade + Studio (Home · Author · Monitor · Manage) */
(function (N) {
  const S = N.store, A = N.adf, E = N.engine, esc = N.esc, I = N.icon;
  const fac = (res) => S.state.factories[res.name];
  const J = (o) => esc(JSON.stringify(o));
  const studio = (res, extra = {}) => ({ view: "studio", id: res.id, ...extra });

  /* ================= Portal blade ================= */
  N.resourceTabs.factory = [
    { id: "overview", label: "Overview", icon: "info", render: overview },
    { group: "Settings" },
    { id: "identity", label: "Managed identities", icon: "key", render: identity, live: ["iam"] },
  ];
  function overview(res) {
    const f = fac(res);
    const runs = S.state.runs.filter((x) => x.factory === res.name && !x.debug);
    return {
      html: `<div class="blade">
        <div class="studio-cta"><span class="tile tile-lg" style="--hue:var(--t-factory)">${I("factory")}</span><div><b>Azure Data Factory Studio</b><p class="muted">Pipelines, datasets, data flows, triggers and monitoring live in Studio, a separate app. The portal only manages the factory resource itself.</p></div><button class="btn btn-primary" data-go='${J(studio(res, { hub: "home" }))}'>Launch studio</button></div>
        ${N.overview(res, [
          ["Version", "V2"], ["Pipelines (published)", f.published ? f.published.pipelines.length : 0], ["Unpublished changes", A.unpublished(f).length],
          ["Pipeline runs", `${runs.length} · <span class="ok-text">${runs.filter((r) => r.status === "Succeeded").length} succeeded</span> · <span class="bad-text">${runs.filter((r) => r.status === "Failed").length} failed</span>`],
          ["Managed identity", `System assigned · <code>${esc(res.props.identity ? res.props.identity.principalId : "")}</code>`],
        ], `<p>The factory's <b>system-assigned managed identity</b> has the same name as the factory. Grant it roles on storage and create it as a user in SQL databases; linked services then authenticate as it, with no secrets.</p>`)}</div>`,
      mount: (root) => N.mountOverview(root, res),
    };
  }
  function identity(res) {
    const mine = S.state.roles.filter((r) => r.principal === res.name);
    const users = S.resOfType("sqldb").filter((d) => (d.props.users || {})[res.name.toLowerCase()]);
    return {
      html: `<div class="blade"><div class="blade-head"><h1>Managed identities</h1></div>
        <div class="tabs"><span class="tab active">System assigned</span><span class="tab">User assigned</span></div>
        <table class="kv"><tr><th>Status</th><td>${N.statusPill("On")}</td></tr><tr><th>Object (principal) ID</th><td><code>${esc(res.props.identity.principalId)}</code></td></tr><tr><th>Display name</th><td>${esc(res.name)}</td></tr></table>
        <h2 class="sec-title">Azure role assignments</h2>
        ${mine.length ? `<div class="table-wrap"><table class="list"><thead><tr><th>Role</th><th>Scope</th><th>Added</th></tr></thead><tbody>${mine.map((r) => `<tr><td>${esc(r.role)}</td><td><code class="wrap">${esc(r.scope.split("/providers/").pop())}</code></td><td class="muted">${N.fmtTime(r.created)}</td></tr>`).join("")}</tbody></table></div>` : `<div class="empty-note">No role assignments. This identity cannot read or write any storage yet. Add one from the storage account's Access control (IAM) blade.</div>`}
        <h2 class="sec-title">Database users</h2>
        ${users.length ? `<ul>${users.map((d) => `<li><b>${esc(d.name)}</b>: ${esc((d.props.users[res.name.toLowerCase()].roles || []).join(", ") || "no roles")}</li>`).join("")}</ul>` : `<div class="empty-note">Not a user in any SQL database. Run <code>CREATE USER [${esc(res.name)}] FROM EXTERNAL PROVIDER;</code> in the database as the Entra admin.</div>`}</div>`,
    };
  }

  /* ================= Studio shell ================= */
  N.views.studio = (r) => {
    const res = S.resById(r.id);
    if (!res) return { html: `<div class="blade"><div class="empty"><p>This factory no longer exists.</p></div></div>` };
    const f = fac(res); f.__name = res.name;
    const hub = r.hub || "home";
    const pending = A.unpublished(f);
    const body = { home: hubHome, author: hubAuthor, monitor: hubMonitor, manage: hubManage }[hub](res, f, r);
    return {
      crumbs: [{ label: "Data factories", route: { view: "list", type: "factory" } }, { label: res.name, route: { view: "resource", id: res.id } }, { label: "Studio", route: r }],
      html: `<div class="studio">
        <div class="studio-top"><span class="st-brand">${I("factory")} Data Factory</span><span class="st-name">${esc(res.name)}</span><span class="grow"></span>
          <span class="st-mode">Live mode · no Git</span>
          <button class="btn btn-sm" id="st-validate">${I("check")} Validate all</button>
          <button class="btn btn-sm btn-primary" id="st-publish" ${pending.length ? "" : "disabled"}>Publish all${pending.length ? ` (${pending.length})` : ""}</button></div>
        <div class="studio-body">
          <nav class="hub-rail" aria-label="Studio hubs">${[["home", "home", "Home"], ["author", "edit", "Author"], ["monitor", "monitor", "Monitor"], ["manage", "gear", "Manage"]].map(([h, ic, l]) => `<button class="hub ${h === hub ? "active" : ""}" data-go='${J({ view: "studio", id: res.id, hub: h })}' title="${l}">${I(ic)}<span>${l}</span></button>`).join("")}</nav>
          <div class="hub-main">${body.html}</div>
        </div></div>`,
      mount(root) {
        root.querySelector("#st-publish").onclick = () => publishDialog(res, f);
        root.querySelector("#st-validate").onclick = () => {
          const issues = f.pipelines.flatMap((p) => A.validatePipeline(f, p).map((x) => `${p.name}: ${x}`));
          N.modal({ title: issues.length ? `Validation found ${issues.length} issue${issues.length > 1 ? "s" : ""}` : "Your factory has been validated. No errors were found.", body: issues.length ? `<ul class="issues">${issues.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : `<div class="callout callout-ok">${I("check")} No errors were found.</div>`, actions: [{ label: "Close" }] });
        };
        body.mount && body.mount(root);
      },
    };
  };
  Object.defineProperty(N.views.studio, "live", { get() { const r = N.route(); return r.hub === "monitor" ? ["runs"] : r.hub === "author" && !r.name ? ["pipeline"] : r.hub === "manage" ? ["iam"] : []; } });

  function publishDialog(res, f) {
    const pending = A.unpublished(f);
    N.modal({
      title: "Publish all", wide: true,
      body: `<p>Changes are saved as a draft. <b>Debug</b> runs your draft; <b>Trigger now</b> and triggers run only what is published. In a Git-connected factory, Publish would also generate the ARM template in the <code>adf_publish</code> branch.</p>
        <table class="list"><thead><tr><th>Type</th><th>Name</th><th>Change</th></tr></thead><tbody>${pending.map((p) => `<tr><td>${esc(p.kind.replace(/s$/, ""))}</td><td>${esc(p.name)}</td><td>${p.change === "deleted" ? `<span class="pill pill-bad">Deleted</span>` : p.change === "new" ? `<span class="pill pill-ok">New</span>` : `<span class="pill pill-run">Edited</span>`}</td></tr>`).join("")}</tbody></table>`,
      actions: [{ label: "Publish", kind: "primary", onClick: () => {
        const r = A.publish(res.name);
        if (!r.ok) { N.modal({ title: "Publishing failed", body: `<ul class="issues">${r.errors.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>`, actions: [{ label: "Close" }] }); return; }
        N.toast("Publishing completed", "success"); N.rerender();
      } }, { label: "Cancel" }],
    });
  }

  /* ================= Home hub ================= */
  function hubHome(res, f) {
    return {
      html: `<div class="hub-home"><h1>Let's get started</h1><p class="muted">Data Factory moves and transforms data with pipelines. Build in Author, run with Debug, Publish, then schedule with triggers and watch Monitor.</p>
        <div class="hh-tiles">
          <button class="hh-tile" data-go='${J({ view: "studio", id: res.id, hub: "manage", mtab: "linked" })}'>${I("link")}<b>Connect</b><span>Linked services: where data lives and how the factory signs in.</span></button>
          <button class="hh-tile" data-go='${J({ view: "studio", id: res.id, hub: "author" })}'>${I("edit")}<b>Author</b><span>Datasets, pipelines and data flows.</span></button>
          <button class="hh-tile" data-go='${J({ view: "studio", id: res.id, hub: "manage", mtab: "triggers" })}'>${I("trigger")}<b>Schedule</b><span>Schedule and storage event triggers.</span></button>
          <button class="hh-tile" data-go='${J({ view: "studio", id: res.id, hub: "monitor" })}'>${I("monitor")}<b>Monitor</b><span>Pipeline runs, activity inputs and outputs, trigger runs.</span></button>
        </div>
        <div class="learn-card">${I("book")}<div><b>Microsoft Learn</b><p>Every concept here has an official page: <a href="https://learn.microsoft.com/azure/data-factory/introduction" target="_blank" rel="noopener">What is Azure Data Factory?</a>, <a href="https://learn.microsoft.com/azure/data-factory/copy-activity-overview" target="_blank" rel="noopener">Copy activity</a>, <a href="https://learn.microsoft.com/azure/data-factory/control-flow-expression-language-functions" target="_blank" rel="noopener">Expressions and functions</a>.</p></div></div></div>`,
    };
  }

  /* ================= Author hub ================= */
  function hubAuthor(res, f, r) {
    const kind = r.kind, name = r.name;
    const tree = `<aside class="factory-tree">
      <div class="ft-head"><b>Factory Resources</b></div>
      ${[["pipelines", "Pipelines", "factory"], ["datasets", "Datasets", "table"], ["dataflows", "Data flows", "flow"]].map(([k, l, ic]) => `<div class="ft-sec"><div class="ft-sec-head">${I(ic)}<span>${l}</span><small>${f[k].length}</small><button class="icon-btn" data-new="${k}" aria-label="New ${l}" title="New">${I("plus")}</button></div>
        ${f[k].map((x) => `<button class="ft-item ${kind === k && name === x.name ? "active" : ""}" data-go='${J({ view: "studio", id: res.id, hub: "author", kind: k, name: x.name })}'>${esc(x.name)}${A.unpublished(f).some((u) => u.kind === k && u.name === x.name) ? `<span class="dot-unpub" title="Unpublished change"></span>` : ""}</button>`).join("")}</div>`).join("")}
    </aside>`;
    let main = { html: `<div class="empty"><p>Select a resource, or create a pipeline, dataset or data flow with the + buttons.</p></div>` };
    const item = kind && name && f[kind] && f[kind].find((x) => x.name === name);
    if (item && kind === "pipelines") main = pipelineEditor(res, f, item, r);
    if (item && kind === "datasets") main = datasetEditor(res, f, item, r);
    if (item && kind === "dataflows") main = dataflowEditor(res, f, item, r);
    return {
      html: `<div class="author">${tree}<div class="author-main">${main.html}</div></div>`,
      mount(root) {
        root.querySelectorAll("[data-new]").forEach((b) => (b.onclick = () => createItem(res, f, b.dataset.new)));
        main.mount && main.mount(root);
      },
    };
  }

  function createItem(res, f, kind) {
    if (kind === "datasets") {
      N.modal({
        title: "New dataset",
        body: `<div class="field"><label for="dt">Data store and format</label><select id="dt">${Object.entries(A.DS_TYPES).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join("")}</select><small class="muted">Azure Data Lake Storage Gen2 + DelimitedText / JSON, or Azure SQL Database.</small></div>
          <div class="field"><label for="dn">Name</label><input id="dn" value="ds_" autocomplete="off"></div>`,
        actions: [{ label: "Create", kind: "primary", onClick: (c, w) => {
          const name = w.querySelector("#dn").value.trim();
          if (!/^[A-Za-z][\w]{0,139}$/.test(name)) { N.toast("Names start with a letter and use letters, digits and underscores.", "error"); return false; }
          if (f.datasets.some((d) => d.name === name)) { N.toast("A dataset with that name exists.", "error"); return false; }
          const d = A.newDataset(w.querySelector("#dt").value, f.datasets); d.name = name; f.datasets.push(d); S.changed("pipeline");
          N.go({ view: "studio", id: res.id, hub: "author", kind: "datasets", name });
        } }, { label: "Cancel" }],
      });
      return;
    }
    const label = kind === "pipelines" ? "pipeline" : "data flow";
    const def = kind === "pipelines" ? "pl_" : "df_";
    N.modal({
      title: `New ${label}`, body: `<div class="field"><label for="pn">Name</label><input id="pn" value="${def}" autocomplete="off"></div>`,
      actions: [{ label: "Create", kind: "primary", onClick: (c, w) => {
        const name = w.querySelector("#pn").value.trim();
        if (!/^[A-Za-z][\w-]{0,139}$/.test(name)) { N.toast("Names start with a letter; use letters, digits, - and _.", "error"); return false; }
        if (f[kind].some((d) => d.name === name)) { N.toast("That name is taken.", "error"); return false; }
        f[kind].push(kind === "pipelines" ? { name, params: [], variables: [], activities: [] } : Object.assign(A.newDataflow(f.dataflows), { name }));
        S.changed("pipeline");
        N.go({ view: "studio", id: res.id, hub: "author", kind, name });
      } }, { label: "Cancel" }],
    });
  }

  /* ---- shared form helpers ---- */
  const dsOptions = (f, cur, filter) => `<option value="">Select…</option>` + f.datasets.filter((d) => !filter || filter(d)).map((d) => `<option ${d.name === cur ? "selected" : ""}>${esc(d.name)}</option>`).join("");
  const lsOptions = (f, cur, kind) => `<option value="">Select…</option>` + f.linked.filter((l) => !kind || A.lsKind(l) === kind).map((l) => `<option ${l.name === cur ? "selected" : ""}>${esc(l.name)}</option>`).join("");
  function dsParamFields(f, ref, keyBase) {
    const d = f.datasets.find((x) => x.name === ref.referenceName);
    if (!d || !(d.parameters || []).length) return "";
    ref.parameters = ref.parameters || {};
    return `<div class="ds-params"><small class="muted">Dataset properties</small>${d.parameters.map((p) => `<div class="field"><label>${esc(p.name)}</label><input data-k="${keyBase}.parameters.${p.name}" value="${esc(ref.parameters[p.name] ?? "")}" placeholder="value or @expression" autocomplete="off"></div>`).join("")}</div>`;
  }
  function bindFields(root, obj, { onStructural } = {}) {
    root.querySelectorAll("[data-k]").forEach((el) => {
      const ev = el.tagName === "SELECT" || el.type === "checkbox" ? "change" : "input";
      el.addEventListener(ev, () => {
        const path = el.dataset.k.split(".");
        let o = obj;
        for (let i = 0; i < path.length - 1; i++) { const k = /^\d+$/.test(path[i]) ? +path[i] : path[i]; if (o[k] == null) o[k] = /^\d+$/.test(path[i + 1]) ? [] : {}; o = o[k]; }
        const last = path[path.length - 1];
        o[last] = el.type === "checkbox" ? el.checked : el.type === "number" ? Number(el.value) : el.value;
        S.save(); S.changed("draft");
        if (el.dataset.re && onStructural) onStructural();
      });
    });
  }

  /* ---- pipeline editor ---- */
  function pipelineEditor(res, f, pl, r) {
    pl.params = pl.params || []; pl.variables = pl.variables || [];
    const acts = pl.activities;
    const sel = r.sel === undefined ? -1 : r.sel;
    const a = acts[sel];
    const lastDebug = S.state.runs.find((x) => x.factory === res.name && x.pipeline === pl.name && x.debug);
    const st = (n) => { const x = lastDebug && lastDebug.activities.find((y) => y.name === n); return x && x.status; };
    const groups = {};
    Object.entries(A.ACTS).forEach(([k, v]) => (groups[v.group] = groups[v.group] || []).push([k, v]));
    const depText = (x) => (x.dependsOn || []).map((d) => `${d.activity} → ${(d.dependencyConditions || ["Succeeded"]).join("/")}`).join(", ");
    let props;
    if (!a) {
      const tab = r.ptab || "parameters";
      props = `<div class="tabs small">${["parameters", "variables", "general"].map((t) => `<button class="tab ${t === tab ? "active" : ""}" data-ptab="${t}">${t[0].toUpperCase() + t.slice(1)}</button>`).join("")}</div>
        ${tab === "parameters" ? `<p class="muted">Values supplied per run: <code>@pipeline().parameters.name</code></p><table class="list params"><thead><tr><th>Name</th><th>Type</th><th>Default value</th><th></th></tr></thead><tbody>${pl.params.map((p, i) => `<tr><td><input data-k="params.${i}.name" value="${esc(p.name)}" aria-label="Name"></td><td><select data-k="params.${i}.type">${["string", "int", "bool", "float", "array", "object"].map((t) => `<option ${(p.type || "string") === t ? "selected" : ""}>${t}</option>`).join("")}</select></td><td><input data-k="params.${i}.default" value="${esc(p.default ?? "")}" aria-label="Default"></td><td><button class="icon-btn" data-del-param="${i}" aria-label="Remove">${I("trash")}</button></td></tr>`).join("")}</tbody></table><button class="btn btn-sm" id="add-param">${I("plus")} New</button>` : ""}
        ${tab === "variables" ? `<p class="muted">Mutable values inside one run: <code>@variables('name')</code>, set with Set variable.</p><table class="list params"><thead><tr><th>Name</th><th>Type</th><th>Default value</th><th></th></tr></thead><tbody>${pl.variables.map((p, i) => `<tr><td><input data-k="variables.${i}.name" value="${esc(p.name)}"></td><td><select data-k="variables.${i}.type">${["String", "Boolean", "Array"].map((t) => `<option ${(p.type || "String") === t ? "selected" : ""}>${t}</option>`).join("")}</select></td><td><input data-k="variables.${i}.default" value="${esc(p.default ?? "")}"></td><td><button class="icon-btn" data-del-var="${i}" aria-label="Remove">${I("trash")}</button></td></tr>`).join("")}</tbody></table><button class="btn btn-sm" id="add-var">${I("plus")} New</button>` : ""}
        ${tab === "general" ? `<div class="field"><label>Name</label><input value="${esc(pl.name)}" disabled></div><p class="muted">Rename by cloning in a real factory; references to the old name would break.</p>` : ""}`;
    } else props = activityProps(res, f, pl, a, r);
    return {
      html: `<div class="pe">
        <div class="pe-head">${I("factory")}<h1>${esc(pl.name)}</h1></div>
        ${N.cmdbar([{ icon: "check", label: "Validate", id: "pl-validate" }, { icon: "play", label: "Debug", id: "pl-debug" }, { icon: "trigger", label: "Add trigger", id: "pl-trigger" }, "|", { icon: "code", label: "{} Code", id: "pl-json" }, { icon: "tutor", label: "Review with tutor", id: "pl-review" }, { icon: "trash", label: "Delete", id: "pl-delete" }])}
        <div class="pe-body">
          <div class="palette"><div class="pal-title">Activities</div>${Object.entries(groups).map(([g, items]) => `<div class="pal-group">${esc(g)}</div>${items.map(([k, v]) => `<button class="pal-item" data-add="${k}" title="${esc(v.desc)}">${I(v.icon)}<span>${esc(v.label)}</span></button>`).join("")}`).join("")}</div>
          <div class="pe-main">
            <div class="canvas">${acts.length ? acts.map((x, i) => `<div class="act ${i === sel ? "sel" : ""} ${st(x.name) ? "st-" + st(x.name).toLowerCase() : ""} ${A.ACTS[x.type] ? "" : "legacy"}" data-sel="${i}" tabindex="0" role="button">
                <div class="act-type">${I((A.ACTS[x.type] || { icon: "file" }).icon)}${esc((A.ACTS[x.type] || { label: x.type + " (legacy)" }).label)}</div><div class="act-name">${esc(x.name)}</div>
                ${(x.dependsOn || []).length ? `<div class="act-dep" title="Depends on">${I("chevron")} ${esc(depText(x))}</div>` : `<div class="act-dep muted">no dependency (runs first)</div>`}
                ${st(x.name) ? `<div class="act-st">${N.statusPill(st(x.name))}</div>` : ""}
                <div class="act-tools"><button class="icon-btn" data-del-act="${i}" aria-label="Delete activity">${I("trash")}</button></div></div>`).join("") : `<div class="canvas-empty">Drag-free canvas: click an activity on the left to add it. Each new activity depends on the previous one (Succeeded); change that under Dependencies.</div>`}
              <button class="pipe-props ${sel === -1 ? "sel" : ""}" data-sel="-1">${I("gear")} Pipeline properties</button></div>
            <div class="props">${props}</div>
            <div class="output-pane"><div class="op-head"><b>Output</b><small class="muted">Debug runs of this pipeline</small></div><div id="debug-out">${debugOutput(res, pl)}</div></div>
          </div>
        </div></div>`,
      mount(root) {
        const rer = () => N.rerender();
        const setSel = (i, atab) => { r.sel = i; if (atab !== undefined) r.atab = atab; rer(); };
        root.querySelectorAll("[data-add]").forEach((b) => (b.onclick = () => { acts.push(A.newActivity(b.dataset.add, acts)); S.changed("pipeline"); setSel(acts.length - 1, "_"); }));
        root.querySelectorAll("[data-sel]").forEach((el) => { el.addEventListener("click", (e) => { if (e.target.closest(".act-tools")) return; setSel(+el.dataset.sel); }); el.addEventListener("keydown", (e) => { if (e.key === "Enter") setSel(+el.dataset.sel); }); });
        root.querySelectorAll("[data-del-act]").forEach((b) => (b.onclick = () => { const x = acts[+b.dataset.delAct]; acts.splice(+b.dataset.delAct, 1); acts.forEach((y) => (y.dependsOn = (y.dependsOn || []).filter((d) => d.activity !== x.name))); S.changed("pipeline"); setSel(-1); }));
        root.querySelectorAll("[data-ptab]").forEach((b) => (b.onclick = () => { r.ptab = b.dataset.ptab; rer(); }));
        const ap = root.querySelector("#add-param"); if (ap) ap.onclick = () => { pl.params.push({ name: "param" + (pl.params.length + 1), type: "string", default: "" }); S.changed("pipeline"); rer(); };
        const av = root.querySelector("#add-var"); if (av) av.onclick = () => { pl.variables.push({ name: "var" + (pl.variables.length + 1), type: "String", default: "" }); S.changed("pipeline"); rer(); };
        root.querySelectorAll("[data-del-param]").forEach((b) => (b.onclick = () => { pl.params.splice(+b.dataset.delParam, 1); S.changed("pipeline"); rer(); }));
        root.querySelectorAll("[data-del-var]").forEach((b) => (b.onclick = () => { pl.variables.splice(+b.dataset.delVar, 1); S.changed("pipeline"); rer(); }));
        if (a) mountActivityProps(root, res, f, pl, a, r); else bindFields(root.querySelector(".props"), pl);
        root.querySelector("#pl-validate").onclick = () => { const is = A.validatePipeline(f, pl); N.modal({ title: is.length ? `${is.length} issue${is.length > 1 ? "s" : ""}` : "Pipeline validation output", body: is.length ? `<ul class="issues">${is.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : `<div class="callout callout-ok">${I("check")} Your pipeline has been validated. No errors were found.</div>`, actions: [{ label: "Close" }] }); };
        root.querySelector("#pl-debug").onclick = () => runDialog(res, pl, true);
        root.querySelector("#pl-trigger").onclick = () => N.modal({ title: "Add trigger", body: `<p><b>Trigger now</b> runs the <i>published</i> version of ${esc(pl.name)} once. <b>New/Edit</b> attaches a schedule or storage event trigger (it takes effect after Publish all).</p>${A.unpublished(f).some((u) => u.kind === "pipelines" && u.name === pl.name) ? `<div class="callout callout-warn">${I("info")} This pipeline has unpublished changes. Trigger now will run the older published version${f.published && f.published.pipelines.some((p) => p.name === pl.name) ? "" : "; it has never been published, so it will fail"}.</div>` : ""}`, actions: [{ label: "Trigger now", kind: "primary", onClick: () => runDialog(res, pl, false) }, { label: "New/Edit", onClick: () => N.go({ view: "studio", id: res.id, hub: "manage", mtab: "triggers", newFor: pl.name }) }, { label: "Cancel" }] });
        root.querySelector("#pl-json").onclick = () => codeView(`${pl.name}`, A.toJson(res.name, "pipelines", pl.name));
        root.querySelector("#pl-review").onclick = () => N.askTutor(`Review my Azure Data Factory pipeline as a senior data engineer. Check correctness, idempotency, dependency conditions, parameter use and anything that would break in real Azure. Pipeline JSON (ADF format):\n${JSON.stringify(A.toJson(res.name, "pipelines", pl.name), null, 1).slice(0, 12000)}\n\nDatasets:\n${JSON.stringify(f.datasets.map((d) => A.toJson(res.name, "datasets", d.name)), null, 1).slice(0, 6000)}`);
        root.querySelector("#pl-delete").onclick = async () => { if (await N.confirmDialog(`Delete ${pl.name}`, "The draft is deleted. The published version stays until you Publish all.")) { f.pipelines.splice(f.pipelines.indexOf(pl), 1); S.changed("pipeline"); N.go({ view: "studio", id: res.id, hub: "author" }); } };
        wireRunButtons(root.querySelector("#debug-out"));
      },
    };
  }
  function debugOutput(res, pl) {
    const runs = S.state.runs.filter((x) => x.factory === res.name && x.pipeline === pl.name && x.debug).slice(0, 3);
    if (!runs.length) return `<div class="empty-note">Click Debug to run your draft. Debug runs show here, not in the Triggered runs list.</div>`;
    return runs.map((run) => `<div class="dbg-run"><div class="dbg-head">${N.statusPill(run.status)} <span class="muted">${N.fmtTime(run.start)} · ${N.fmtDur((run.end || Date.now()) - run.start)} · run ID <code>${esc(run.id.slice(0, 8))}</code></span>${run.note && run.status === "InProgress" ? ` <small class="muted">${esc(run.note)}</small>` : ""}</div>
      <table class="list"><thead><tr><th>Activity name</th><th>Status</th><th>Duration</th><th></th></tr></thead><tbody>${run.activities.map((a, i) => `<tr><td>${esc(a.name)}</td><td>${N.statusPill(a.status)}</td><td>${a.end ? N.fmtDur(a.end - a.start) : "…"}</td><td class="nowrap">${a.input ? `<button class="btn btn-xs" data-io="${run.id}|${i}|input">Input</button>` : ""} ${a.output ? `<button class="btn btn-xs" data-io="${run.id}|${i}|output">Output</button>` : ""} ${a.error ? `<button class="btn btn-xs btn-danger-soft" data-io="${run.id}|${i}|error">Error</button>` : ""}</td></tr>`).join("")}</tbody></table></div>`).join("");
  }
  /* keep debug output fresh without re-rendering forms */
  S.on((what) => {
    if (what !== "runs") return;
    const r = N.route();
    if (r.view !== "studio" || r.hub !== "author" || r.kind !== "pipelines") return;
    const res = S.resById(r.id); if (!res) return;
    const pl = fac(res).pipelines.find((p) => p.name === r.name); if (!pl) return;
    const box = document.getElementById("debug-out");
    if (box) { box.innerHTML = debugOutput(res, pl); wireRunButtons(box); }
    const lastDebug = S.state.runs.find((x) => x.factory === res.name && x.pipeline === pl.name && x.debug);
    document.querySelectorAll(".canvas .act").forEach((el, i) => {
      const a = pl.activities[i]; if (!a || !lastDebug) return;
      const x = lastDebug.activities.find((y) => y.name === a.name);
      el.className = el.className.replace(/\bst-\w+/g, "").trim() + (x ? " st-" + x.status.toLowerCase() : "");
    });
  });
  function wireRunButtons(scope) {
    if (!scope) return;
    scope.querySelectorAll("[data-io]").forEach((b) => (b.onclick = () => {
      const [id, i, k] = b.dataset.io.split("|");
      const run = S.state.runs.find((x) => x.id === id); const a = run.activities[+i];
      showIO(a, k);
    }));
  }
  function showIO(a, k) {
    if (k === "output" && a.type === "ExecuteDataFlow") S.flag("viewed-flow-sql");
    const val = a[k];
    const body = k === "error" ? `<table class="kv"><tr><th>Error code</th><td><code>${esc(val.errorCode)}</code></td></tr><tr><th>Failure type</th><td>${esc(val.failureType)}</td></tr><tr><th>Details</th><td><pre class="json">${esc(val.message)}</pre></td></tr></table>`
      : k === "output" && val && val.generatedSql ? `<div class="snippet"><b>Nimbus compiled your data flow to this SQL (Azure compiles it to Spark):</b><pre>${esc(val.generatedSql)}</pre></div><pre class="json">${esc(JSON.stringify({ ...val, generatedSql: undefined }, null, 2))}</pre>`
      : `<pre class="json">${esc(JSON.stringify(val, null, 2))}</pre>`;
    N.modal({ title: `${k[0].toUpperCase() + k.slice(1)}: ${a.name}`, wide: true, body, actions: [k === "error" ? { label: "Explain with tutor", onClick: () => N.askTutor(`My Azure Data Factory activity "${a.name}" (${a.type}) failed. Explain the cause in plain words and the exact fix in Azure.\n\nError code: ${val.errorCode}\nMessage:\n${val.message}\n\nActivity JSON:\n${JSON.stringify(a.input, null, 1).slice(0, 5000)}`) } : null, { label: "Copy", onClick: () => { N.copyText(typeof val === "string" ? val : JSON.stringify(val, null, 2)); return false; } }, { label: "Close" }].filter(Boolean) });
  }
  function runDialog(res, pl, debug) {
    const go = (params) => {
      E.runPipeline(res.name, pl.name, params, debug ? { type: "Manual", name: "Debug" } : { type: "Manual", name: "Trigger now" }, { debug }).catch((e) => N.modal({ title: "Could not start the run", body: `<div class="callout callout-error">${esc(e.message)}</div>`, actions: [{ label: "Close" }] }));
      N.toast(debug ? `Debugging ${pl.name}` : `Triggered ${pl.name}`, "info");
    };
    if (!(pl.params || []).length) return go({});
    N.modal({
      title: debug ? "Pipeline run (Debug)" : "Pipeline run",
      body: `${(pl.params || []).map((p) => `<div class="field"><label>${esc(p.name)} <small class="muted">${esc(p.type || "string")}</small></label><input data-pn="${esc(p.name)}" value="${esc(p.default ?? "")}" autocomplete="off"></div>`).join("")}`,
      actions: [{ label: "OK", kind: "primary", onClick: (c, w) => { const ps = {}; w.querySelectorAll("[data-pn]").forEach((i) => (ps[i.dataset.pn] = i.value)); go(ps); } }, { label: "Cancel" }],
    });
  }
  function codeView(title, json) {
    N.modal({ title: title + " · JSON", wide: true, body: `<p class="muted">This is the JSON Azure Data Factory stores for this resource. You can paste it into Studio's {} Code view, or commit it to Git.</p><pre class="json">${esc(JSON.stringify(json, null, 2))}</pre>`, actions: [{ label: "Copy", onClick: () => { N.copyText(JSON.stringify(json, null, 2)); return false; } }, { label: "Close" }] });
  }

  function activityProps(res, f, pl, a, r) {
    if (!A.ACTS[a.type]) return `<div class="callout callout-warn">${I("info")} <b>${esc(a.name)}</b> is a legacy Nimbus v1 activity (<code>${esc(a.type)}</code>). It still runs, but it is not a real Data Factory activity. Recreate it with the current activity types and delete this one.</div>`;
    const tabsFor = { Copy: ["general", "source", "sink", "settings"], Lookup: ["general", "settings"], Script: ["general", "settings"], SqlServerStoredProcedure: ["general", "settings"], ExecuteDataFlow: ["general", "settings"], Delete: ["general", "source"], Validation: ["general", "settings"], Wait: ["general", "settings"], SetVariable: ["general", "settings"], ExecutePipeline: ["general", "settings"], IfCondition: ["general", "activities"], Fail: ["general", "settings"] }[a.type];
    const tabs = [...tabsFor, "dependencies"];
    const at = tabs.includes(r.atab) ? r.atab : tabs[1];
    const isLake = (ref) => { const d = f.datasets.find((x) => x.name === (ref && ref.referenceName)); return d && d.type !== "AzureSqlTable"; };
    const isSql = (ref) => { const d = f.datasets.find((x) => x.name === (ref && ref.referenceName)); return d && d.type === "AzureSqlTable"; };
    let body = "";
    if (at === "general") body = `<div class="field"><label>Name</label><input data-k="name" value="${esc(a.name)}" autocomplete="off"></div><div class="field"><label>Description</label><input data-k="description" value="${esc(a.description || "")}"></div><p class="muted">${esc(A.ACTS[a.type].desc)}</p><div class="two"><div class="field"><label>Timeout</label><input value="0.12:00:00" disabled></div><div class="field"><label>Retry</label><input type="number" data-k="policy.retry" value="${esc((a.policy || {}).retry || 0)}" min="0"></div></div>`;
    if (at === "dependencies") {
      const others = pl.activities.filter((x) => x !== a);
      body = `<p class="muted">An activity runs when every dependency finishes in a matching state. <b>Succeeded</b> is the normal chain; <b>Failed</b> builds error handling; <b>Completed</b> runs either way; <b>Skipped</b> runs when the upstream was skipped.</p>
        <table class="list"><thead><tr><th>Upstream activity</th><th>Condition</th><th></th></tr></thead><tbody>${(a.dependsOn || []).map((d, i) => `<tr><td><select data-k="dependsOn.${i}.activity">${others.map((o) => `<option ${o.name === d.activity ? "selected" : ""}>${esc(o.name)}</option>`).join("")}</select></td><td><select data-dep-cond="${i}">${["Succeeded", "Failed", "Completed", "Skipped"].map((c) => `<option ${(d.dependencyConditions || ["Succeeded"])[0] === c ? "selected" : ""}>${c}</option>`).join("")}</select></td><td><button class="icon-btn" data-del-dep="${i}" aria-label="Remove dependency">${I("trash")}</button></td></tr>`).join("") || `<tr><td colspan="3" class="muted">No dependencies: this activity starts as soon as the run starts.</td></tr>`}</tbody></table>
        ${others.length ? `<button class="btn btn-sm" id="add-dep">${I("plus")} Add dependency</button>` : ""}`;
    }
    if (a.type === "Copy") {
      if (at === "source") body = `<div class="field"><label>Source dataset</label><select data-k="inputs.0.referenceName" data-re="1">${dsOptions(f, a.inputs[0].referenceName)}</select></div>${dsParamFields(f, a.inputs[0], "inputs.0")}
        ${isLake(a.inputs[0]) ? `<div class="field"><label>File path type</label><div class="radios"><label><input type="radio" name="fpt" value="ds" ${!a.source.wildcardFileName && !a.source.wildcardFolderPath ? "checked" : ""}> File path in dataset</label><label><input type="radio" name="fpt" value="wc" ${a.source.wildcardFileName || a.source.wildcardFolderPath ? "checked" : ""}> Wildcard file path</label></div></div>
          ${a.source.wildcardFileName || a.source.wildcardFolderPath || r.fpt === "wc" ? `<div class="two"><div class="field"><label>Wildcard folder path</label><input data-k="source.wildcardFolderPath" value="${esc(a.source.wildcardFolderPath || "")}" placeholder="shopstream/orders"></div><div class="field"><label>Wildcard file name</label><input data-k="source.wildcardFileName" value="${esc(a.source.wildcardFileName || "")}" placeholder="*.csv"></div></div>` : ""}
          <div class="field"><label class="check"><input type="checkbox" data-k="source.recursive" ${a.source.recursive !== false ? "checked" : ""}> Recursively</label></div>
          <div class="field"><label>Additional columns</label><table class="list params"><tbody>${(a.source.additionalColumns || []).map((c, i) => `<tr><td><input data-k="source.additionalColumns.${i}.name" value="${esc(c.name)}" placeholder="name"></td><td><input data-k="source.additionalColumns.${i}.value" value="${esc(c.value)}" placeholder="$$FILEPATH or @expression"></td><td><button class="icon-btn" data-del-ac="${i}" aria-label="Remove">${I("trash")}</button></td></tr>`).join("")}</tbody></table><button class="btn btn-xs" id="add-ac">${I("plus")} New</button><small class="muted"><code>$$FILEPATH</code> adds the source file's path to every row (lineage). <code>$$COLUMN:col</code> duplicates a column.</small></div>` : ""}
        ${isSql(a.inputs[0]) ? `<div class="field"><label>Use query</label><textarea class="code" rows="4" data-k="source.sqlReaderQuery" placeholder="Leave empty to read the whole table">${esc(a.source.sqlReaderQuery || "")}</textarea></div>` : ""}`;
      if (at === "sink") body = `<div class="field"><label>Sink dataset</label><select data-k="outputs.0.referenceName" data-re="1">${dsOptions(f, a.outputs[0].referenceName)}</select></div>${dsParamFields(f, a.outputs[0], "outputs.0")}
        ${isSql(a.outputs[0]) ? `<div class="field"><label>Write behavior</label><select disabled><option>Insert</option></select><small class="muted">Upsert and stored-procedure sinks exist in ADF; in Nimbus use Insert into staging + MERGE in a Script.</small></div>
          <div class="field"><label>Table option</label><div class="radios"><label><input type="radio" name="topt" value="none" ${a.sink.tableOption !== "autoCreate" ? "checked" : ""}> Use existing</label><label><input type="radio" name="topt" value="autoCreate" ${a.sink.tableOption === "autoCreate" ? "checked" : ""}> Auto create table</label></div><small class="muted">Auto-create from a CSV source makes every column <code>nvarchar(max)</code>, because delimited text carries no types.</small></div>
          <div class="field"><label>Pre-copy script</label><textarea class="code" rows="3" data-k="sink.preCopyScript" placeholder="TRUNCATE TABLE dbo.stg_orders">${esc(a.sink.preCopyScript || "")}</textarea><small class="muted">Runs before the copy, as the factory's identity. The standard way to make a full reload idempotent.</small></div>` : ""}
        ${isLake(a.outputs[0]) ? `<p class="muted">File name comes from the sink dataset. Leave it empty to keep source file names (PreserveHierarchy).</p>` : ""}`;
      if (at === "settings") body = `<div class="field"><label>Data integration unit</label><select disabled><option>Auto (4)</option></select></div><div class="field"><label class="check"><input type="checkbox" data-k="translator.allowDataTruncation" ${(a.translator || {}).allowDataTruncation !== false ? "checked" : ""}> Allow data truncation</label><small class="muted">When on, strings longer than an <code>nvarchar(n)</code> sink column are cut silently.</small></div><p class="muted">Billing note: every copy activity bills at least one minute of DIU time, even for a tiny file.</p>`;
    }
    if (a.type === "Delete" && at === "source") body = `<div class="field"><label>Dataset</label><select data-k="dataset.referenceName" data-re="1">${dsOptions(f, a.dataset.referenceName, (d) => d.type !== "AzureSqlTable")}</select></div>${dsParamFields(f, a.dataset, "dataset")}<div class="field"><label>Wildcard file name</label><input data-k="wildcardFileName" value="${esc(a.wildcardFileName || "")}" placeholder="*.csv"></div><div class="field"><label class="check"><input type="checkbox" data-k="recursive" ${a.recursive !== false ? "checked" : ""}> Recursively</label></div>`;
    if (at === "settings") {
      if (a.type === "Lookup") body = `<div class="field"><label>Source dataset</label><select data-k="dataset.referenceName" data-re="1">${dsOptions(f, a.dataset.referenceName)}</select></div>${dsParamFields(f, a.dataset, "dataset")}${isSql(a.dataset) ? `<div class="field"><label>Query</label><textarea class="code" rows="4" data-k="sqlReaderQuery" placeholder="SELECT COUNT(*) AS bad_rows FROM dbo.dq_quarantine">${esc(a.sqlReaderQuery || "")}</textarea></div>` : ""}<div class="field"><label class="check"><input type="checkbox" data-k="firstRowOnly" ${a.firstRowOnly !== false ? "checked" : ""}> First row only</label><small class="muted">Use downstream as <code>@activity('${esc(a.name)}').output.firstRow.column</code>, or <code>.output.value</code> when unticked (max 5,000 rows).</small></div>`;
      if (a.type === "Script") body = `<div class="field"><label>Linked service</label><select data-k="linkedServiceName">${lsOptions(f, a.linkedServiceName, "sql")}</select></div>${(a.scripts || []).map((s, i) => `<div class="script-block"><div class="step-head"><b>Script ${i + 1}</b><select data-k="scripts.${i}.type"><option ${s.type === "Query" ? "selected" : ""}>Query</option><option ${s.type !== "Query" ? "selected" : ""}>NonQuery</option></select><span class="grow"></span>${a.scripts.length > 1 ? `<button class="icon-btn" data-del-script="${i}" aria-label="Remove script">${I("trash")}</button>` : ""}</div><textarea class="code" rows="10" spellcheck="false" data-k="scripts.${i}.text" placeholder="T-SQL. Runs as the factory's managed identity.">${esc(s.text || "")}</textarea></div>`).join("")}<button class="btn btn-sm" id="add-script">${I("plus")} Add script block</button><p class="muted">Each block is sent as one batch. <code>GO</code> is a client-tool separator; use a separate block instead (CREATE VIEW/PROCEDURE must start a batch).</p>`;
      if (a.type === "SqlServerStoredProcedure") body = `<div class="field"><label>Linked service</label><select data-k="linkedServiceName">${lsOptions(f, a.linkedServiceName, "sql")}</select></div><div class="field"><label>Stored procedure name</label><input data-k="storedProcedureName" value="${esc(a.storedProcedureName || "")}" placeholder="usp_load_fact_sales"></div><div class="field"><label>Stored procedure parameters</label><table class="list params"><tbody>${Object.entries(a.storedProcedureParameters || {}).map(([k, v]) => `<tr><td><code>${esc(k)}</code></td><td><select data-k="storedProcedureParameters.${k}.type">${["String", "Int32", "Int64", "Decimal", "Boolean", "DateTime"].map((t) => `<option ${(v.type || "String") === t ? "selected" : ""}>${t}</option>`).join("")}</select></td><td><input data-k="storedProcedureParameters.${k}.value" value="${esc(v.value ?? "")}" placeholder="value or @expression"></td><td><button class="icon-btn" data-del-spp="${esc(k)}" aria-label="Remove">${I("trash")}</button></td></tr>`).join("")}</tbody></table><button class="btn btn-xs" id="add-spp">${I("plus")} New</button></div>`;
      if (a.type === "ExecuteDataFlow") body = `<div class="field"><label>Data flow</label><select data-k="dataflow">${`<option value="">Select…</option>` + f.dataflows.map((d) => `<option ${d.name === a.dataflow ? "selected" : ""}>${esc(d.name)}</option>`).join("")}</select></div><div class="field"><label>Compute</label><select disabled><option>General purpose · 8 (+8 driver) cores</option></select><small class="muted">Data flows run on managed Spark. A cold cluster takes minutes to start, and you pay for it per vCore-hour.</small></div>`;
      if (a.type === "Validation") body = `<div class="field"><label>Dataset</label><select data-k="dataset.referenceName" data-re="1">${dsOptions(f, a.dataset.referenceName, (d) => d.type !== "AzureSqlTable")}</select></div>${dsParamFields(f, a.dataset, "dataset")}<div class="two"><div class="field"><label>Timeout (s, sandbox max 20)</label><input type="number" data-k="timeout" value="${esc(a.timeout)}"></div><div class="field"><label>Minimum size (bytes)</label><input type="number" data-k="minimumSize" value="${esc(a.minimumSize)}"></div></div>`;
      if (a.type === "Wait") body = `<div class="field"><label>Wait time in seconds</label><input type="number" data-k="waitTimeInSeconds" value="${esc(a.waitTimeInSeconds)}" min="1"></div>`;
      if (a.type === "SetVariable") body = `<div class="field"><label>Name</label><select data-k="variableName"><option value="">Select…</option>${(pl.variables || []).map((v) => `<option ${v.name === a.variableName ? "selected" : ""}>${esc(v.name)}</option>`).join("")}</select></div><div class="field"><label>Value</label><input data-k="value" value="${esc(a.value)}" placeholder="@activity('Lookup1').output.firstRow.max_ts"></div>`;
      if (a.type === "ExecutePipeline") { const child = f.pipelines.find((p) => p.name === a.pipeline); body = `<div class="field"><label>Invoked pipeline</label><select data-k="pipeline" data-re="1"><option value="">Select…</option>${f.pipelines.filter((p) => p !== pl).map((p) => `<option ${p.name === a.pipeline ? "selected" : ""}>${esc(p.name)}</option>`).join("")}</select></div>${child && (child.params || []).length ? `<div class="field"><label>Parameters</label>${child.params.map((p) => `<div class="field"><label>${esc(p.name)}</label><input data-k="parameters.${p.name}" value="${esc((a.parameters || {})[p.name] ?? "")}" placeholder="value or @expression"></div>`).join("")}</div>` : ""}<div class="field"><label class="check"><input type="checkbox" checked disabled> Wait on completion</label></div>`; }
      if (a.type === "Fail") body = `<div class="field"><label>Fail message</label><input data-k="message" value="${esc(a.message)}" placeholder="@concat('Quarantined ', string(activity('Lookup1').output.firstRow.bad), ' rows')"></div><div class="field"><label>Error code</label><input data-k="errorCode" value="${esc(a.errorCode)}" placeholder="DQ_THRESHOLD"></div>`;
    }
    if (a.type === "IfCondition" && at === "activities") {
      const inner = a.ifTrueActivities[0] || (a.ifTrueActivities[0] = { name: "Fail1", type: "Fail", message: "", errorCode: "" });
      body = `<div class="field"><label>Expression</label><input data-k="expression" value="${esc(a.expression || "")}" placeholder="@greater(activity('Lookup bad rows').output.firstRow.bad_pct, 20)"><small class="muted">Must return true or false. Functions: greater, less, equals, and, or, not, empty, contains…</small></div>
        <div class="branch"><div class="branch-head">${I("check")} <b>True</b> branch</div><div class="field"><label>Activity</label><select disabled><option>Fail</option></select><small class="muted">Nimbus supports a Fail activity in the True branch (the standard data-quality gate). Real ADF allows any activities in both branches.</small></div>
          <div class="field"><label>Fail activity name</label><input data-k="ifTrueActivities.0.name" value="${esc(inner.name)}"></div><div class="field"><label>Fail message</label><input data-k="ifTrueActivities.0.message" value="${esc(inner.message)}"></div><div class="field"><label>Error code</label><input data-k="ifTrueActivities.0.errorCode" value="${esc(inner.errorCode)}"></div></div>
        <div class="branch"><div class="branch-head">${I("x")} <b>False</b> branch</div><p class="muted">No activities. Downstream activities that depend on this one with <i>Succeeded</i> continue.</p></div>`;
    }
    return `<div class="tabs small">${tabs.map((t) => `<button class="tab ${t === at ? "active" : ""}" data-atab="${t}">${t === "activities" ? "Activities" : t[0].toUpperCase() + t.slice(1)}</button>`).join("")}</div><div class="props-body">${body}</div>`;
  }
  function mountActivityProps(root, res, f, pl, a, r) {
    const rer = () => N.rerender();
    root.querySelectorAll("[data-atab]").forEach((b) => (b.onclick = () => { r.atab = b.dataset.atab; rer(); }));
    const scope = root.querySelector(".props");
    bindFields(scope, a, { onStructural: rer });
    const nameIn = scope.querySelector('[data-k="name"]');
    if (nameIn) nameIn.addEventListener("change", () => {
      const old = r.oldName || null;
      if (pl.activities.some((x) => x !== a && x.name === a.name)) { N.toast("Activity names must be unique in a pipeline.", "error"); return; }
      rer();
    });
    if (nameIn) nameIn.addEventListener("focus", () => { const before = a.name; nameIn.addEventListener("change", () => pl.activities.forEach((x) => (x.dependsOn || []).forEach((d) => { if (d.activity === before) d.activity = a.name; })), { once: true }); });
    scope.querySelectorAll("[data-dep-cond]").forEach((s) => (s.onchange = () => { a.dependsOn[+s.dataset.depCond].dependencyConditions = [s.value]; S.changed("pipeline"); rer(); }));
    scope.querySelectorAll("[data-del-dep]").forEach((b) => (b.onclick = () => { a.dependsOn.splice(+b.dataset.delDep, 1); S.changed("pipeline"); rer(); }));
    const ad = scope.querySelector("#add-dep"); if (ad) ad.onclick = () => { const o = pl.activities.find((x) => x !== a && !(a.dependsOn || []).some((d) => d.activity === x.name)); if (!o) return; a.dependsOn = a.dependsOn || []; a.dependsOn.push({ activity: o.name, dependencyConditions: ["Succeeded"] }); S.changed("pipeline"); rer(); };
    scope.querySelectorAll("input[name=fpt]").forEach((x) => (x.onchange = () => { if (x.value === "ds") { a.source.wildcardFileName = ""; a.source.wildcardFolderPath = ""; r.fpt = "ds"; } else r.fpt = "wc"; S.changed("pipeline"); rer(); }));
    scope.querySelectorAll("input[name=topt]").forEach((x) => (x.onchange = () => { a.sink.tableOption = x.value; S.changed("pipeline"); }));
    const aac = scope.querySelector("#add-ac"); if (aac) aac.onclick = () => { a.source.additionalColumns = a.source.additionalColumns || []; a.source.additionalColumns.push({ name: "source_file", value: "$$FILEPATH" }); S.changed("pipeline"); rer(); };
    scope.querySelectorAll("[data-del-ac]").forEach((b) => (b.onclick = () => { a.source.additionalColumns.splice(+b.dataset.delAc, 1); S.changed("pipeline"); rer(); }));
    const as = scope.querySelector("#add-script"); if (as) as.onclick = () => { a.scripts.push({ type: "NonQuery", text: "" }); S.changed("pipeline"); rer(); };
    scope.querySelectorAll("[data-del-script]").forEach((b) => (b.onclick = () => { a.scripts.splice(+b.dataset.delScript, 1); S.changed("pipeline"); rer(); }));
    const asp = scope.querySelector("#add-spp"); if (asp) asp.onclick = () => N.modal({ title: "New parameter", body: `<div class="field"><label for="sp">Parameter name (without @)</label><input id="sp" autocomplete="off"></div>`, actions: [{ label: "Add", kind: "primary", onClick: (c, w) => { const n = w.querySelector("#sp").value.trim().replace(/^@/, ""); if (!n) return false; a.storedProcedureParameters[n] = { value: "", type: "String" }; S.changed("pipeline"); rer(); } }, { label: "Cancel" }] });
    scope.querySelectorAll("[data-del-spp]").forEach((b) => (b.onclick = () => { delete a.storedProcedureParameters[b.dataset.delSpp]; S.changed("pipeline"); rer(); }));
    scope.querySelectorAll("textarea.code").forEach((ta) => N.codeEditor(ta, () => {}));
  }

  /* ---- dataset editor ---- */
  function datasetEditor(res, f, d, r) {
    const tab = r.dtab || "connection";
    const ls = f.linked.find((l) => l.name === d.linkedServiceName);
    const isSql = d.type === "AzureSqlTable";
    const conts = ls && A.lsKind(ls) === "lake" && S.state.lake[ls.target] ? Object.keys(S.state.lake[ls.target].containers) : [];
    return {
      html: `<div class="pe"><div class="pe-head">${I("table")}<h1>${esc(d.name)}</h1><span class="pill pill-muted">${esc(A.DS_TYPES[d.type])}</span></div>
        ${N.cmdbar([{ icon: "table", label: "Preview data", id: "ds-preview" }, { icon: "code", label: "{} Code", id: "ds-json" }, { icon: "trash", label: "Delete", id: "ds-delete" }])}
        <div class="tabs">${["connection", "parameters"].map((t) => `<button class="tab ${t === tab ? "active" : ""}" data-dtab="${t}">${t[0].toUpperCase() + t.slice(1)}</button>`).join("")}</div>
        <div class="props-body form">
        ${tab === "connection" ? `<div class="field"><label>Linked service</label><select data-k="linkedServiceName" data-re="1">${lsOptions(f, d.linkedServiceName, isSql ? "sql" : "lake")}</select></div>
          ${isSql ? `<div class="field"><label>Table <small class="muted">schema dbo</small></label><input data-k="table" value="${esc(d.table || "")}" placeholder="stg_orders or @dataset().tableName"></div>`
            : `<div class="field"><label>File path</label><div class="filepath"><input data-k="container" list="dl-conts" value="${esc(d.container || "")}" placeholder="File system"><span>/</span><input data-k="folderPath" value="${esc(d.folderPath || "")}" placeholder="Directory"><span>/</span><input data-k="fileName" value="${esc(d.fileName || "")}" placeholder="File name"></div><datalist id="dl-conts">${conts.map((c) => `<option value="${esc(c)}">`).join("")}</datalist><small class="muted">Each part accepts expressions, e.g. <code>@dataset().fileName</code>. Leave the file name empty to point at a whole directory.</small></div>
            ${d.type === "DelimitedText" ? `<div class="two"><div class="field"><label>Column delimiter</label><select data-k="columnDelimiter">${[[",", "Comma (,)"], [";", "Semicolon (;)"], ["\\t", "Tab (\\t)"], ["|", "Pipe (|)"]].map(([v, l]) => `<option value="${esc(v)}" ${d.columnDelimiter === v ? "selected" : ""}>${l}</option>`).join("")}</select></div><div class="field"><label>Encoding</label><select disabled><option>Default (UTF-8)</option></select></div></div>
              <div class="field"><label class="check"><input type="checkbox" data-k="firstRowAsHeader" ${d.firstRowAsHeader !== false ? "checked" : ""}> First row as header</label><small class="muted">Unticked, columns are named Prop_0, Prop_1… and the header line becomes a data row.</small></div><div class="field"><label>Null value</label><input value="(empty string)" disabled></div>` : ""}`}`
        : `<p class="muted">Dataset parameters make one dataset reusable. Reference them in fields as <code>@dataset().name</code>; activities supply the values.</p><table class="list params"><thead><tr><th>Name</th><th>Default value</th><th></th></tr></thead><tbody>${(d.parameters || []).map((p, i) => `<tr><td><input data-k="parameters.${i}.name" value="${esc(p.name)}"></td><td><input data-k="parameters.${i}.default" value="${esc(p.default || "")}"></td><td><button class="icon-btn" data-del-dp="${i}" aria-label="Remove">${I("trash")}</button></td></tr>`).join("")}</tbody></table><button class="btn btn-sm" id="add-dp">${I("plus")} New</button>`}
        </div><div id="ds-prev"></div></div>`,
      mount(root) {
        const rer = () => N.rerender();
        root.querySelectorAll("[data-dtab]").forEach((b) => (b.onclick = () => { r.dtab = b.dataset.dtab; rer(); }));
        bindFields(root.querySelector(".props-body"), d, { onStructural: rer });
        const adp = root.querySelector("#add-dp"); if (adp) adp.onclick = () => { d.parameters = d.parameters || []; d.parameters.push({ name: "param" + (d.parameters.length + 1), default: "" }); S.changed("pipeline"); rer(); };
        root.querySelectorAll("[data-del-dp]").forEach((b) => (b.onclick = () => { d.parameters.splice(+b.dataset.delDp, 1); S.changed("pipeline"); rer(); }));
        root.querySelector("#ds-json").onclick = () => codeView(d.name, A.toJson(res.name, "datasets", d.name));
        root.querySelector("#ds-delete").onclick = async () => { if (await N.confirmDialog(`Delete ${d.name}`, "Activities that reference it will fail validation.")) { f.datasets.splice(f.datasets.indexOf(d), 1); S.changed("pipeline"); N.go({ view: "studio", id: res.id, hub: "author" }); } };
        root.querySelector("#ds-preview").onclick = () => {
          const out = root.querySelector("#ds-prev");
          try {
            f.__name = res.name;
            const ctx = { pipeline: { parameters: {}, RunId: "preview" }, variables: {}, outputs: {} };
            const ds = A.resolveDataset(f, f, { referenceName: d.name, parameters: Object.fromEntries((d.parameters || []).map((p) => [p.name, p.default || ""])) }, ctx);
            let data;
            if (ds.kind === "lake") {
              if (ls.auth !== "AccountKey") S.checkLake(res.name, ds.ls.target, ds.container, "read");
              const files = A.datasetFiles(ds, {});
              const c = S.container(ds.ls.target, ds.container);
              const first = files[0] ? N.parseCSV : null;
              const p = files.length ? (d.type === "Json" ? N.parseJSONData(c.files[files[0]].content) : N.parseCSV(c.files[files[0]].content, d.columnDelimiter === "\\t" ? "\t" : d.columnDelimiter || ",")) : { columns: [], rows: [] };
              let cols = p.columns, rows = p.rows.map((x) => cols.map((k) => x[k]));
              if (d.type === "DelimitedText" && d.firstRowAsHeader === false) { rows = [cols, ...rows]; cols = cols.map((k, i) => "Prop_" + i); }
              data = { columns: cols, rows: rows.slice(0, 100), note: `${files.length} file(s); showing the first, up to 100 rows. Preview connects as ${res.name}'s managed identity.` };
            } else {
              S.checkSqlNetwork(ds.ls.target, "azure"); S.checkSqlAuth(res.name, ds.ls.target, new Set(["read"]));
              const q = N.tsql.run(S.db(ds.ls.target), `SELECT TOP 100 * FROM ${ds.table}`, { strict: S.realStrict() });
              data = { columns: q.results[0] ? q.results[0].columns : [], rows: q.results[0] ? q.results[0].values : [], note: "Up to 100 rows, read as the factory's managed identity." };
            }
            out.innerHTML = `<h2 class="sec-title">Preview data</h2><p class="muted">${esc(data.note)}</p>${N.grid(data.columns, data.rows)}`;
          } catch (e) { out.innerHTML = `<div class="callout callout-error"><b>Preview failed</b><pre class="json">${esc(e.message)}</pre></div>`; }
        };
      },
    };
  }

  /* ---- data flow editor ---- */
  const TF = { filter: "Filter", derivedColumn: "Derived column", select: "Select", aggregate: "Aggregate", join: "Join", exists: "Exists", sort: "Sort" };
  function dataflowEditor(res, f, df, r) {
    const tfBody = (t, i) => {
      const k = `transforms.${i}`;
      switch (t.type) {
        case "filter": return `<label>Filter on</label><input data-k="${k}.condition" value="${esc(t.condition || "")}" placeholder="in(['completed','shipped'], status)">`;
        case "derivedColumn": return `${(t.columns || []).map((c, j) => `<div class="two"><input data-k="${k}.columns.${j}.name" value="${esc(c.name || "")}" placeholder="column"><input data-k="${k}.columns.${j}.expr" value="${esc(c.expr || "")}" placeholder="round(quantity * unit_price, 2)"></div>`).join("")}<button class="btn btn-xs" data-add-col="${i}">${I("plus")} Add column</button>`;
        case "select": return `<label>Columns to keep (use <code>col as new_name</code> to rename)</label><input data-k="${k}.columns" value="${esc(t.columns || "")}" placeholder="order_date, category, revenue">`;
        case "aggregate": return `<label>Group by</label><input data-k="${k}.groupBy" value="${esc(t.groupBy || "")}" placeholder="order_date, category"><label>Aggregates</label>${(t.aggregates || []).map((c, j) => `<div class="two"><input data-k="${k}.aggregates.${j}.name" value="${esc(c.name || "")}" placeholder="revenue"><input data-k="${k}.aggregates.${j}.expr" value="${esc(c.expr || "")}" placeholder="round(sum(net_revenue), 2)"></div>`).join("")}<button class="btn btn-xs" data-add-agg="${i}">${I("plus")} Add column</button>`;
        case "join": case "exists": return `<label>Right stream (dataset)</label><select data-k="${k}.rightDataset">${dsOptions(f, t.rightDataset)}</select>
          ${t.type === "join" ? `<label>Join type</label><select data-k="${k}.joinType">${[["inner", "Inner"], ["left", "Left outer"], ["right", "Right outer"], ["outer", "Full outer"], ["cross", "Custom (cross)"]].map(([v, l]) => `<option value="${v}" ${(t.joinType || "inner") === v ? "selected" : ""}>${l}</option>`).join("")}</select>` : `<label class="check"><input type="checkbox" data-k="${k}.negate" ${t.negate ? "checked" : ""}> Doesn't exist</label>`}
          <label>Join condition</label><div class="two"><input data-k="${k}.leftColumn" value="${esc(t.leftColumn || "")}" placeholder="left column: product_id"><input data-k="${k}.rightColumn" value="${esc(t.rightColumn || "")}" placeholder="right column: product_id"></div>`;
        case "sort": return `<label>Sort conditions</label><input data-k="${k}.columns" value="${esc(t.columns || "")}" placeholder="order_date asc, revenue desc">`;
      }
      return "";
    };
    return {
      html: `<div class="pe"><div class="pe-head">${I("flow")}<h1>${esc(df.name)}</h1><span class="pill pill-muted">Mapping data flow</span></div>
        ${N.cmdbar([{ icon: "code", label: "Script", id: "df-script" }, { icon: "code", label: "{} Code", id: "df-json" }, { icon: "trash", label: "Delete", id: "df-delete" }])}
        <div class="callout callout-warn">${I("info")} Expressions use the <b>data flow expression language</b> (<code>==</code>, <code>&amp;&amp;</code>, <code>iif()</code>, <code>toDate()</code>, <code>in([…], col)</code>, <code>round(sum(x), 2)</code>), not SQL. Run a data flow with an Execute Data Flow activity in a pipeline (Debug).</div>
        <div class="df-graph">
          <div class="df-node src"><div class="df-title">${I("table")} source1</div><label>Dataset</label><select data-k="source.dataset">${dsOptions(f, df.source.dataset)}</select></div>
          ${(df.transforms || []).map((t, i) => `<div class="df-node"><div class="df-title">${I("flow")} <input class="df-name" data-k="transforms.${i}.name" value="${esc(t.name || TF[t.type].replace(/\s/g, "") + (i + 1))}" aria-label="Transformation name"><small>${esc(TF[t.type])}</small><span class="grow"></span><button class="icon-btn" data-del-tf="${i}" aria-label="Remove">${I("trash")}</button></div>${tfBody(t, i)}</div>`).join("")}
          <div class="df-add"><select id="add-tf" aria-label="Add transformation"><option value="">+ Add transformation…</option>${Object.entries(TF).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}</select></div>
          <div class="df-node snk"><div class="df-title">${I("save")} sink1</div><label>Dataset</label><select data-k="sink.dataset" data-re="1">${dsOptions(f, df.sink.dataset)}</select>
            ${(f.datasets.find((d) => d.name === df.sink.dataset) || {}).type === "AzureSqlTable" ? `<label>Table action</label><select data-k="sink.tableAction">${[["none", "None (append)"], ["recreate", "Recreate table"], ["truncate", "Truncate table"]].map(([v, l]) => `<option value="${v}" ${df.sink.tableAction === v ? "selected" : ""}>${l}</option>`).join("")}</select>`
              : `<label class="check"><input type="checkbox" data-k="sink.clearFolder" ${df.sink.clearFolder !== false ? "checked" : ""}> Clear the folder</label><label>File name option</label><input data-k="sink.singleFileName" value="${esc(df.sink.singleFileName || "")}" placeholder="Output to single file: daily_revenue.csv (empty = Spark part files)">`}
          </div>
        </div></div>`,
      mount(root) {
        const rer = () => N.rerender();
        bindFields(root.querySelector(".df-graph"), df, { onStructural: rer });
        root.querySelector("#add-tf").onchange = (e) => { const t = e.target.value; if (!t) return; df.transforms = df.transforms || []; const n = { type: t, name: TF[t].replace(/\s/g, "") + (df.transforms.length + 1) }; if (t === "derivedColumn") n.columns = [{ name: "", expr: "" }]; if (t === "aggregate") n.aggregates = [{ name: "", expr: "" }]; df.transforms.push(n); S.changed("pipeline"); rer(); };
        root.querySelectorAll("[data-del-tf]").forEach((b) => (b.onclick = () => { df.transforms.splice(+b.dataset.delTf, 1); S.changed("pipeline"); rer(); }));
        root.querySelectorAll("[data-add-col]").forEach((b) => (b.onclick = () => { df.transforms[+b.dataset.addCol].columns.push({ name: "", expr: "" }); S.changed("pipeline"); rer(); }));
        root.querySelectorAll("[data-add-agg]").forEach((b) => (b.onclick = () => { df.transforms[+b.dataset.addAgg].aggregates.push({ name: "", expr: "" }); S.changed("pipeline"); rer(); }));
        root.querySelector("#df-script").onclick = () => N.modal({ title: `${df.name} · data flow script`, wide: true, body: `<p class="muted">ADF stores a data flow as this script (DSL). Nimbus generates it from your graph; it closely follows the real format.</p><pre class="json">${esc(A.dataflowScript(df).join("\n"))}</pre>`, actions: [{ label: "Close" }] });
        root.querySelector("#df-json").onclick = () => codeView(df.name, A.toJson(res.name, "dataflows", df.name));
        root.querySelector("#df-delete").onclick = async () => { if (await N.confirmDialog(`Delete ${df.name}`, "Execute Data Flow activities that use it will fail validation.")) { f.dataflows.splice(f.dataflows.indexOf(df), 1); S.changed("pipeline"); N.go({ view: "studio", id: res.id, hub: "author" }); } };
      },
    };
  }

  /* ================= Monitor hub ================= */
  function hubMonitor(res, f, r) {
    if (r.run) { const run = S.state.runs.find((x) => x.id === r.run); if (run) return runDetail(res, r, run); }
    const tab = r.mon || "triggered";
    if (tab === "triggerruns") {
      const trs = (S.state.triggerRuns || []).filter((x) => x.factory === res.name);
      return { html: `<div class="blade">${monTabs(res, tab)}${trs.length ? `<div class="table-wrap"><table class="list"><thead><tr><th>Trigger name</th><th>Trigger type</th><th>Trigger time</th><th>Status</th><th>Message</th></tr></thead><tbody>${trs.map((t) => `<tr><td>${esc(t.trigger)}</td><td>${esc(t.type)}</td><td>${N.fmtTime(t.t)}</td><td>${N.statusPill(t.status)}</td><td class="muted">${esc(t.message || "")}</td></tr>`).join("")}</tbody></table></div>` : `<div class="empty-note">No trigger runs yet. Publish a started trigger to see them.</div>`}</div>` };
    }
    const runs = S.state.runs.filter((x) => x.factory === res.name && (tab === "debug" ? x.debug : !x.debug));
    const filt = r.status || "All";
    const shown = runs.filter((x) => filt === "All" || x.status === filt || (filt === "InProgress" && x.status === "Queued"));
    return {
      html: `<div class="blade">${monTabs(res, tab)}
        <div class="filter-row">${["All", "Succeeded", "Failed", "InProgress"].map((s) => `<button class="chip ${s === filt ? "active" : ""}" data-st="${s}">${s === "InProgress" ? "In progress" : s} <small>${s === "All" ? runs.length : runs.filter((x) => x.status === s).length}</small></button>`).join("")}</div>
        ${shown.length ? `<div class="table-wrap"><table class="list"><thead><tr><th>Pipeline name</th><th>Run start</th><th>Duration</th><th>Triggered by</th><th>Status</th><th>Parameters</th><th>Run ID</th></tr></thead><tbody>
          ${shown.map((x) => `<tr class="clickable" data-run="${x.id}"><td><button class="link">${esc(x.pipeline)}</button>${x.parentRunId ? ` <small class="muted">(child)</small>` : ""}</td><td>${N.fmtTime(x.start)}</td><td>${N.fmtDur((x.end || Date.now()) - x.start)}</td><td>${esc(x.trigger.name)}</td><td>${N.statusPill(x.status)}</td><td class="muted">${esc(Object.entries(x.params || {}).map(([k, v]) => `${k}=${v}`).join(", "))}</td><td><code class="muted">${esc(x.id.slice(0, 8))}…</code></td></tr>`).join("")}</tbody></table></div>` : `<div class="empty-note">${tab === "debug" ? "No debug runs." : "No triggered runs. Trigger now and triggers create runs here; Debug runs are on the Debug tab."}</div>`}</div>`,
      mount(root) {
        root.querySelectorAll("[data-st]").forEach((b) => (b.onclick = () => { r.status = b.dataset.st; N.rerender(); }));
        root.querySelectorAll("[data-run]").forEach((tr) => (tr.onclick = () => N.go({ ...r, run: tr.dataset.run })));
      },
    };
  }
  const monTabs = (res, tab) => `<div class="blade-head"><h1>Pipeline runs</h1></div><div class="tabs">${[["triggered", "Triggered"], ["debug", "Debug"], ["triggerruns", "Trigger runs"]].map(([k, l]) => `<button class="tab ${tab === k ? "active" : ""}" data-go='${J({ view: "studio", id: res.id, hub: "monitor", mon: k })}'>${l}</button>`).join("")}</div>`;
  function runDetail(res, r, run) {
    if (run.status === "Failed") S.flag("monitor-failed");
    return {
      html: `<div class="blade">
        <div class="pe-head"><button class="icon-btn" id="back-runs" aria-label="All pipeline runs">${I("back")}</button><h1>${esc(run.pipeline)}</h1>${N.statusPill(run.status)}${run.debug ? `<span class="pill pill-muted">Debug</span>` : ""}</div>
        ${N.cmdbar([{ icon: "refresh", label: "Rerun", id: "rerun" }, { icon: "edit", label: "Open pipeline", go: { view: "studio", id: res.id, hub: "author", kind: "pipelines", name: run.pipeline } }, run.status === "Failed" ? { icon: "tutor", label: "Explain failure", id: "explain" } : null])}
        <table class="kv essentials"><tr><th>Run ID</th><td><code>${esc(run.id)}</code></td></tr><tr><th>Triggered by</th><td>${esc(run.trigger.name)} (${esc(run.trigger.type)})</td></tr><tr><th>Run start</th><td>${N.fmtTime(run.start)}</td></tr><tr><th>Duration</th><td>${N.fmtDur((run.end || Date.now()) - run.start)}</td></tr>
          <tr><th>Parameters</th><td>${Object.keys(run.params || {}).length ? Object.entries(run.params).map(([k, v]) => `<code>${esc(k)}: ${esc(v)}</code>`).join("<br>") : "<span class='muted'>none</span>"}</td></tr></table>
        ${run.error ? `<div class="callout callout-error"><b>Error</b><pre class="json">${esc(run.error)}</pre></div>` : ""}
        <h2 class="sec-title">Activity runs</h2>
        <div class="table-wrap"><table class="list"><thead><tr><th>Activity name</th><th>Activity type</th><th>Run start</th><th>Duration</th><th>Status</th><th>Input / Output / Error</th></tr></thead><tbody>
          ${run.activities.map((a, i) => `<tr><td><b>${esc(a.name)}</b></td><td>${esc(a.type)}</td><td class="muted">${N.fmtTime(a.start)}</td><td>${a.end ? N.fmtDur(a.end - a.start) : "…"}</td><td>${N.statusPill(a.status)}</td>
            <td class="nowrap">${a.input ? `<button class="btn btn-xs" data-io="${run.id}|${i}|input">Input</button>` : ""} ${a.output ? `<button class="btn btn-xs" data-io="${run.id}|${i}|output">Output</button>` : ""} ${a.error ? `<button class="btn btn-xs btn-danger-soft" data-io="${run.id}|${i}|error">Error</button>` : ""}</td></tr>`).join("")}
        </tbody></table></div></div>`,
      mount(root) {
        root.querySelector("#back-runs").onclick = () => { const x = { ...r }; delete x.run; N.go(x); };
        root.querySelector("#rerun").onclick = () => { E.runPipeline(run.factory, run.pipeline, run.params, { type: "Manual", name: "Rerun " + run.id.slice(0, 8) }, { debug: run.debug }).then((nr) => { if (N.route().run === run.id) N.go({ ...r, run: nr.id }, { replace: true }); }).catch((e) => N.toast(e.message, "error", 8000)); };
        const ex = root.querySelector("#explain");
        if (ex) ex.onclick = () => { const fa = run.activities.find((a) => a.status === "Failed"); N.askTutor(`My Azure Data Factory pipeline run failed. Explain the root cause and the exact fix in Azure (portal steps or T-SQL).\nPipeline: ${run.pipeline}\nError: ${run.error}\nFailed activity input:\n${JSON.stringify(fa && fa.input, null, 1).slice(0, 6000)}`); };
        wireRunButtons(root);
      },
    };
  }

  /* ================= Manage hub ================= */
  function hubManage(res, f, r) {
    const tab = r.mtab || "linked";
    const nav = `<aside class="factory-tree"><div class="ft-head"><b>Manage</b></div>${[["linked", "Linked services", "link"], ["ir", "Integration runtimes", "bolt"], ["triggers", "Triggers", "trigger"], ["git", "Git configuration", "code"], ["arm", "ARM template", "save"]].map(([k, l, ic]) => `<button class="ft-item ${tab === k ? "active" : ""}" data-go='${J({ view: "studio", id: res.id, hub: "manage", mtab: k })}'>${I(ic)} ${l}</button>`).join("")}</aside>`;
    let main = { html: "" };
    if (tab === "linked") main = manageLinked(res, f);
    if (tab === "ir") main = { html: `<div class="blade-head"><h1>Integration runtimes</h1></div><div class="table-wrap"><table class="list"><thead><tr><th>Name</th><th>Type</th><th>Sub-type</th><th>Status</th><th>Region</th></tr></thead><tbody><tr><td>AutoResolveIntegrationRuntime</td><td>Azure</td><td>Public</td><td>${N.statusPill("Running")}</td><td>Auto resolve</td></tr></tbody></table></div><div class="learn-card">${I("info")}<div><b>What an IR is</b><p>The compute that runs copy activities and dispatches others. <b>Azure IR</b> is serverless and managed. A <b>self-hosted IR</b> is software you install on a VM to reach on-premises or private networks. A <b>managed VNet</b> Azure IR reaches private endpoints. Nimbus only emulates the AutoResolve Azure IR.</p></div></div>` };
    if (tab === "triggers") main = manageTriggers(res, f, r);
    if (tab === "git") main = { html: `<div class="blade-head"><h1>Git configuration</h1></div><div class="empty"><p>This factory is in <b>live mode</b>: Publish saves straight to the service. Teams connect Azure DevOps or GitHub, author in feature branches, merge to the collaboration branch, and deploy with the ARM template from <code>adf_publish</code> or the npm build package.</p><button class="btn" disabled>Configure</button></div>` };
    if (tab === "arm") main = { html: `<div class="blade-head"><h1>ARM template</h1></div><p class="muted">The published factory as an ARM template fragment: how CI/CD moves a factory from dev to test to prod.</p><pre class="json">${esc(JSON.stringify(armTemplate(res, f), null, 2))}</pre>` };
    return { html: `<div class="author">${nav}<div class="author-main">${main.html}</div></div>`, mount: main.mount };
  }
  function armTemplate(res, f) {
    const pub = f.published || { pipelines: [], datasets: [], dataflows: [], triggers: [] };
    const resources = [];
    f.linked.forEach((l) => resources.push({ name: `[concat(parameters('factoryName'), '/${l.name}')]`, type: "Microsoft.DataFactory/factories/linkedServices", apiVersion: "2018-06-01", properties: A.toJson(res.name, "linked", l.name).properties }));
    const tmp = { ...f };
    ["datasets", "dataflows", "pipelines", "triggers"].forEach((k) => (pub[k] || []).forEach((x) => {
      const saved = f[k]; f[k] = pub[k];
      try { resources.push({ name: `[concat(parameters('factoryName'), '/${x.name}')]`, type: `Microsoft.DataFactory/factories/${k === "dataflows" ? "dataflows" : k}`, apiVersion: "2018-06-01", properties: A.toJson(res.name, k, x.name).properties }); } finally { f[k] = saved; }
    }));
    return { $schema: "http://schema.management.azure.com/schemas/2015-01-01/deploymentTemplate.json#", contentVersion: "1.0.0.0", parameters: { factoryName: { type: "string", defaultValue: res.name } }, resources };
  }
  function manageLinked(res, f) {
    return {
      html: `<div class="blade-head"><h1>Linked services</h1><p class="muted">Connection information the factory needs to reach a data store. Nimbus supports Azure Data Lake Storage Gen2 and Azure SQL Database.</p></div>
        ${N.cmdbar([{ icon: "plus", label: "New", id: "ls-new" }])}
        ${f.linked.length ? `<div class="table-wrap"><table class="list"><thead><tr><th>Name</th><th>Type</th><th>Connects to</th><th>Authentication</th><th></th></tr></thead><tbody>${f.linked.map((l, i) => `<tr><td>${I("link")} <b>${esc(l.name)}</b></td><td>${A.lsKind(l) === "lake" ? "Azure Data Lake Storage Gen2" : "Azure SQL Database"}</td><td><code>${esc(A.lsKind(l) === "lake" ? `https://${l.target}.dfs.core.windows.net/` : `${S.serverOf(l.target) ? S.fqdn(S.serverOf(l.target).name) : "?"} / ${l.target}`)}</code></td><td>${l.auth === "AccountKey" ? `<span class="pill pill-bad">Account key</span>` : "System-assigned managed identity"}</td><td class="right nowrap"><button class="btn btn-xs" data-test="${i}">Test connection</button> <button class="btn btn-xs" data-json="${i}">{}</button> <button class="icon-btn" data-del="${i}" aria-label="Delete">${I("trash")}</button></td></tr>`).join("")}</tbody></table></div>`
          : `<div class="empty-note">No linked services yet.</div>`}
        <div id="ls-test"></div>`,
      mount(root) {
        root.querySelector("#ls-new").onclick = () => newLinked(res, f);
        root.querySelectorAll("[data-del]").forEach((b) => (b.onclick = async () => { const l = f.linked[+b.dataset.del]; if (await N.confirmDialog("Delete linked service", `Datasets that use <b>${esc(l.name)}</b> will stop working.`)) { f.linked.splice(+b.dataset.del, 1); S.changed("pipeline"); N.rerender(); } }));
        root.querySelectorAll("[data-json]").forEach((b) => (b.onclick = () => codeView(f.linked[+b.dataset.json].name, A.toJson(res.name, "linked", f.linked[+b.dataset.json].name))));
        root.querySelectorAll("[data-test]").forEach((b) => (b.onclick = () => testConnection(res, f.linked[+b.dataset.test], root.querySelector("#ls-test"))));
      },
    };
  }
  function testConnection(res, l, out) {
    const show = (ok, msg) => { out.innerHTML = `<div class="callout ${ok ? "callout-ok" : "callout-error"}">${I(ok ? "check" : "x")} <b>${ok ? "Connection successful" : "Connection failed"}</b>${msg ? `<pre class="json">${esc(msg)}</pre>` : ""}</div>`; };
    try {
      if (A.lsKind(l) === "lake") {
        if (!S.res("storage", l.target)) throw new Error(`The remote name could not be resolved: '${l.target}.dfs.core.windows.net'`);
        if (l.auth !== "AccountKey") { const conts = Object.keys(S.state.lake[l.target].containers); if (!conts.length) return show(true, "Connected. The account has no containers yet."); S.checkLake(res.name, l.target, conts[0], "read"); }
        return show(true, l.auth === "AccountKey" ? "Connected with the account key. (Works, but anyone with this factory can read and write the whole account. Prefer managed identity.)" : "");
      }
      S.checkSqlNetwork(l.target, "azure");
      S.checkSqlAuth(res.name, l.target, new Set());
      show(true, "");
    } catch (e) { show(false, e.message); }
  }
  function newLinked(res, f) {
    const lakes = S.resOfType("storage"), dbs = S.resOfType("sqldb");
    N.modal({
      title: "New linked service",
      body: `<div class="field"><label for="lt">Data store</label><select id="lt"><option value="AzureBlobFS">Azure Data Lake Storage Gen2</option><option value="AzureSqlDatabase">Azure SQL Database</option></select></div>
        <div class="field"><label for="ln">Name</label><input id="ln" value="ls_adls" autocomplete="off"></div>
        <div class="field"><label>Connect via integration runtime</label><select disabled><option>AutoResolveIntegrationRuntime</option></select></div>
        <div class="field"><label for="la">Authentication type</label><select id="la"></select></div>
        <div class="field"><label for="lg">Account selection method: From Azure subscription</label><select id="lg"></select></div>`,
      onMount(w) {
        const sync = () => {
          const t = w.querySelector("#lt").value, lake = t === "AzureBlobFS";
          w.querySelector("#lg").innerHTML = (lake ? lakes : dbs).map((x) => `<option value="${esc(x.name)}">${esc(lake ? x.name : `${x.props.server} / ${x.name}`)}</option>`).join("") || `<option value="">None found in this subscription</option>`;
          w.querySelector("#la").innerHTML = lake ? `<option value="MI">System Assigned Managed Identity</option><option value="AccountKey">Account key</option>` : `<option value="MI">System Assigned Managed Identity</option><option value="SQL" disabled>SQL authentication (needs a Key Vault secret)</option>`;
          const ln = w.querySelector("#ln"); if (/^ls_(adls|sqldb)$/.test(ln.value)) ln.value = lake ? "ls_adls" : "ls_sqldb";
        };
        w.querySelector("#lt").onchange = sync; sync();
      },
      actions: [{ label: "Create", kind: "primary", onClick: (c, w) => {
        const name = w.querySelector("#ln").value.trim(), type = w.querySelector("#lt").value, target = w.querySelector("#lg").value, auth = w.querySelector("#la").value;
        if (!/^[A-Za-z][\w]{0,139}$/.test(name)) { N.toast("Names start with a letter and use letters, digits and underscores.", "error"); return false; }
        if (f.linked.some((l) => l.name === name)) { N.toast("That name is taken.", "error"); return false; }
        if (!target) { N.toast("Create the data store first.", "error"); return false; }
        if (auth === "AccountKey" && S.res("storage", target) && S.res("storage", target).props.allowSharedKey === false) { N.toast("This storage account has shared key access disabled.", "error"); return false; }
        f.linked.push({ name, type, target, auth: auth === "AccountKey" ? "AccountKey" : "SystemAssignedManagedIdentity" });
        S.log("Create linked service", `${res.name}/${name}`); S.changed("pipeline"); N.rerender();
      } }, { label: "Cancel" }],
    });
  }
  function manageTriggers(res, f, r) {
    const pubT = (f.published && f.published.triggers) || [];
    if (r.newFor) { const p = r.newFor; delete r.newFor; setTimeout(() => editTrigger(res, f, null, p), 0); }
    return {
      html: `<div class="blade-head"><h1>Triggers</h1><p class="muted">Triggers start published pipelines. Creating, starting or stopping a trigger takes effect after <b>Publish all</b>. Here they fire while this portal tab is open.</p></div>
        ${N.cmdbar([{ icon: "plus", label: "New", id: "tr-new" }])}
        ${S.state.providers["Microsoft.EventGrid"] !== "Registered" ? `<div class="callout callout-warn">${I("info")} Storage event triggers use Event Grid. The resource provider <b>Microsoft.EventGrid</b> is not registered on this subscription, so starting one will fail. <button class="link" data-go='{"view":"subscription","tab":"providers"}'>Open resource providers</button></div>` : ""}
        ${f.triggers.length ? `<div class="table-wrap"><table class="list"><thead><tr><th>Name</th><th>Type</th><th>Pipeline</th><th>Condition</th><th>Status (draft)</th><th>Published</th><th></th></tr></thead><tbody>${f.triggers.map((t, i) => { const p = pubT.find((x) => x.name === t.name); return `<tr><td>${I(t.type === "ScheduleTrigger" ? "clock" : "bolt")} <b>${esc(t.name)}</b></td><td>${t.type === "ScheduleTrigger" ? "Schedule" : "Storage events"}</td><td>${esc(t.pipeline)}</td><td class="muted">${t.type === "ScheduleTrigger" ? `Every ${esc(t.interval)} ${esc(String(t.frequency || "Minute").toLowerCase())}(s)` : `<code>/${esc(t.container)}/blobs/${esc(t.blobPathBeginsWith || "")}</code> … <code>${esc(t.blobPathEndsWith || "")}</code>`}${Object.keys(t.parameters || {}).length ? `<br>${Object.entries(t.parameters).map(([k, v]) => `<code>${esc(k)} = ${esc(v)}</code>`).join(" ")}` : ""}</td><td>${N.statusPill(t.enabled ? "Started" : "Stopped")}</td><td>${p ? N.statusPill(p.enabled ? "Started" : "Stopped") : `<span class="pill pill-muted">Not published</span>`}</td><td class="right nowrap"><button class="btn btn-xs" data-edit="${i}">Edit</button> <button class="btn btn-xs" data-json="${i}">{}</button> <button class="icon-btn" data-del="${i}" aria-label="Delete">${I("trash")}</button></td></tr>`; }).join("")}</tbody></table></div>`
          : `<div class="empty-note">No triggers.</div>`}`,
      mount(root) {
        root.querySelector("#tr-new").onclick = () => editTrigger(res, f, null);
        root.querySelectorAll("[data-edit]").forEach((b) => (b.onclick = () => editTrigger(res, f, f.triggers[+b.dataset.edit])));
        root.querySelectorAll("[data-json]").forEach((b) => (b.onclick = () => codeView(f.triggers[+b.dataset.json].name, A.toJson(res.name, "triggers", f.triggers[+b.dataset.json].name))));
        root.querySelectorAll("[data-del]").forEach((b) => (b.onclick = async () => { if (await N.confirmDialog("Delete trigger", "It stays active until you Publish all.")) { f.triggers.splice(+b.dataset.del, 1); S.changed("pipeline"); N.rerender(); } }));
      },
    };
  }
  function editTrigger(res, f, t, forPipeline) {
    if (!f.pipelines.length) { N.toast("Create a pipeline first.", "error"); return; }
    const isNew = !t;
    t = t ? JSON.parse(JSON.stringify(t)) : { name: "tr_", type: "BlobEventsTrigger", pipeline: forPipeline || f.pipelines[0].name, enabled: true, frequency: "Minute", interval: 15, storageAccount: (S.resOfType("storage")[0] || {}).name || "", container: "bronze", blobPathBeginsWith: "", blobPathEndsWith: ".csv", ignoreEmptyBlobs: true, parameters: {}, created: Date.now() };
    N.modal({
      title: isNew ? "New trigger" : `Edit trigger ${t.name}`, wide: true,
      body: `<div class="two"><div class="field"><label for="tn">Name</label><input id="tn" value="${esc(t.name)}" ${isNew ? "" : "disabled"} autocomplete="off"></div><div class="field"><label for="tp">Pipeline</label><select id="tp">${f.pipelines.map((p) => `<option ${p.name === t.pipeline ? "selected" : ""}>${esc(p.name)}</option>`).join("")}</select></div></div>
        <div class="field"><label for="tt">Type</label><select id="tt"><option value="BlobEventsTrigger" ${t.type === "BlobEventsTrigger" ? "selected" : ""}>Storage events</option><option value="ScheduleTrigger" ${t.type === "ScheduleTrigger" ? "selected" : ""}>Schedule</option></select></div>
        <div id="t-sched"><div class="two"><div class="field"><label for="tf">Recurrence</label><select id="tf">${["Minute", "Hour", "Day"].map((x) => `<option ${t.frequency === x ? "selected" : ""}>${x}</option>`).join("")}</select></div><div class="field"><label for="ti">Every</label><input id="ti" type="number" min="1" value="${esc(t.interval)}"></div></div><p class="muted">Time zone UTC. Azure also supports tumbling window triggers for back-fills with dependencies.</p></div>
        <div id="t-store"><div class="field"><label for="ta">Storage account name</label><select id="ta">${S.resOfType("storage").map((x) => `<option ${x.name === t.storageAccount ? "selected" : ""}>${esc(x.name)}</option>`).join("")}</select></div>
          <div class="field"><label for="tc">Container name</label><input id="tc" value="${esc(t.container)}" autocomplete="off"></div>
          <div class="two"><div class="field"><label for="tpre">Blob path begins with</label><input id="tpre" value="${esc(t.blobPathBeginsWith)}" placeholder="shopstream/incoming/" autocomplete="off"></div><div class="field"><label for="tsuf">Blob path ends with</label><input id="tsuf" value="${esc(t.blobPathEndsWith)}" placeholder=".csv" autocomplete="off"></div></div>
          <div class="field"><label>Event</label><label class="check"><input type="checkbox" checked disabled> Blob created</label><label class="check"><input type="checkbox" id="tig" ${t.ignoreEmptyBlobs !== false ? "checked" : ""}> Ignore empty blobs</label></div>
          <p class="muted">In the trigger JSON this becomes <code>/container/blobs/path</code>. Writing the path without <code>/blobs/</code> is a classic mistake when authoring by hand.</p></div>
        <div class="field"><label class="check"><input type="checkbox" id="te" ${t.enabled ? "checked" : ""}> Start trigger on creation</label></div>
        <div id="t-params"></div>`,
      onMount(w) {
        const sync = () => {
          const st = w.querySelector("#tt").value === "BlobEventsTrigger";
          w.querySelector("#t-sched").hidden = st; w.querySelector("#t-store").hidden = !st;
          const pl = f.pipelines.find((p) => p.name === w.querySelector("#tp").value);
          w.querySelector("#t-params").innerHTML = (pl.params || []).length ? `<h3 class="form-sec">Trigger run parameters</h3>${pl.params.map((p) => `<div class="field"><label>${esc(p.name)}</label><input data-pn="${esc(p.name)}" value="${esc(t.parameters[p.name] ?? (st && /file/i.test(p.name) ? "@triggerBody().fileName" : st && /folder/i.test(p.name) ? "@triggerBody().folderPath" : ""))}" autocomplete="off"></div>`).join("")}<small class="muted">Storage event triggers expose <code>@triggerBody().fileName</code> and <code>@triggerBody().folderPath</code>; schedules expose <code>@trigger().scheduledTime</code>.</small>` : "";
        };
        w.querySelector("#tt").onchange = sync; w.querySelector("#tp").onchange = sync; sync();
      },
      actions: [{ label: "OK", kind: "primary", onClick: (c, w) => {
        const name = w.querySelector("#tn").value.trim();
        if (isNew && (!/^[A-Za-z][\w-]{0,139}$/.test(name) || f.triggers.some((x) => x.name === name))) { N.toast("Enter a unique trigger name.", "error"); return false; }
        Object.assign(t, { name, type: w.querySelector("#tt").value, pipeline: w.querySelector("#tp").value, enabled: w.querySelector("#te").checked, frequency: w.querySelector("#tf").value, interval: Math.max(1, +w.querySelector("#ti").value || 15), storageAccount: w.querySelector("#ta").value, container: w.querySelector("#tc").value.trim(), blobPathBeginsWith: w.querySelector("#tpre").value.trim().replace(/^\/+/, ""), blobPathEndsWith: w.querySelector("#tsuf").value.trim(), ignoreEmptyBlobs: w.querySelector("#tig").checked, parameters: {} });
        w.querySelectorAll("[data-pn]").forEach((i) => { if (i.value) t.parameters[i.dataset.pn] = i.value; });
        if (/^\/?[^/]+\/blobs\//.test(t.blobPathBeginsWith)) { N.toast("Enter the path inside the container (the /container/blobs/ prefix is added for you).", "error"); return false; }
        if (isNew) f.triggers.push(t); else f.triggers[f.triggers.findIndex((x) => x.name === t.name)] = t;
        S.changed("pipeline"); N.toast(`Trigger ${name} saved. Publish all to activate it.`, "info", 5000); N.rerender();
      } }, { label: "Cancel" }],
    });
  }

  /* ================= Global monitor (all factories) ================= */
  N.views.monitor = (r) => {
    const runs = S.state.runs.filter((x) => !x.debug);
    return {
      live: ["runs"],
      crumbs: [{ label: "Monitor", route: { view: "monitor" } }],
      html: `<div class="blade"><div class="blade-head"><h1>Pipeline runs across factories</h1><p class="muted">Azure Monitor collects metrics and logs from every service. Open a factory's Studio → Monitor for full run details.</p></div>
        ${runs.length ? `<div class="table-wrap"><table class="list"><thead><tr><th>Pipeline</th><th>Factory</th><th>Run start</th><th>Duration</th><th>Triggered by</th><th>Status</th></tr></thead><tbody>${runs.slice(0, 100).map((x) => { const res = S.res("factory", x.factory); return `<tr class="clickable" ${res ? `data-go='${J({ view: "studio", id: res.id, hub: "monitor", run: x.id })}'` : ""}><td><b>${esc(x.pipeline)}</b></td><td>${esc(x.factory)}</td><td>${N.fmtTime(x.start)}</td><td>${N.fmtDur((x.end || Date.now()) - x.start)}</td><td>${esc(x.trigger.name)}</td><td>${N.statusPill(x.status)}</td></tr>`; }).join("")}</tbody></table></div>` : `<div class="empty-note">No triggered pipeline runs yet.</div>`}</div>`,
    };
  };
})(window.N);
