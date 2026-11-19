/* Nimbus Portal — DE101 course UI: syllabus, unit pages, quizzes, autograder console, drills, transcript, home */
(function (N) {
  const S = N.store, C = N.course, esc = N.esc, I = N.icon;
  const J = (o) => esc(JSON.stringify(o));
  const grade = (pct) => (pct >= 93 ? "A" : pct >= 90 ? "A−" : pct >= 87 ? "B+" : pct >= 83 ? "B" : pct >= 80 ? "B−" : pct >= 77 ? "C+" : pct >= 70 ? "C" : pct >= 60 ? "D" : "F");

  function totals() {
    let got = 0, max = 0, quiz = 0, quizMax = 0;
    C.units.forEach((u) => { const s = S.state.course[u.id] || {}; got += s.best || 0; max += C.total(u); if (s.quiz) quiz += s.quiz.score; quizMax += u.quiz.length; });
    const pct = max ? (0.85 * got / max + 0.15 * (quizMax ? quiz / quizMax : 0)) * 100 : 0;
    return { got, max, quiz, quizMax, pct };
  }

  /* ================= syllabus ================= */
  N.views.labs = () => {
    const t = totals();
    return {
      live: ["course", "runs"],
      crumbs: [{ label: "DE101 Practicals", route: { view: "labs" } }],
      html: `<div class="blade course">
        <div class="course-head">
          <div><div class="lab-num">DE101 · Practicals</div><h1>Data Engineering on Azure</h1>
            <p class="muted">Ten practicals. Each has lecture notes, a pre-lab quiz, a precise specification, the exact Azure equivalent (portal path, CLI, T-SQL, ADF JSON, Bicep) and an autograder that attacks your solution the way production would: reruns, duplicate deliveries, malformed files, broken permissions.</p>
            <div class="chip-row"><span class="pill ${S.realStrict() ? "pill-ok" : "pill-bad"}">${I("shield")} Realism: ${S.realStrict() ? "Strict" : "Guided (grading disabled)"}</span><button class="link" data-go='{"view":"realism"}'>What is identical to Azure, and what isn't</button></div></div>
          <div class="transcript-card"><div class="tc-grade">${t.max ? grade(t.pct) : "–"}</div><div><b>${t.pct.toFixed(1)}%</b><small class="muted">85% practicals (${t.got}/${t.max} pts) · 15% quizzes (${t.quiz}/${t.quizMax})</small></div></div>
        </div>
        <div class="syllabus">${C.units.map((u) => { const s = S.state.course[u.id] || {}; const tot = C.total(u); const done = s.best === tot; return `<button class="syl-row ${done ? "done" : ""}" data-go='${J({ view: "unit", id: u.id })}'>
          <span class="syl-code">${esc(u.code)}</span>
          <span class="syl-main"><b>${esc(u.title)}</b><small class="muted">${esc(u.weeks)} · ~${u.minutes} min · ${u.spec.length} requirements · ${tot} pts</small></span>
          <span class="syl-q">${s.quiz ? `Quiz ${s.quiz.score}/${u.quiz.length}` : `<span class="muted">Quiz –</span>`}</span>
          <span class="syl-score">${s.best != null ? `<b>${s.best}</b>/${tot}` : `<span class="muted">not graded</span>`}<span class="bar thin"><span style="width:${((s.best || 0) / tot) * 100}%"></span></span></span>
          ${done ? `<span class="pill pill-ok">${I("check")} Passed</span>` : ""}
        </button>`; }).join("")}</div>
        <div class="learn-card">${I("info")}<div><b>How grading works</b><p>Run the autograder as often as you like; your best score counts. Each revealed hint costs 1 point on that practical. Graders read your real state: resources, permissions, published pipelines, table contents and files. Several graders <i>run your published pipelines</i> and drop files into your lake, so finish building and <b>Publish all</b> before grading. Practicals build on each other: P2 needs P1, P4 needs P2 and P3, and so on.</p></div></div>
      </div>`,
    };
  };

  /* ================= unit page ================= */
  N.views.unit = (r) => {
    const u = C.unit(r.id);
    if (!u) return N.views.labs(r);
    if (C.active() !== u) C.setActive(u.id);
    const s = C.state(u.id);
    const tab = r.tab || "lecture";
    const idx = C.units.indexOf(u);
    let body = "";
    if (tab === "lecture") body = `<article class="lecture">${u.lecture}</article>`;
    if (tab === "quiz") body = quizHtml(u, s, r);
    if (tab === "spec") body = specHtml(u, s);
    if (tab === "azure") body = `<article class="lecture azure-sheet">${u.azure()}</article>`;
    if (tab === "grader") body = graderHtml(u, s);
    return {
      live: tab === "spec" || tab === "grader" ? ["course"] : [],
      crumbs: [{ label: "DE101 Practicals", route: { view: "labs" } }, { label: u.code, route: { view: "unit", id: u.id } }],
      html: `<div class="blade unit">
        <div class="unit-head"><div class="lab-num">${esc(u.code)} · ${esc(u.weeks)} · ~${u.minutes} min</div><h1>${esc(u.title)}</h1>
          <div class="unit-score">${s.best != null ? `Best <b>${s.best}</b>/${C.total(u)}` : "Not graded yet"} · ${s.attempts || 0} attempt${s.attempts === 1 ? "" : "s"}${(s.hints || []).length ? ` · ${(s.hints || []).length} hint${s.hints.length > 1 ? "s" : ""} used (−${s.hints.length})` : ""}</div></div>
        <div class="tabs unit-tabs">${[["lecture", "1. Lecture"], ["quiz", "2. Pre-lab quiz"], ["spec", "3. Specification"], ["azure", "4. In real Azure"], ["grader", "5. Autograder"]].map(([k, l]) => `<button class="tab ${k === tab ? "active" : ""}" data-go='${J({ view: "unit", id: u.id, tab: k })}'>${l}</button>`).join("")}</div>
        ${body}
        <div class="btn-row lab-nav">${idx > 0 ? `<button class="btn btn-sm" data-go='${J({ view: "unit", id: C.units[idx - 1].id })}'>${I("back")} ${esc(C.units[idx - 1].code)}</button>` : ""}<span class="grow"></span><button class="btn btn-sm" id="ask-unit">${I("tutor")} Ask the instructor</button>${idx < C.units.length - 1 ? `<button class="btn btn-sm" data-go='${J({ view: "unit", id: C.units[idx + 1].id })}'>${esc(C.units[idx + 1].code)} ${I("chevron")}</button>` : ""}</div>
      </div>`,
      mount(root) {
        root.querySelector("#ask-unit").onclick = () => N.openTutor();
        if (tab === "quiz") mountQuiz(root, u, s, r);
        if (tab === "spec") mountSpec(root, u, s);
        if (tab === "grader") mountGrader(root, u, s);
        root.querySelectorAll("[data-copy-setup]").forEach((b) => (b.onclick = () => N.copyText(C.p3Setup)));
        root.querySelectorAll("[data-run-setup]").forEach((b) => (b.onclick = () => { const d = S.resOfType("sqldb").find((x) => x.name === "sqldb-de101"); if (!d) { N.toast("Create sqldb-de101 first (P2).", "error"); return; } N.pendingQuery = C.p3Setup; N.go({ view: "resource", id: d.id, tab: "query" }); }));
      },
    };
  };

  function quizHtml(u, s, r) {
    const q = s.quiz;
    const ans = r.answers || (q ? q.answers : []);
    return `<div class="quiz"><p class="muted">Answer before the practical. You can retake it; the latest score counts. Explanations appear after you submit.</p>
      ${u.quiz.map((x, i) => `<fieldset class="q ${q ? (q.answers[i] === x.c ? "right" : "wrong") : ""}"><legend><b>Q${i + 1}.</b> ${esc(x.q)}</legend>${x.a.map((a, j) => `<label class="q-opt ${q && j === x.c ? "correct" : ""}"><input type="radio" name="q${i}" value="${j}" ${ans[i] === j ? "checked" : ""} ${q ? "disabled" : ""}> ${esc(a)}</label>`).join("")}${q ? `<p class="q-why">${q.answers[i] === x.c ? I("check") : I("x")} ${esc(x.why)}</p>` : ""}</fieldset>`).join("")}
      <div class="btn-row">${q ? `<b>Score: ${q.score}/${u.quiz.length}</b><button class="btn" id="retake">Retake</button><button class="btn btn-primary" data-go='${J({ view: "unit", id: u.id, tab: "spec" })}'>Go to the specification</button>` : `<button class="btn btn-primary" id="submit-quiz">Submit answers</button>`}</div></div>`;
  }
  function mountQuiz(root, u, s, r) {
    const sub = root.querySelector("#submit-quiz");
    if (sub) sub.onclick = () => {
      const answers = u.quiz.map((x, i) => { const el = root.querySelector(`input[name=q${i}]:checked`); return el ? +el.value : -1; });
      if (answers.includes(-1)) { N.toast("Answer every question first.", "error"); return; }
      s.quiz = { answers, score: answers.filter((a, i) => a === u.quiz[i].c).length, t: Date.now() };
      S.changed("course"); N.rerender();
    };
    const re = root.querySelector("#retake"); if (re) re.onclick = () => { s.quiz = null; S.changed("course"); N.rerender(); };
  }

  function reqStatus(u, s, req) {
    if (!s.last) return null;
    const rs = s.last.results.filter((x) => x.req === req);
    if (!rs.length) return null;
    return rs.every((x) => x.pass) ? "pass" : rs.some((x) => x.pass) ? "partial" : "fail";
  }
  function specHtml(u, s) {
    return `<div class="spec"><p class="muted">Build exactly this. Names, types and behaviours are checked literally, as a reviewer or a downstream consumer would. Where you see a choice, any correct design passes.</p>
      <ol class="spec-list">${u.spec.map((x) => { const st = reqStatus(u, s, x.id); const hint = (u.hints || {})[x.id]; const used = (s.hints || []).includes(x.id); return `<li class="spec-item ${st || ""}"><span class="spec-id">${esc(x.id)}</span><div class="spec-body"><div>${x.text}</div>${x.id === "R3.2" ? `<div class="btn-row"><button class="btn btn-sm" data-run-setup>Open the setup script in the query editor</button><button class="btn btn-sm" data-copy-setup>Copy setup script</button></div>` : ""}${hint ? (used ? `<div class="hint-open">${I("info")} ${esc(hint)}</div>` : `<button class="link hint-btn" data-hint="${esc(x.id)}">Reveal hint (−1 point)</button>`) : ""}</div><span class="spec-st">${st === "pass" ? N.statusPill("Succeeded") : st === "fail" ? N.statusPill("Failed") : st === "partial" ? `<span class="pill pill-run">Partial</span>` : `<span class="pill pill-muted">Not graded</span>`}</span></li>`; }).join("")}</ol>
      ${u.drills ? drillsHtml(u, s) : ""}
      <div class="btn-row"><button class="btn btn-primary" data-go='${J({ view: "unit", id: u.id, tab: "grader" })}'>Run the autograder</button></div></div>`;
  }
  function mountSpec(root, u, s) {
    root.querySelectorAll("[data-hint]").forEach((b) => (b.onclick = async () => { if (await N.confirmDialog("Reveal hint", "This costs 1 point on this practical, permanently.", "Reveal", "primary")) { s.hints = s.hints || []; s.hints.push(b.dataset.hint); S.changed("course"); N.rerender(); } }));
    if (u.drills) mountDrills(root, u, s);
  }

  /* ---- drills (P10) ---- */
  function drillsHtml(u, s) {
    s.drills = s.drills || {};
    return `<h2 class="sec-title">Incident drills</h2><div class="drills">${u.drills.map((d) => { const x = s.drills[d.id] || {}; return `<div class="drill ${x.started ? "live" : ""}"><div class="drill-head">${I("bolt")}<b>${esc(d.title)}</b>${x.started ? `<span class="pill pill-bad">Incident open</span>` : ""}</div>
      ${x.started ? `<p class="alert-text">${esc(d.alert)}</p><div class="field"><label>Root cause layer</label><select data-cause="${d.id}"><option value="">Select…</option>${d.causes.map((c, i) => `<option value="${i}" ${x.cause === i ? "selected" : ""}>${esc(c)}</option>`).join("")}</select></div><p class="muted">Restore service, choose the cause, then run the autograder.</p>` : `<button class="btn btn-sm btn-danger" data-drill="${d.id}">Start incident</button>`}</div>`; }).join("")}</div>`;
  }
  function mountDrills(root, u, s) {
    root.querySelectorAll("[data-drill]").forEach((b) => (b.onclick = async () => {
      const d = u.drills.find((x) => x.id === b.dataset.drill);
      const G = C.G;
      if (!G.fac() || !G.pub("pipelines", "pl_ingest_orders") || !G.server() || !G.acct()) { N.toast("Finish P4 first: the drills break your working pipeline.", "error", 6000); return; }
      if (!(await N.confirmDialog("Start incident drill", "The grader will change your environment the way a real incident would, then run pl_ingest_orders. Your job: find out what happened and restore service.", "Start", "danger"))) return;
      d.break();
      s.drills[d.id] = { started: Date.now() };
      S.changed("course");
      const run = await G.run("pl_ingest_orders");
      const n = G.exists("stg_orders") ? G.one("SELECT COUNT(*) FROM stg_orders") : 0;
      S.notify(d.alert.split("·")[0].trim() + " alert", run.status === "Failed" ? `pl_ingest_orders failed at ${new Date().toLocaleTimeString()}.` : `pl_ingest_orders succeeded but dbo.stg_orders has ${n} rows.`, "error");
      N.rerender();
    }));
    root.querySelectorAll("[data-cause]").forEach((sel) => (sel.onchange = () => { s.drills[sel.dataset.cause].cause = sel.value === "" ? undefined : +sel.value; S.changed("course"); }));
  }

  /* ---- autograder ---- */
  function graderHtml(u, s) {
    const last = s.last;
    return `<div class="grader">
      <div class="grader-bar"><button class="btn btn-primary" id="run-grader" ${C.grading ? "disabled" : ""}>${I("play")} Run autograder</button><span class="muted">${u.tests.length} tests · ${C.total(u)} points${(s.hints || []).length ? ` · hint penalty −${s.hints.length}` : ""}</span>${last ? `<span class="grow"></span><span>Last: <b>${last.score}/${last.total}</b> · ${N.fmtTime(last.t)}</span>` : ""}</div>
      <pre class="ci-log" id="ci-log">${last ? esc(logText(u, last)) : "No runs yet.\n\nThe grader reads your environment and may run published pipelines and add test files to your lake."}</pre>
      ${last && last.score < last.total ? `<div class="btn-row"><button class="btn btn-sm" id="ask-fail">${I("tutor")} Ask the instructor about my failures</button></div>` : ""}
      ${s.attempts ? `<details class="history"><summary>Attempt history</summary><p class="muted">Best score: ${s.best}/${C.total(u)} across ${s.attempts} attempt(s).</p></details>` : ""}</div>`;
  }
  function logText(u, last) {
    const lines = [`$ nimbus-grade ${u.code.toLowerCase()} --strict`, ""];
    last.results.forEach((r) => lines.push(`${r.pass ? "PASS" : "FAIL"}  [${r.req}] ${r.id} (${r.pass ? r.pts : 0}/${r.pts})${r.msg ? "\n        " + r.msg : ""}`));
    lines.push("", `raw ${last.raw}/${last.total}${last.penalty ? `  hints −${last.penalty}` : ""}  ⇒  score ${last.score}/${last.total}  ${last.score === last.total ? "ALL TESTS PASSED" : `${last.results.filter((r) => !r.pass).length} FAILED`}`);
    return lines.join("\n");
  }
  function mountGrader(root, u, s) {
    const btn = root.querySelector("#run-grader"), log = root.querySelector("#ci-log");
    btn.onclick = async () => {
      btn.disabled = true;
      const lines = [`$ nimbus-grade ${u.code.toLowerCase()} --strict`, ""];
      const paint = () => { log.textContent = lines.join("\n"); log.scrollTop = log.scrollHeight; };
      paint();
      try {
        const res = await C.grade(u.id, (e) => {
          if (e.type === "fatal") lines.push("FATAL  " + e.msg);
          if (e.type === "start") lines.push(`RUN   [${e.t.req}] ${e.t.name} …`);
          if (e.type === "result") { lines[lines.length - 1] = `${e.pass ? "PASS" : "FAIL"}  [${e.t.req}] ${e.t.name} (${e.pass ? e.t.pts : 0}/${e.t.pts})${e.msg ? "\n        " + e.msg : ""}`; }
          paint();
        });
        if (res) { lines.push("", `raw ${res.raw}/${res.total}${res.penalty ? `  hints −${res.penalty}` : ""}  ⇒  score ${res.score}/${res.total}  ${res.score === res.total ? "ALL TESTS PASSED" : `${res.results.filter((r) => !r.pass).length} FAILED`}`); paint(); if (res.score === res.total) S.notify(`${u.code} passed`, `Full marks on ${u.title}.`, "success"); }
      } catch (e) { lines.push("", "ERROR " + e.message); paint(); }
      btn.disabled = false;
      setTimeout(() => N.rerender(), 600);
    };
    const af = root.querySelector("#ask-fail");
    if (af) af.onclick = () => N.askTutor(`My ${u.code} autograder failures are below. For each, tell me which layer is wrong and give me a hint (not the full solution).\n\n${s.last.results.filter((r) => !r.pass).map((r) => `[${r.req}] ${r.id}: ${r.msg}`).join("\n")}`);
  }

  /* ================= requirement dock ================= */
  N.renderLabDock = () => {
    const dock = document.getElementById("labdock");
    if (!dock) return;
    const u = C.active();
    const route = N.route();
    if (!u || route.view === "unit" || route.view === "labs") { dock.innerHTML = ""; return; }
    const s = S.state.course[u.id] || {};
    let collapsed = false; try { collapsed = localStorage.getItem("nimbus-dock-min") === "1"; } catch (e) {}
    dock.innerHTML = `<div class="dock ${collapsed ? "min" : ""}">
      <div class="dock-head"><button class="link dock-title" data-go='${J({ view: "unit", id: u.id, tab: "spec" })}'>${I("labs")}<span>${esc(u.code)} · ${s.best != null ? `${s.best}/${C.total(u)}` : "not graded"}</span></button><button class="icon-btn" id="dock-min" aria-label="${collapsed ? "Expand" : "Minimise"}">${I(collapsed ? "expand" : "collapse")}</button><button class="icon-btn" id="dock-x" aria-label="Close">${I("close")}</button></div>
      ${collapsed ? "" : `<div class="dock-body"><ul class="dock-reqs">${u.spec.map((x) => { const st = reqStatus(u, s, x.id); const plain = x.text.replace(/<pre[\s\S]*?<\/pre>/g, "").replace(/<[^>]+>/g, ""); return `<li class="${st || ""}"><span>${st === "pass" ? I("check") : st === "fail" ? I("x") : "•"}</span><div><b>${esc(x.id)}</b> ${esc(plain.slice(0, 110))}${plain.length > 110 ? "…" : ""}</div></li>`; }).join("")}</ul><button class="btn btn-xs" data-go='${J({ view: "unit", id: u.id, tab: "grader" })}'>Autograder</button></div>`}</div>`;
    dock.querySelector("#dock-min").onclick = () => { try { localStorage.setItem("nimbus-dock-min", collapsed ? "0" : "1"); } catch (e) {} N.renderLabDock(); };
    dock.querySelector("#dock-x").onclick = () => { C.setActive(null); N.renderLabDock(); };
  };

  /* ================= realism contract ================= */
  N.views.realism = () => ({
    crumbs: [{ label: "DE101 Practicals", route: { view: "labs" } }, { label: "Realism contract", route: { view: "realism" } }],
    html: `<div class="blade lecture"><h1>Realism contract</h1><p class="muted">What behaves like Azure, what is simulated, and what is missing. Know the gaps so nothing surprises you in a real subscription.</p>
      <h3>Behaves like Azure (Strict mode)</h3><ul>
        <li>Create forms: tabs, defaults (RA-GRS, HNS off, SQL "No access"), naming rules, global name collisions.</li>
        <li>RBAC: control-plane vs data-plane roles, container scopes, propagation delay, 403 <code>AuthorizationPermissionMismatch</code> for pipelines, notebooks and the CLI.</li>
        <li>Azure SQL: logical server, public network access, firewall rules incl. <code>AllowAllWindowsAzureIps</code>, client-IP check in the query editor, Entra admin and Entra-only auth, contained users <code>FROM EXTERNAL PROVIDER</code>, fixed database roles and their permission errors.</li>
        <li>T-SQL: GO batches, statements without semicolons, TOP/OFFSET-FETCH, SELECT INTO, IDENTITY, MERGE (must end with ;), CTEs (recursive without keyword), window functions, CAST/CONVERT/TRY_* with styles and us_english date parsing, DATEADD/DATEDIFF/DATEPART/DATENAME/EOMONTH/FORMAT, procedures with parameters, TRY/CATCH/THROW, IF/WHILE, variables, INFORMATION_SCHEMA. SQLite-only syntax is rejected with SQL Server error numbers.</li>
        <li>Data Factory: linked services (MI or account key), parameterised datasets, Copy (wildcards, $$FILEPATH, pre-copy script, auto-create as nvarchar(max), name mapping, type conversion errors), Script, Stored procedure, Lookup, Set variable, Validation, Delete, Wait, Execute Pipeline, If Condition + Fail, Execute Data Flow; dependency conditions; Debug vs Publish all; schedule and storage-event triggers incl. the <code>/container/blobs/</code> path and Event Grid registration; Monitor with Input/Output/Error and ADF-shaped outputs; ADF JSON, data flow script and ARM export.</li>
        <li>Spark SQL (Databricks): <code>read_files</code> with abfss paths, <code>_c0</code> headers, <code>_rescued_data</code>, struct dot notation, temp views, CTAS, INSERT OVERWRITE DIRECTORY with part files and _SUCCESS, Spark error classes.</li>
        <li>Azure CLI subset with real syntax, <code>--query</code>, <code>-o tsv/table</code> and <code>$(…)</code>.</li></ul>
      <h3>Simulated (similar outcome, different mechanics)</h3><ul>
        <li>Both SQL engines run on SQLite. Text comparison is case-sensitive here (Azure SQL's default collation is case-insensitive). INSERT into a typed column doesn't enforce the type (Copy activities do).</li>
        <li>Deployments, propagation, cluster start-up and trigger latency are shortened to seconds.</li>
        <li>Triggers fire only while this browser tab is open.</li>
        <li>Data flows compile to SQL here, not Spark; the generated SQL is shown in the run output.</li>
        <li>JSON sources in Copy are flattened automatically (device.type → device_type); real ADF needs a hierarchical mapping.</li>
        <li>Databricks storage access is modelled with the workspace's own identity instead of an Access Connector + Unity Catalog.</li></ul>
      <h3>Missing</h3><ul>
        <li>Python, Scala, PySpark; Parquet and Delta Lake; ForEach/Until/Switch activities; tumbling-window triggers; self-hosted IR; Git integration; private endpoints and VNets; Key Vault; Azure Monitor/KQL; costs and quotas.</li>
        <li>T-SQL: schemas other than dbo, table variables, cursors, temporal tables, ALTER COLUMN, OUTPUT clause.</li></ul>
      <p>Before your first real deployment, read the <b>In real Azure</b> tab of each practical: it lists the exact portal path, CLI and the gotchas that are hardest to emulate.</p></div>`,
  });

  /* ================= home ================= */
  N.views.home = () => {
    const t = totals();
    const next = C.units.find((u) => (S.state.course[u.id] || {}).best !== C.total(u)) || C.units[0];
    const recent = [...S.state.resources].sort((a, b) => b.created - a.created).slice(0, 8);
    const runs = S.state.runs.filter((r) => !r.debug).slice(0, 5);
    const svc = [
      { label: "Create a resource", icon: "plus", go: { view: "create" }, plain: true },
      { label: "Resource groups", type: "rg", go: { view: "rgs" } },
      { label: "Storage accounts", type: "storage", go: { view: "list", type: "storage" } },
      { label: "SQL databases", type: "sqldb", go: { view: "list", type: "sqldb" } },
      { label: "Data factories", type: "factory", go: { view: "list", type: "factory" } },
      { label: "Azure Databricks", type: "workspace", go: { view: "list", type: "workspace" } },
      { label: "Subscriptions", icon: "key", go: { view: "subscription" }, plain: true },
      { label: "Cloud Shell", icon: "shell", shell: true, plain: true },
    ];
    return {
      live: ["resource", "runs", "course"],
      html: `<div class="blade home">
        <section class="home-hero">
          <div><h1>Nimbus · DE101</h1><p>A browser replica of the Azure portal that behaves like Azure: identities, firewalls, T-SQL, Data Factory, Spark SQL and the CLI, with an MIT-style practical course on top. Nothing here costs money; everything here transfers.</p>
            <div class="chip-row"><span class="pill ${S.realStrict() ? "pill-ok" : "pill-bad"}">${I("shield")} ${S.realStrict() ? "Strict realism" : "Guided mode"}</span><button class="link" data-go='{"view":"realism"}'>Realism contract</button></div></div>
          <div class="hero-progress"><div class="hp-top"><span>Course grade</span><b>${t.max ? grade(t.pct) : "–"} · ${t.pct.toFixed(0)}%</b></div><div class="bar"><span style="width:${t.pct}%"></span></div>
            <div class="hp-next">Next: <b>${esc(next.code)} ${esc(next.title)}</b></div><button class="btn btn-primary" data-go='${J({ view: "unit", id: next.id })}'>${t.got ? "Continue" : "Start with P1"}</button></div>
        </section>
        <h2 class="sec-title">Azure services</h2>
        <div class="svc-row">${svc.map((s) => `<button class="svc" ${s.shell ? 'id="home-shell"' : `data-go='${J(s.go)}'`}>${s.plain ? `<span class="tile tile-lg tile-plain">${I(s.icon)}</span>` : N.tile(s.type, "tile-lg")}<span>${esc(s.label)}</span></button>`).join("")}</div>
        <div class="home-cols">
          <section class="panel"><div class="panel-head"><h2>Recent resources</h2><button class="link" data-go='{"view":"resources"}'>See all</button></div>
            ${recent.length ? `<table class="list"><thead><tr><th>Name</th><th>Type</th><th>Last viewed</th></tr></thead><tbody>${recent.map((r) => `<tr><td>${N.resLink(r)}</td><td>${esc(N.typeMeta[r.type].label)}</td><td class="muted">${N.fmtTime(r.created)}</td></tr>`).join("")}</tbody></table>` : `<div class="empty"><p>No resources yet. P1 starts from an empty subscription, exactly like a new Azure account.</p><button class="btn btn-primary" data-go='{"view":"unit","id":"p1"}'>Open P1</button></div>`}</section>
          <section class="panel"><div class="panel-head"><h2>Recent pipeline runs</h2><button class="link" data-go='{"view":"monitor"}'>Monitor</button></div>
            ${runs.length ? `<table class="list"><tbody>${runs.map((r) => `<tr><td><b>${esc(r.pipeline)}</b><br><small class="muted">${esc(r.factory)} · ${esc(r.trigger.name)}</small></td><td>${N.statusPill(r.status)}</td><td class="muted">${N.fmtTime(r.start)}</td></tr>`).join("")}</tbody></table>` : `<div class="empty-note">No triggered runs yet.</div>`}</section>
        </div></div>`,
      mount(root) { const sh = root.querySelector("#home-shell"); if (sh) sh.onclick = () => N.toggleShell(true); },
    };
  };
  N.views.lab = (r) => N.views.unit({ id: "p1" });
})(window.N);
