/* Nimbus Portal — shell, router and core blades */
(function (N) {
  const S = N.store, esc = N.esc, I = N.icon;
  const REGIONS = ["South Africa North", "West Europe", "North Europe", "East US", "West US 2", "Central India", "Japan East", "Brazil South"];
  N.REGIONS = REGIONS;
  N.views = {};
  let current = { view: "home" };
  let historyStack = [];

  /* ---------------- routing ---------------- */
  N.go = (route, { replace = false } = {}) => {
    if (!replace && current) historyStack.push(current);
    if (historyStack.length > 50) historyStack.shift();
    current = route;
    try { localStorage.setItem("nimbus-route", JSON.stringify(route)); } catch (e) {}
    closeOverlays();
    render();
    document.getElementById("main").scrollTop = 0;
    if (window.innerWidth < 900) document.body.classList.remove("nav-open");
  };
  N.back = () => { if (historyStack.length) { current = historyStack.pop(); render(); } else N.go({ view: "home" }); };
  N.route = () => current;
  N.rerender = () => render(true);

  function render(keepScroll) {
    const main = document.getElementById("main");
    const scroll = main.scrollTop;
    const v = N.views[current.view] || N.views.home;
    let out;
    try { out = v(current); }
    catch (e) { console.error(e); out = { crumbs: [], html: `<div class="blade"><div class="callout callout-error">This blade could not load: ${esc(e.message)}. <button class="link" data-go='{"view":"home"}'>Go home</button></div></div>` }; }
    if (typeof out === "string") out = { html: out };
    const crumbs = [{ label: "Home", route: { view: "home" } }, ...(out.crumbs || [])];
    main.innerHTML = `<nav class="crumbs" aria-label="Breadcrumb">${crumbs.map((c, i) => i === crumbs.length - 1 && i > 0 ? `<span>${esc(c.label)}</span>` : `<button class="link" data-go='${esc(JSON.stringify(c.route))}'>${esc(c.label)}</button>`).join(`<span class="sep">${I("chevron")}</span>`)}</nav>${out.html}`;
    if (out.mount) out.mount(main);
    if (keepScroll) main.scrollTop = scroll;
    updateNav();
    N.renderLabDock && N.renderLabDock();
  }

  /* views opt in to live refresh by listing change kinds */
  S.on((what) => {
    updateBell();
    const v = N.views[current.view];
    const live = (v && v.live) || [];
    if (live.includes(what) || live.includes("*")) render(true);
    N.renderLabDock && N.renderLabDock();
    if (N.tutorContextChanged) N.tutorContextChanged();
  });

  /* ---------------- shell ---------------- */
  const NAV = [
    { id: "create", label: "Create a resource", icon: "plus", route: { view: "create" } },
    { id: "home", label: "Home", icon: "home", route: { view: "home" } },
    { id: "labs", label: "Learning center", icon: "labs", route: { view: "labs" } },
    { sep: true },
    { id: "resources", label: "All resources", icon: "grid", route: { view: "resources" } },
    { id: "rgs", label: "Resource groups", icon: "rg", route: { view: "rgs" } },
    { id: "list-storage", label: "Lake storage", icon: "storage", route: { view: "list", type: "storage" }, type: "storage" },
    { id: "list-sqldb", label: "SQL databases", icon: "sql", route: { view: "list", type: "sqldb" }, type: "sqldb" },
    { id: "list-factory", label: "Pipeline factories", icon: "factory", route: { view: "list", type: "factory" }, type: "factory" },
    { id: "list-workspace", label: "Analytics workspaces", icon: "workspace", route: { view: "list", type: "workspace" }, type: "workspace" },
    { sep: true },
    { id: "monitor", label: "Monitor", icon: "monitor", route: { view: "monitor" } },
    { id: "log", label: "Activity log", icon: "book", route: { view: "log" } },
    { id: "settings", label: "Settings", icon: "gear", route: { view: "settings" } },
  ];

  function buildShell() {
    document.getElementById("app").innerHTML = `
      <header class="topbar">
        <button class="icon-btn top-ic" id="nav-toggle" aria-label="Toggle navigation">${I("menu")}</button>
        <button class="brand" data-go='{"view":"home"}' aria-label="Nimbus Portal home"><span class="brand-mark" aria-hidden="true"><svg viewBox="0 0 32 32"><path d="M9 23a6 6 0 01-.7-12A8 8 0 0123.6 9.5 6.8 6.8 0 0123 23z" fill="currentColor" opacity=".95"/><path d="M11 19h10M13 15.5h7" stroke="var(--top)" stroke-width="1.8" stroke-linecap="round"/></svg></span><span class="brand-name">Nimbus</span><span class="brand-sub">Portal</span></button>
        <div class="search" role="search">
          ${I("search")}
          <input id="gsearch" type="search" placeholder="Search resources, services and labs (/)" autocomplete="off" aria-label="Search">
          <div class="search-pop" id="search-pop" hidden></div>
        </div>
        <div class="top-actions">
          <button class="icon-btn top-ic" id="btn-shell" title="Cloud Shell" aria-label="Open Cloud Shell">${I("shell")}</button>
          <button class="icon-btn top-ic" id="btn-tutor" title="Tutor" aria-label="Open tutor">${I("tutor")}</button>
          <button class="icon-btn top-ic bell" id="btn-bell" title="Notifications" aria-label="Notifications">${I("bell")}<span class="badge" id="bell-count" hidden></span></button>
          <button class="icon-btn top-ic" data-go='{"view":"settings"}' title="Settings" aria-label="Settings">${I("gear")}</button>
          <div class="account"><span class="acct-text"><b>learner@nimbus</b><small>FREE LEARNING SUBSCRIPTION</small></span><span class="avatar">LN</span></div>
        </div>
      </header>
      <div class="shell-body">
        <nav class="sidenav" id="sidenav" aria-label="Main">${NAV.map((n) => n.sep ? `<div class="nav-sep"></div>` : `<button class="nav-item" data-nav="${n.id}" data-go='${esc(JSON.stringify(n.route))}'>${n.type ? N.tile(n.type, "tile-sm") : `<span class="nav-ic">${I(n.icon)}</span>`}<span>${esc(n.label)}</span></button>`).join("")}</nav>
        <div class="nav-scrim" id="nav-scrim"></div>
        <main id="main" tabindex="-1"></main>
        <aside id="tutor" class="tutor" hidden aria-label="Tutor"></aside>
      </div>
      <section id="cloudshell" class="cloudshell" hidden aria-label="Cloud Shell"></section>
      <div id="labdock"></div>
      <div id="bell-pop" class="bell-pop" hidden></div>
      <div id="toasts" class="toasts" aria-live="polite"></div>`;

    document.getElementById("nav-toggle").onclick = () => {
      if (window.innerWidth < 900) document.body.classList.toggle("nav-open");
      else document.body.classList.toggle("nav-collapsed");
    };
    document.getElementById("nav-scrim").onclick = () => document.body.classList.remove("nav-open");
    document.getElementById("btn-tutor").onclick = () => N.toggleTutor();
    document.getElementById("btn-shell").onclick = () => N.toggleShell();
    document.getElementById("btn-bell").onclick = (e) => { e.stopPropagation(); toggleBell(); };
    setupSearch();

    document.addEventListener("click", (e) => {
      const g = e.target.closest("[data-go]");
      if (g && !g.disabled) { e.preventDefault(); try { N.go(JSON.parse(g.dataset.go)); } catch (err) { console.error(err); } return; }
      if (!e.target.closest("#bell-pop") && !e.target.closest("#btn-bell")) document.getElementById("bell-pop").hidden = true;
      if (!e.target.closest(".search")) document.getElementById("search-pop").hidden = true;
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "/" && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) { e.preventDefault(); document.getElementById("gsearch").focus(); }
    });
  }

  function closeOverlays() {
    const bp = document.getElementById("bell-pop"); if (bp) bp.hidden = true;
    const sp = document.getElementById("search-pop"); if (sp) sp.hidden = true;
  }

  function updateNav() {
    const v = current.view;
    let active = v;
    if (v === "list") active = "list-" + current.type;
    if (v === "resource") { const r = S.resById(current.id); active = r ? "list-" + r.type : ""; }
    if (v === "rg") active = "rgs";
    if (v === "lab") active = "labs";
    document.querySelectorAll(".nav-item").forEach((b) => b.classList.toggle("active", b.dataset.nav === active));
  }

  function updateBell() {
    const n = S.state.notifications.filter((x) => !x.read).length;
    const b = document.getElementById("bell-count");
    if (!b) return;
    b.hidden = !n; b.textContent = n > 9 ? "9+" : n;
    const pop = document.getElementById("bell-pop");
    if (pop && !pop.hidden) renderBell();
  }
  function renderBell() {
    const pop = document.getElementById("bell-pop");
    const list = S.state.notifications;
    pop.innerHTML = `<div class="pop-head"><b>Notifications</b>${list.length ? `<button class="link" id="bell-clear">Dismiss all</button>` : ""}</div>
      ${list.length ? list.map((n) => `<div class="notif notif-${n.kind}"><span class="dot"></span><div><b>${esc(n.title)}</b><p>${esc(n.text || "")}</p><small>${N.fmtTime(n.t)}</small></div></div>`).join("") : `<div class="empty-note">No notifications yet. Deployments and pipeline runs report here.</div>`}`;
    const c = pop.querySelector("#bell-clear");
    if (c) c.onclick = () => { S.state.notifications = []; S.changed("notify"); renderBell(); };
  }
  function toggleBell() {
    const pop = document.getElementById("bell-pop");
    pop.hidden = !pop.hidden;
    if (!pop.hidden) { S.state.notifications.forEach((n) => (n.read = true)); renderBell(); S.save(); updateBell(); }
  }

  /* ---------------- global search ---------------- */
  const SERVICES = [
    { label: "Lake storage accounts", route: { view: "list", type: "storage" }, type: "storage" },
    { label: "SQL databases", route: { view: "list", type: "sqldb" }, type: "sqldb" },
    { label: "Pipeline factories", route: { view: "list", type: "factory" }, type: "factory" },
    { label: "Analytics workspaces", route: { view: "list", type: "workspace" }, type: "workspace" },
    { label: "Resource groups", route: { view: "rgs" }, type: "rg" },
    { label: "Monitor", route: { view: "monitor" } },
    { label: "Learning center", route: { view: "labs" } },
    { label: "Create a resource", route: { view: "create" } },
  ];
  function setupSearch() {
    const inp = document.getElementById("gsearch"), pop = document.getElementById("search-pop");
    const run = () => {
      const q = inp.value.trim().toLowerCase();
      if (!q) { pop.hidden = true; return; }
      const svc = SERVICES.filter((s) => s.label.toLowerCase().includes(q));
      const res = S.state.resources.filter((r) => r.name.toLowerCase().includes(q) || N.typeMeta[r.type].label.toLowerCase().includes(q));
      const labs = N.labs.filter((l) => l.title.toLowerCase().includes(q) || l.concept.toLowerCase().includes(q)).slice(0, 5);
      const sec = (title, items) => items.length ? `<div class="sp-sec">${title}</div>${items.join("")}` : "";
      pop.innerHTML = sec("Services", svc.map((s) => `<button class="sp-item" data-go='${esc(JSON.stringify(s.route))}'>${s.type ? N.tile(s.type, "tile-sm") : `<span class="nav-ic">${I("chevron")}</span>`}${esc(s.label)}</button>`)) +
        sec("Resources", res.map((r) => `<button class="sp-item" data-go='${esc(JSON.stringify({ view: "resource", id: r.id }))}'>${N.tile(r.type, "tile-sm")}<span>${esc(r.name)} <small>${esc(N.typeMeta[r.type].label)}</small></span></button>`)) +
        sec("Labs", labs.map((l) => `<button class="sp-item" data-go='${esc(JSON.stringify({ view: "lab", id: l.id }))}'><span class="nav-ic">${I("labs")}</span>${esc(l.title)}</button>`)) ||
        `<div class="empty-note">No matches for “${esc(inp.value)}”.</div>`;
      pop.hidden = false;
    };
    inp.addEventListener("input", run);
    inp.addEventListener("focus", run);
    inp.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { const f = pop.querySelector(".sp-item"); if (f) { f.click(); inp.value = ""; inp.blur(); } }
      if (e.key === "Escape") { pop.hidden = true; inp.blur(); }
    });
  }

  /* ---------------- shared bits ---------------- */
  N.cmdbar = (items) => `<div class="cmdbar" role="toolbar">${items.filter(Boolean).map((it) => it === "|" ? `<span class="cmd-sep"></span>` : `<button class="cmd" ${it.id ? `id="${it.id}"` : ""} ${it.go ? `data-go='${esc(JSON.stringify(it.go))}'` : ""} ${it.disabled ? "disabled" : ""}>${I(it.icon)}<span>${esc(it.label)}</span></button>`).join("")}</div>`;
  N.statusPill = (s) => {
    const k = { Succeeded: "ok", Failed: "bad", InProgress: "run", Queued: "run", Skipped: "muted", Cancelled: "muted", Running: "ok", Online: "ok", Enabled: "ok", Disabled: "muted", Started: "ok", Stopped: "muted" }[s] || "muted";
    return `<span class="pill pill-${k}">${k === "run" ? `<span class="spin"></span>` : ""}${esc(s === "InProgress" ? "In progress" : s)}</span>`;
  };
  N.resLink = (r) => `<button class="link res-link" data-go='${esc(JSON.stringify({ view: "resource", id: r.id }))}'>${N.tile(r.type, "tile-sm")}<span>${esc(r.name)}</span></button>`;
  N.askTutor = (prompt) => { N.openTutor(prompt); };

  /* ---------------- HOME ---------------- */
  N.views.home = () => {
    const recent = [...S.state.resources].sort((a, b) => b.created - a.created).slice(0, 8);
    const nextLab = N.labs.find((l) => !N.labProgress(l).complete) || N.labs[N.labs.length - 1];
    const totalSteps = N.labs.reduce((a, l) => a + l.steps.length, 0);
    const doneSteps = N.labs.reduce((a, l) => a + N.labProgress(l).count, 0);
    const lastRuns = S.state.runs.slice(0, 5);
    const svc = [
      { label: "Create a resource", icon: "plus", go: { view: "create" }, plain: true },
      { label: "Lake storage", type: "storage", go: { view: "list", type: "storage" } },
      { label: "SQL databases", type: "sqldb", go: { view: "list", type: "sqldb" } },
      { label: "Pipeline factories", type: "factory", go: { view: "list", type: "factory" } },
      { label: "Analytics workspaces", type: "workspace", go: { view: "list", type: "workspace" } },
      { label: "Resource groups", type: "rg", go: { view: "rgs" } },
      { label: "Monitor", icon: "monitor", go: { view: "monitor" }, plain: true },
      { label: "Learning center", icon: "labs", go: { view: "labs" }, plain: true },
    ];
    return {
      live: ["resource", "runs", "flag", "lake"],
      html: `<div class="blade home">
        <section class="home-hero">
          <div>
            <h1>Welcome to Nimbus</h1>
            <p>A free cloud sandbox for learning data engineering. Everything runs in your browser: a real SQL engine, a data lake, pipelines and notebooks. Nothing costs money and nothing leaves this page.</p>
          </div>
          <div class="hero-progress">
            <div class="hp-top"><span>Learning path</span><b>${doneSteps} / ${totalSteps} steps</b></div>
            <div class="bar"><span style="width:${(doneSteps / totalSteps) * 100}%"></span></div>
            <div class="hp-next">Next: <b>${esc(nextLab.title)}</b></div>
            <button class="btn btn-primary" data-go='${esc(JSON.stringify({ view: "lab", id: nextLab.id }))}'>${doneSteps ? "Continue lab" : "Start the first lab"}</button>
          </div>
        </section>
        <h2 class="sec-title">Services</h2>
        <div class="svc-row">${svc.map((s) => `<button class="svc" data-go='${esc(JSON.stringify(s.go))}'>${s.plain ? `<span class="tile tile-lg tile-plain">${I(s.icon)}</span>` : N.tile(s.type, "tile-lg")}<span>${esc(s.label)}</span></button>`).join("")}</div>
        <div class="home-cols">
          <section class="panel">
            <div class="panel-head"><h2>Recent resources</h2><button class="link" data-go='{"view":"resources"}'>See all</button></div>
            ${recent.length ? `<table class="list"><thead><tr><th>Name</th><th>Type</th><th>Created</th></tr></thead><tbody>${recent.map((r) => `<tr><td>${N.resLink(r)}</td><td>${esc(N.typeMeta[r.type].label)}</td><td class="muted">${N.fmtTime(r.created)}</td></tr>`).join("")}</tbody></table>`
              : `<div class="empty"><p>No resources yet. Lab 1 walks you through creating a resource group and a data lake.</p><button class="btn btn-primary" data-go='{"view":"lab","id":"cloud-basics"}'>Open lab 1</button> <button class="btn" id="quick-env">Quick-start environment</button></div>`}
          </section>
          <section class="panel">
            <div class="panel-head"><h2>Recent pipeline runs</h2><button class="link" data-go='{"view":"monitor"}'>Monitor</button></div>
            ${lastRuns.length ? `<table class="list"><tbody>${lastRuns.map((r) => `<tr><td><b>${esc(r.pipeline)}</b><br><small class="muted">${esc(r.factory)} · ${esc(r.trigger.name)}</small></td><td>${N.statusPill(r.status)}</td><td class="muted">${N.fmtTime(r.start)}</td></tr>`).join("")}</tbody></table>` : `<div class="empty-note">No runs yet. Build a pipeline in lab 4.</div>`}
          </section>
        </div>
      </div>`,
      mount(root) {
        const q = root.querySelector("#quick-env");
        if (q) q.onclick = () => quickStart();
      },
    };
  };

  /* One-click environment for people who want to skip lab 1–2 basics */
  function quickStart() {
    N.modal({
      title: "Quick-start environment",
      body: `<p>This creates a ready-made environment so you can jump to later labs:</p><ul><li>Resource group <code>rg-shopstream-dev</code></li><li>Lake storage <code>lakeshopdev</code> with bronze, silver and gold containers and all ShopStream samples in bronze</li><li>SQL database <code>sqldb-shopstream</code></li><li>Pipeline factory <code>adf-shopstream</code> with linked services <code>ls_lake</code> and <code>ls_sql</code></li><li>Analytics workspace <code>ws-shopstream</code></li></ul><p class="muted">If you want to learn the basics, do labs 1 and 2 by hand instead.</p>`,
      actions: [{ label: "Create environment", kind: "primary", onClick: () => {
        const rg = "rg-shopstream-dev", reg = "South Africa North";
        S.createRG(rg, reg);
        if (!S.res("storage", "lakeshopdev")) S.createResource("storage", "lakeshopdev", rg, reg, { hns: true, redundancy: "LRS", performance: "Standard" });
        ["bronze", "silver", "gold"].forEach((c) => S.createContainer("lakeshopdev", c));
        N.sampleCatalog.filter((d) => d.id !== "shopstream-dirty").forEach((d) => d.files().forEach((f) => S.putFile("lakeshopdev", "bronze", f.path, f.content, { source: "sample", silent: true })));
        if (!S.res("sqldb", "sqldb-shopstream")) S.createResource("sqldb", "sqldb-shopstream", rg, reg, { tier: "Serverless" });
        if (!S.res("factory", "adf-shopstream")) {
          S.createResource("factory", "adf-shopstream", rg, reg, {});
          S.state.factories["adf-shopstream"].linked.push({ name: "ls_lake", type: "lake", target: "lakeshopdev" }, { name: "ls_sql", type: "sql", target: "sqldb-shopstream" });
        }
        if (!S.res("workspace", "ws-shopstream")) S.createResource("workspace", "ws-shopstream", rg, reg, { tier: "Standard" });
        S.notify("Quick-start environment ready", "Created 5 resources in rg-shopstream-dev.", "success");
        S.changed("resource");
        N.toast("Environment created", "success");
      } }, { label: "Cancel" }],
    });
  }
  N.quickStart = quickStart;

  /* ---------------- CREATE ---------------- */
  const CREATE_INFO = {
    rg: "A logical container for resources that share a lifecycle.",
    storage: "Durable file storage with folders. Turn on hierarchical namespace to use it as a data lake.",
    sqldb: "A relational database with a browser query editor. Powered by SQLite.",
    factory: "Build, schedule and monitor data pipelines that move and transform data.",
    workspace: "Notebooks for exploring and transforming data interactively with SQL.",
  };
  N.views.create = (r) => {
    if (r.type) return createForm(r);
    return {
      crumbs: [{ label: "Create a resource", route: { view: "create" } }],
      html: `<div class="blade"><div class="blade-head"><h1>Create a resource</h1><p class="muted">Pick a service. Each card notes what it is called in Azure, so the names you learn here transfer.</p></div>
        <div class="market">${["rg", "storage", "sqldb", "factory", "workspace"].map((t) => `<button class="mk-card" data-go='${esc(JSON.stringify({ view: "create", type: t }))}'>${N.tile(t, "tile-lg")}<div><b>${esc(N.typeMeta[t].label)}</b><p>${esc(CREATE_INFO[t])}</p>${N.typeMeta[t].real ? `<small>In Azure: ${esc(N.typeMeta[t].real)}</small>` : ""}<span class="mk-cta">Create</span></div></button>`).join("")}</div></div>`,
    };
  };

  const NAME_RULES = {
    rg: { re: /^[\w\-.()]{1,90}$/, msg: "1–90 characters: letters, digits, - _ . ( )" },
    storage: { re: /^[a-z0-9]{3,24}$/, msg: "3–24 characters, lowercase letters and digits only. Must be unique." },
    sqldb: { re: /^[a-zA-Z0-9][\w-]{0,62}$/, msg: "1–63 characters: letters, digits, - and _" },
    factory: { re: /^[a-zA-Z0-9][a-zA-Z0-9-]{2,62}$/, msg: "3–63 characters: letters, digits and -" },
    workspace: { re: /^[a-zA-Z0-9][\w-]{2,62}$/, msg: "3–63 characters: letters, digits, - and _" },
  };

  function createForm(r) {
    const t = r.type, meta = N.typeMeta[t];
    const form = r.form || (r.form = { rg: (S.state.rgs[0] || {}).name || "", newRg: "", name: "", region: REGIONS[0], hns: true, redundancy: "LRS", performance: "Standard", tier: "Serverless", ws: "Standard" });
    const step = r.step || "basics";
    const crumbs = [{ label: "Create a resource", route: { view: "create" } }, { label: meta.label, route: r }];
    if (step === "deploy") return deployView(r, crumbs);
    const errs = validate(t, form);
    const typeFields = {
      storage: `<div class="field"><label>Performance</label><div class="radios">${["Standard", "Premium"].map((v) => `<label><input type="radio" name="perf" value="${v}" ${form.performance === v ? "checked" : ""}> ${v}</label>`).join("")}</div></div>
        <div class="field"><label for="f-red">Redundancy</label><select id="f-red">${[["LRS", "Locally-redundant storage (LRS)"], ["ZRS", "Zone-redundant storage (ZRS)"], ["GRS", "Geo-redundant storage (GRS)"]].map(([v, l]) => `<option value="${v}" ${form.redundancy === v ? "selected" : ""}>${l}</option>`).join("")}</select><small class="muted">How many copies of your data are kept and where. LRS is cheapest; GRS survives a regional outage.</small></div>
        <div class="field"><label class="check"><input type="checkbox" id="f-hns" ${form.hns ? "checked" : ""}> Enable hierarchical namespace</label><small class="muted">Required for data lake workloads: real folders, atomic renames, per-directory permissions.</small></div>`,
      sqldb: `<div class="field"><label for="f-tier">Compute tier</label><select id="f-tier">${["Serverless", "Provisioned", "Basic"].map((v) => `<option ${form.tier === v ? "selected" : ""}>${v}</option>`).join("")}</select><small class="muted">Serverless pauses when idle, which suits labs. (Sandbox only: every tier runs the same engine.)</small></div>`,
      workspace: `<div class="field"><label for="f-ws">Pricing tier</label><select id="f-ws">${["Standard", "Premium"].map((v) => `<option ${form.ws === v ? "selected" : ""}>${v}</option>`).join("")}</select></div>`,
      factory: `<div class="field"><label>Git configuration</label><label class="check"><input type="checkbox" disabled> Configure Git later</label><small class="muted">Production factories store pipeline JSON in Git for review and CI/CD.</small></div>`,
      rg: "",
    }[t];
    const basics = `
      <h3 class="form-sec">Project details</h3>
      <div class="field"><label>Subscription</label><select disabled><option>Free learning subscription</option></select></div>
      ${t !== "rg" ? `<div class="field"><label for="f-rg">Resource group <span class="req">*</span></label>
        <select id="f-rg"><option value="">Select a resource group</option>${S.state.rgs.map((g) => `<option ${form.rg === g.name ? "selected" : ""}>${esc(g.name)}</option>`).join("")}<option value="__new" ${form.rg === "__new" ? "selected" : ""}>Create new…</option></select>
        ${form.rg === "__new" ? `<input id="f-newrg" placeholder="New resource group name" value="${esc(form.newRg)}">` : ""}
        ${errs.rg && r.touched ? `<small class="err">${esc(errs.rg)}</small>` : ""}</div>` : ""}
      <h3 class="form-sec">${t === "rg" ? "Resource group details" : "Instance details"}</h3>
      <div class="field"><label for="f-name">${t === "rg" ? "Resource group" : "Name"} <span class="req">*</span></label><input id="f-name" value="${esc(form.name)}" placeholder="${{ rg: "rg-shopstream-dev", storage: "lakeshopdev", sqldb: "sqldb-shopstream", factory: "adf-shopstream", workspace: "ws-shopstream" }[t]}" autocomplete="off">
        ${errs.name && (r.touched || form.name) ? `<small class="err">${esc(errs.name)}</small>` : `<small class="muted">${esc(NAME_RULES[t].msg)}</small>`}</div>
      <div class="field"><label for="f-region">Region</label><select id="f-region">${REGIONS.map((x) => `<option ${form.region === x ? "selected" : ""}>${x}</option>`).join("")}</select><small class="muted">Keep data, compute and users in the same region to cut latency and egress cost.</small></div>
      ${typeFields}`;
    const review = `<div class="callout callout-ok">${I("check")} Validation passed</div>
      <table class="kv">${[["Subscription", "Free learning subscription"], t !== "rg" ? ["Resource group", form.rg === "__new" ? form.newRg + " (new)" : form.rg] : null, ["Name", form.name], ["Region", form.region],
        t === "storage" ? ["Performance", form.performance] : null, t === "storage" ? ["Redundancy", form.redundancy] : null, t === "storage" ? ["Hierarchical namespace", form.hns ? "Enabled" : "Disabled"] : null,
        t === "sqldb" ? ["Compute tier", form.tier] : null, t === "workspace" ? ["Pricing tier", form.ws] : null].filter(Boolean).map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join("")}</table>
      <p class="muted">In a paid cloud this resource would start billing now. Here it is free.</p>`;
    return {
      crumbs,
      html: `<div class="blade"><div class="blade-head"><h1>Create ${esc(meta.label.toLowerCase())}</h1></div>
        <div class="tabs"><button class="tab ${step === "basics" ? "active" : ""}" id="tab-basics">Basics</button><button class="tab ${step === "review" ? "active" : ""}" id="tab-review">Review + create</button></div>
        <div class="form">${step === "basics" ? basics : review}</div>
        <div class="form-foot">${step === "basics" ? `<button class="btn btn-primary" id="to-review">Review + create</button>` : `<button class="btn btn-primary" id="do-create">Create</button><button class="btn" id="to-basics">Previous</button>`}</div></div>`,
      mount(root) {
        const val = (id) => root.querySelector(id);
        const bind = (id, key, ev = "input", rerender = false) => { const el = val(id); if (el) el.addEventListener(ev, () => { form[key] = el.type === "checkbox" ? el.checked : el.value; if (rerender) N.rerender(); }); };
        bind("#f-name", "name"); bind("#f-region", "region", "change"); bind("#f-rg", "rg", "change", true); bind("#f-newrg", "newRg");
        bind("#f-red", "redundancy", "change"); bind("#f-hns", "hns", "change"); bind("#f-tier", "tier", "change"); bind("#f-ws", "ws", "change");
        root.querySelectorAll("input[name=perf]").forEach((el) => el.addEventListener("change", () => (form.performance = el.value)));
        const toReview = () => { r.touched = true; const e = validate(t, form); if (Object.keys(e).length) { N.rerender(); N.toast(Object.values(e)[0], "error"); return; } r.step = "review"; N.rerender(); };
        if (val("#to-review")) val("#to-review").onclick = toReview;
        val("#tab-review").onclick = toReview;
        val("#tab-basics").onclick = () => { r.step = "basics"; N.rerender(); };
        if (val("#to-basics")) val("#to-basics").onclick = () => { r.step = "basics"; N.rerender(); };
        if (val("#do-create")) val("#do-create").onclick = () => { r.step = "deploy"; r.deployStart = Date.now(); N.rerender(); doDeploy(r); };
        if (val("#f-name")) val("#f-name").addEventListener("keydown", (e) => { if (e.key === "Enter") toReview(); });
      },
    };
  }

  function validate(t, f) {
    const e = {};
    if (!NAME_RULES[t].re.test(f.name || "")) e.name = f.name ? NAME_RULES[t].msg : "Enter a name.";
    else if (t === "rg" ? S.state.rgs.some((g) => g.name.toLowerCase() === f.name.toLowerCase()) : S.nameTaken(t, f.name)) e.name = `A ${t === "rg" ? "resource group" : "resource"} named "${f.name}" already exists.`;
    if (t !== "rg") {
      if (!f.rg) e.rg = "Select or create a resource group.";
      if (f.rg === "__new" && !NAME_RULES.rg.re.test(f.newRg || "")) e.rg = "Enter a valid name for the new resource group.";
    }
    return e;
  }

  function doDeploy(r) {
    const f = r.form, t = r.type;
    setTimeout(() => {
      let rg = f.rg;
      if (t === "rg") S.createRG(f.name, f.region);
      else {
        if (rg === "__new") { rg = f.newRg; S.createRG(rg, f.region); }
        const props = t === "storage" ? { hns: f.hns, redundancy: f.redundancy, performance: f.performance } : t === "sqldb" ? { tier: f.tier } : t === "workspace" ? { tier: f.ws } : {};
        r.created = S.createResource(t, f.name, rg, f.region, props);
      }
      r.done = true;
      S.notify("Deployment succeeded", `${N.typeMeta[t].label} ${f.name} was created.`, "success");
      S.changed("resource");
      if (N.route() === r) N.rerender();
    }, 1400);
  }

  function deployView(r, crumbs) {
    const f = r.form;
    return {
      crumbs,
      html: `<div class="blade"><div class="deploy">
        <div class="deploy-ic ${r.done ? "ok" : ""}">${r.done ? I("check") : `<span class="spin spin-lg"></span>`}</div>
        <div><h1>${r.done ? "Your deployment is complete" : "Deployment is in progress"}</h1>
        <table class="kv"><tr><th>Deployment name</th><td>${esc(r.type)}-${esc(f.name)}-${new Date(r.deployStart).toISOString().slice(0, 16).replace(/[-:T]/g, "")}</td></tr><tr><th>Subscription</th><td>Free learning subscription</td></tr><tr><th>Start time</th><td>${N.fmtTime(r.deployStart)}</td></tr></table>
        ${r.done ? `<div class="btn-row"><button class="btn btn-primary" data-go='${esc(JSON.stringify(r.type === "rg" ? { view: "rg", name: f.name } : { view: "resource", id: r.created.id }))}'>Go to resource</button><button class="btn" data-go='{"view":"create"}'>Create another resource</button></div>` : `<p class="muted">Behind the scenes a cloud turns your form into a template and provisions it. Real deployments take seconds to minutes.</p>`}</div>
      </div></div>`,
    };
  }

  /* ---------------- LISTS ---------------- */
  function resourceTable(list, { showRg = true } = {}) {
    if (!list.length) return "";
    return `<div class="table-wrap"><table class="list"><thead><tr><th>Name</th><th>Type</th>${showRg ? "<th>Resource group</th>" : ""}<th>Location</th><th>Created</th></tr></thead><tbody>
      ${list.map((r) => `<tr><td>${N.resLink(r)}</td><td>${esc(N.typeMeta[r.type].label)}</td>${showRg ? `<td><button class="link" data-go='${esc(JSON.stringify({ view: "rg", name: r.rg }))}'>${esc(r.rg)}</button></td>` : ""}<td>${esc(r.region)}</td><td class="muted">${N.fmtTime(r.created)}</td></tr>`).join("")}</tbody></table></div>`;
  }
  N.views.resources = (r) => {
    const q = (r.q || "").toLowerCase();
    const list = S.state.resources.filter((x) => !q || x.name.toLowerCase().includes(q));
    return {
      live: ["resource"],
      crumbs: [{ label: "All resources", route: { view: "resources" } }],
      html: `<div class="blade"><div class="blade-head"><h1>All resources</h1></div>${N.cmdbar([{ icon: "plus", label: "Create", go: { view: "create" } }, { icon: "refresh", label: "Refresh", id: "refresh" }])}
        <div class="filter-row"><input id="flt" placeholder="Filter by name…" value="${esc(r.q || "")}" aria-label="Filter by name"><span class="muted">${list.length} records</span></div>
        ${resourceTable(list) || `<div class="empty"><p>No resources found.</p><button class="btn btn-primary" data-go='{"view":"create"}'>Create a resource</button></div>`}</div>`,
      mount(root) {
        root.querySelector("#flt").addEventListener("input", (e) => { r.q = e.target.value; N.rerender(); const f = document.getElementById("flt"); f.focus(); f.setSelectionRange(f.value.length, f.value.length); });
        root.querySelector("#refresh").onclick = () => N.rerender();
      },
    };
  };
  N.views.list = (r) => {
    const m = N.typeMeta[r.type];
    const list = S.resOfType(r.type);
    return {
      live: ["resource"],
      crumbs: [{ label: m.plural, route: r }],
      html: `<div class="blade"><div class="blade-head with-tile">${N.tile(r.type, "tile-lg")}<div><h1>${esc(m.plural)}</h1><p class="muted">In Azure: ${esc(m.real)}</p></div></div>
        ${N.cmdbar([{ icon: "plus", label: "Create", go: { view: "create", type: r.type } }])}
        ${resourceTable(list) || `<div class="empty"><p>No ${esc(m.plural.toLowerCase())} yet.</p><button class="btn btn-primary" data-go='${esc(JSON.stringify({ view: "create", type: r.type }))}'>Create ${esc(m.label.toLowerCase())}</button></div>`}</div>`,
    };
  };
  N.views.rgs = () => ({
    live: ["resource"],
    crumbs: [{ label: "Resource groups", route: { view: "rgs" } }],
    html: `<div class="blade"><div class="blade-head with-tile">${N.tile("rg", "tile-lg")}<div><h1>Resource groups</h1></div></div>${N.cmdbar([{ icon: "plus", label: "Create", go: { view: "create", type: "rg" } }])}
      ${S.state.rgs.length ? `<div class="table-wrap"><table class="list"><thead><tr><th>Name</th><th>Location</th><th>Resources</th><th>Created</th></tr></thead><tbody>${S.state.rgs.map((g) => `<tr><td><button class="link res-link" data-go='${esc(JSON.stringify({ view: "rg", name: g.name }))}'>${N.tile("rg", "tile-sm")}<span>${esc(g.name)}</span></button></td><td>${esc(g.region)}</td><td>${S.state.resources.filter((x) => x.rg === g.name).length}</td><td class="muted">${N.fmtTime(g.created)}</td></tr>`).join("")}</tbody></table></div>`
        : `<div class="empty"><p>No resource groups yet.</p><button class="btn btn-primary" data-go='{"view":"create","type":"rg"}'>Create resource group</button></div>`}</div>`,
  });
  N.views.rg = (r) => {
    const g = S.state.rgs.find((x) => x.name === r.name);
    if (!g) return { html: `<div class="blade"><div class="empty"><p>Resource group “${esc(r.name)}” no longer exists.</p></div></div>` };
    const list = S.state.resources.filter((x) => x.rg === g.name);
    return {
      live: ["resource"],
      crumbs: [{ label: "Resource groups", route: { view: "rgs" } }, { label: g.name, route: r }],
      html: `<div class="blade"><div class="blade-head with-tile">${N.tile("rg", "tile-lg")}<div><h1>${esc(g.name)}</h1><p class="muted">Resource group</p></div></div>
        ${N.cmdbar([{ icon: "plus", label: "Create", go: { view: "create" } }, "|", { icon: "trash", label: "Delete resource group", id: "del-rg" }])}
        <table class="kv essentials"><tr><th>Subscription</th><td>Free learning subscription</td></tr><tr><th>Location</th><td>${esc(g.region)}</td></tr><tr><th>Resources</th><td>${list.length}</td></tr></table>
        ${resourceTable(list, { showRg: false }) || `<div class="empty-note">This group is empty.</div>`}</div>`,
      mount(root) {
        root.querySelector("#del-rg").onclick = () => {
          N.modal({
            title: `Delete ${g.name}`,
            body: `<div class="callout callout-error">This deletes the group and all ${list.length} resources in it, including their data. It cannot be undone.</div><div class="field"><label for="cf">Type the resource group name to confirm</label><input id="cf" autocomplete="off"></div>`,
            actions: [{ label: "Delete", kind: "danger", onClick: async (close, w) => { if (w.querySelector("#cf").value !== g.name) { N.toast("The name does not match.", "error"); return false; } await S.deleteRG(g.name); N.toast(`Deleted ${g.name}`, "success"); N.go({ view: "rgs" }); } }, { label: "Cancel" }],
          });
        };
      },
    };
  };

  /* ---------------- RESOURCE BLADE (dispatch) ---------------- */
  N.resourceTabs = {};
  N.views.resource = (r) => {
    const res = S.resById(r.id);
    if (!res) return { html: `<div class="blade"><div class="empty"><p>This resource no longer exists.</p><button class="btn" data-go='{"view":"resources"}'>All resources</button></div></div>` };
    const tabs = N.resourceTabs[res.type];
    const tab = r.tab || "overview";
    const def = tabs.find((t) => t.id === tab) || tabs[0];
    const out = def.render(res, r) || {};
    const crumbs = [{ label: N.typeMeta[res.type].plural, route: { view: "list", type: res.type } }, { label: res.name, route: { view: "resource", id: res.id } }];
    if (out.crumbs) crumbs.push(...out.crumbs);
    return {
      live: out.live,
      crumbs,
      html: `<div class="res-blade">
        <aside class="res-menu"><div class="res-title">${N.tile(res.type, "tile-lg")}<div><b>${esc(res.name)}</b><small>${esc(N.typeMeta[res.type].label)}</small></div></div>
        ${tabs.map((t) => t.group ? `<div class="rm-group">${esc(t.group)}</div>` : `<button class="rm-item ${t.id === def.id ? "active" : ""}" data-go='${esc(JSON.stringify({ view: "resource", id: res.id, tab: t.id }))}'>${I(t.icon)}<span>${esc(t.label)}</span></button>`).join("")}</aside>
        <div class="res-content">${out.html || ""}</div></div>`,
      mount: out.mount,
    };
  };
  /* Recompute live list per tab */
  Object.defineProperty(N.views.resource, "live", {
    get() {
      const r = N.route(); const res = r && S.resById(r.id);
      if (!res) return ["resource"];
      const tabs = N.resourceTabs[res.type]; const def = tabs.find((t) => t.id === (r.tab || "overview")) || tabs[0];
      return ["resource", ...(def.live || [])];
    },
  });

  N.overview = (res, extraRows, learnHtml) => `
    ${N.cmdbar([{ icon: "trash", label: "Delete", id: "del-res" }, { icon: "tutor", label: "Ask tutor about this service", id: "ask-svc" }])}
    <h2 class="sec-title">Essentials</h2>
    <div class="essentials-grid"><table class="kv">
      <tr><th>Resource group</th><td><button class="link" data-go='${esc(JSON.stringify({ view: "rg", name: res.rg }))}'>${esc(res.rg)}</button></td></tr>
      <tr><th>Status</th><td>${N.statusPill(res.type === "sqldb" ? "Online" : "Running")}</td></tr>
      <tr><th>Location</th><td>${esc(res.region)}</td></tr>
      <tr><th>Subscription</th><td>Free learning subscription</td></tr>
      <tr><th>Created</th><td>${N.fmtTime(res.created)}</td></tr></table>
      <table class="kv">${extraRows.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${v}</td></tr>`).join("")}</table></div>
    <div class="learn-card">${I("book")}<div><b>How this maps to the real cloud</b><p>${esc(N.typeMeta[res.type].real)}.</p>${learnHtml || ""}</div></div>`;
  N.mountOverview = (root, res) => {
    root.querySelector("#del-res").onclick = () => {
      N.modal({
        title: `Delete ${res.name}`,
        body: `<div class="callout callout-error">Deleting removes the resource and all of its data.</div><div class="field"><label for="cf">Type the resource name to confirm</label><input id="cf" autocomplete="off"></div>`,
        actions: [{ label: "Delete", kind: "danger", onClick: async (close, w) => { if (w.querySelector("#cf").value !== res.name) { N.toast("The name does not match.", "error"); return false; } await S.deleteResource(res); N.toast(`Deleted ${res.name}`, "success"); N.go({ view: "list", type: res.type }); } }, { label: "Cancel" }],
      });
    };
    root.querySelector("#ask-svc").onclick = () => N.askTutor(`Explain what a ${N.typeMeta[res.type].label} (${N.typeMeta[res.type].real}) is used for in data engineering, with one realistic example.`);
  };

  /* ---------------- ACTIVITY LOG ---------------- */
  N.views.log = () => ({
    live: ["resource", "lake", "runs"],
    crumbs: [{ label: "Activity log", route: { view: "log" } }],
    html: `<div class="blade"><div class="blade-head"><h1>Activity log</h1><p class="muted">Every operation in your subscription, newest first. Cloud audit logs answer “who changed what, when”.</p></div>
      ${S.state.log.length ? `<div class="table-wrap"><table class="list"><thead><tr><th>Operation</th><th>Target</th><th>Status</th><th>Time</th><th>Caller</th></tr></thead><tbody>${S.state.log.slice(0, 200).map((l) => `<tr><td>${esc(l.op)}</td><td><code>${esc(l.target)}</code></td><td>${N.statusPill(l.status)}</td><td class="muted">${N.fmtTime(l.t)}</td><td class="muted">learner@nimbus</td></tr>`).join("")}</tbody></table></div>` : `<div class="empty-note">No activity yet.</div>`}</div>`,
  });

  /* ---------------- SETTINGS ---------------- */
  N.views.settings = () => {
    const th = (() => { try { return localStorage.getItem("nimbus-theme") || "system"; } catch (e) { return "system"; } })();
    const lakeBytes = Object.values(S.state.lake).reduce((a, x) => a + Object.values(x.containers).reduce((b, c) => b + Object.values(c.files).reduce((s, f) => s + f.size, 0), 0), 0);
    return {
      crumbs: [{ label: "Settings", route: { view: "settings" } }],
      html: `<div class="blade"><div class="blade-head"><h1>Portal settings</h1></div>
        <div class="form">
          <h3 class="form-sec">Appearance</h3>
          <div class="field"><label>Theme</label><div class="radios">${["system", "light", "dark"].map((v) => `<label><input type="radio" name="theme" value="${v}" ${th === v ? "checked" : ""}> ${v[0].toUpperCase() + v.slice(1)}</label>`).join("")}</div></div>
          <h3 class="form-sec">Your sandbox</h3>
          <table class="kv"><tr><th>Storage</th><td>${S.persistent ? "Saved in this browser (IndexedDB). It stays after reloads, but not across devices." : "Not persistent: this browser blocks storage, so work is lost on reload."}</td></tr>
          <tr><th>Resources</th><td>${S.state.resources.length}</td></tr><tr><th>Lake data</th><td>${N.fmtBytes(lakeBytes)}</td></tr><tr><th>Pipeline runs kept</th><td>${S.state.runs.length}</td></tr></table>
          <div class="btn-row"><button class="btn" id="exp">Export environment (JSON)</button><button class="btn btn-danger" id="reset">Reset everything</button></div>
        </div></div>`,
      mount(root) {
        root.querySelectorAll("input[name=theme]").forEach((el) => el.addEventListener("change", () => N.setTheme(el.value)));
        root.querySelector("#reset").onclick = async () => {
          if (await N.confirmDialog("Reset the sandbox", "This deletes every resource group, resource, file, table, pipeline, run and lab progress. It cannot be undone.", "Reset everything")) {
            await S.resetAll(); N.toast("Sandbox reset", "success"); N.go({ view: "home" });
          }
        };
        root.querySelector("#exp").onclick = () => {
          const dbs = {};
          for (const [n, d] of Object.entries(S.dbs)) dbs[n] = S.tables(d).map((t) => ({ table: t.name, type: t.type, columns: t.cols.map((c) => c.name + " " + c.type).join(", "), rows: t.rows }));
          N.downloadText("nimbus-environment.json", JSON.stringify({ exported: new Date().toISOString(), resourceGroups: S.state.rgs, resources: S.state.resources, factories: S.state.factories, notebooks: S.state.notebooks, databases: dbs }, null, 2), "application/json");
        };
      },
    };
  };
  N.setTheme = (v) => {
    try { localStorage.setItem("nimbus-theme", v); } catch (e) {}
    if (v === "system") document.documentElement.removeAttribute("data-theme"); else document.documentElement.setAttribute("data-theme", v);
  };

  /* ---------------- BOOT ---------------- */
  N.boot = async () => {
    try { const th = localStorage.getItem("nimbus-theme"); if (th && th !== "system") document.documentElement.setAttribute("data-theme", th); } catch (e) {}
    buildShell();
    document.getElementById("main").innerHTML = `<div class="boot"><span class="spin spin-lg"></span><p>Starting your sandbox…</p></div>`;
    try {
      await S.init();
    } catch (e) {
      document.getElementById("main").innerHTML = `<div class="blade"><div class="callout callout-error">The SQL engine could not start: ${esc(e.message || e)}. Check your connection and reload.</div></div>`;
      return;
    }
    try { const saved = JSON.parse(localStorage.getItem("nimbus-route") || "null"); if (saved && N.views[saved.view] && !saved.step) current = saved; } catch (e) {}
    if (current.view === "resource" && !S.resById(current.id)) current = { view: "home" };
    updateBell();
    render();
    if (window.innerWidth < 900) document.body.classList.remove("nav-open");
  };
})(window.N);
