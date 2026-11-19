/* Nimbus Portal — learning center, lab dock, tutor and cloud shell */
(function (N) {
  const S = N.store, esc = N.esc, I = N.icon;

  /* ---------------- markdown (tutor replies) ---------------- */
  N.md = (src) => {
    const blocks = [];
    let h = String(src || "").replace(/```(\w*)\n?([\s\S]*?)```/g, (m, lang, code) => { blocks.push(`<pre class="code-block">${esc(code.replace(/\n$/, ""))}</pre>`); return `\u0000${blocks.length - 1}\u0000`; });
    h = esc(h);
    h = h.replace(/^#### (.*)$/gm, "<h5>$1</h5>").replace(/^### (.*)$/gm, "<h4>$1</h4>").replace(/^## (.*)$/gm, "<h4>$1</h4>").replace(/^# (.*)$/gm, "<h3>$1</h3>");
    h = h.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/`([^`\n]+)`/g, "<code>$1</code>").replace(/(^|[\s(])\*(?!\s)([^*\n]+?)\*(?=[\s).,!?:;]|$)/g, "$1<i>$2</i>");
    h = h.replace(/(?:^|\n)((?:\s*[-*] .*(?:\n|$))+)/g, (m, b) => `\n<ul>${b.trim().split("\n").map((l) => `<li>${l.replace(/^\s*[-*] /, "")}</li>`).join("")}</ul>\n`);
    h = h.replace(/(?:^|\n)((?:\s*\d+\. .*(?:\n|$))+)/g, (m, b) => `\n<ol>${b.trim().split("\n").map((l) => `<li>${l.replace(/^\s*\d+\. /, "")}</li>`).join("")}</ol>\n`);
    h = h.split(/\n{2,}/).map((p) => (/^\s*(<h\d|<ul|<ol|\u0000)/.test(p) ? p : `<p>${p.trim().replace(/\n/g, "<br>")}</p>`)).join("");
    return h.replace(/\u0000(\d+)\u0000/g, (m, i) => blocks[+i]);
  };

  /* ---------------- Learning center ---------------- */
  N.views.labs = () => {
    const total = N.labs.reduce((a, l) => a + l.steps.length, 0), done = N.labs.reduce((a, l) => a + N.labProgress(l).count, 0);
    return {
      live: ["*"],
      crumbs: [{ label: "Learning center", route: { view: "labs" } }],
      html: `<div class="blade"><div class="blade-head with-tile"><span class="tile tile-lg tile-plain">${I("labs")}</span><div><h1>Learning center</h1><p class="muted">Ten hands-on labs that take you from an empty subscription to a tested, scheduled, end-to-end pipeline. Steps tick themselves off as you work.</p></div></div>
        <div class="path-progress"><div class="bar"><span style="width:${(done / total) * 100}%"></span></div><span><b>${done}</b> of ${total} steps · ${N.labs.filter((l) => N.labProgress(l).complete).length} of ${N.labs.length} labs complete</span></div>
        <div class="lab-grid">${N.labs.map((l, i) => { const p = N.labProgress(l); return `<button class="lab-card ${p.complete ? "done" : ""}" data-go='${esc(JSON.stringify({ view: "lab", id: l.id }))}'>
          <div class="lab-num">Lab ${i + 1}</div><b>${esc(l.title)}</b><div class="lab-meta"><span>${esc(l.level)}</span><span>${l.minutes} min</span><span>${p.count}/${p.total} steps</span></div>
          <div class="bar thin"><span style="width:${(p.count / p.total) * 100}%"></span></div>${p.complete ? `<span class="pill pill-ok">${I("check")} Complete</span>` : ""}</button>`; }).join("")}</div>
        <div class="learn-card">${I("tutor")}<div><b>Stuck? Ask the tutor.</b><p>The tutor panel (sparkle icon, top right) knows which lab and step you are on and what you have built. Ask for a hint, an explanation, or a quiz.</p><button class="btn btn-sm" id="open-tutor">Open tutor</button></div></div></div>`,
      mount(root) { root.querySelector("#open-tutor").onclick = () => N.openTutor(); },
    };
  };

  const activeKey = "nimbus-active-lab";
  N.activeLab = () => { try { return localStorage.getItem(activeKey); } catch (e) { return null; } };
  N.setActiveLab = (id) => { try { id ? localStorage.setItem(activeKey, id) : localStorage.removeItem(activeKey); } catch (e) {} N.renderLabDock(); };

  N.views.lab = (r) => {
    const idx = N.labs.findIndex((l) => l.id === r.id);
    const l = N.labs[idx];
    if (!l) return N.views.labs(r);
    if (N.activeLab() !== l.id) N.setActiveLab(l.id);
    const p = N.labProgress(l);
    const cur = p.done.indexOf(false);
    return {
      live: ["*"],
      crumbs: [{ label: "Learning center", route: { view: "labs" } }, { label: "Lab " + (idx + 1), route: r }],
      html: `<div class="blade lab">
        <div class="blade-head"><div class="lab-num">Lab ${idx + 1} · ${esc(l.level)} · ${l.minutes} min</div><h1>${esc(l.title)}</h1></div>
        <div class="lab-cols">
          <article class="lab-concept"><h2 class="sec-title">Concepts</h2>${l.concept}<div class="learn-card">${I("book")}<div><b>In Azure</b><p>${esc(l.real)}</p></div></div></article>
          <section class="lab-steps"><h2 class="sec-title">Steps <small class="muted">${p.count}/${p.total}</small></h2>
            <ol class="steps">${l.steps.map((s, i) => `<li class="step ${p.done[i] ? "done" : i === cur ? "current" : ""}"><span class="step-mark">${p.done[i] ? I("check") : i + 1}</span><div><b>${esc(s.title)}</b><div class="step-detail">${s.detail}</div>
              <div class="step-actions">${s.go && !p.done[i] ? `<button class="btn btn-sm" data-go='${esc(JSON.stringify(s.go))}'>Go there</button>` : ""}${s.hint && !p.done[i] ? `<details class="hint"><summary>Show hint</summary><p>${esc(s.hint)}</p></details>` : ""}</div></div></li>`).join("")}</ol>
            ${p.complete ? `<div class="callout callout-ok">${I("check")} Lab complete. ${idx < N.labs.length - 1 ? "On to the next one." : "You finished the learning path. Try rebuilding it from memory, or ask the tutor for a capstone challenge."}</div>` : ""}
            <div class="btn-row"><button class="btn" id="hint">${I("tutor")} Ask tutor for help</button><button class="btn" id="quiz">Quiz me on this lab</button></div>
            <div class="btn-row lab-nav">${idx > 0 ? `<button class="btn btn-sm" data-go='${esc(JSON.stringify({ view: "lab", id: N.labs[idx - 1].id }))}'>${I("back")} Previous lab</button>` : ""}<span class="grow"></span>${idx < N.labs.length - 1 ? `<button class="btn btn-sm ${p.complete ? "btn-primary" : ""}" data-go='${esc(JSON.stringify({ view: "lab", id: N.labs[idx + 1].id }))}'>Next lab ${I("chevron")}</button>` : ""}</div>
          </section></div></div>`,
      mount(root) {
        root.querySelector("#hint").onclick = () => { const s = l.steps[cur >= 0 ? cur : 0]; N.askTutor(`I'm on lab "${l.title}", step "${s.title}". Give me a hint that gets me unstuck without giving the full answer straight away.`); };
        root.querySelector("#quiz").onclick = () => N.askTutor(`Quiz me on the lab "${l.title}". Ask me 3 short questions one at a time, wait for each answer, then give feedback. Concepts covered:\n${l.concept.replace(/<[^>]+>/g, "")}`);
      },
    };
  };

  /* Floating lab guide */
  let lastDone = {};
  N.renderLabDock = () => {
    const dock = document.getElementById("labdock");
    if (!dock) return;
    const id = N.activeLab();
    const l = N.labs.find((x) => x.id === id);
    const route = N.route();
    if (!l || (route.view === "lab" && route.id === l.id) || route.view === "labs") { dock.innerHTML = ""; trackDone(l); return; }
    const p = N.labProgress(l);
    const cur = p.done.indexOf(false);
    let collapsed = false; try { collapsed = localStorage.getItem("nimbus-dock-min") === "1"; } catch (e) {}
    trackDone(l);
    dock.innerHTML = `<div class="dock ${collapsed ? "min" : ""}">
      <div class="dock-head"><button class="link dock-title" data-go='${esc(JSON.stringify({ view: "lab", id: l.id }))}'>${I("labs")}<span>Lab ${N.labs.indexOf(l) + 1}: ${p.count}/${p.total}</span></button><button class="icon-btn" id="dock-min" aria-label="${collapsed ? "Expand" : "Minimise"} lab guide">${I(collapsed ? "expand" : "collapse")}</button><button class="icon-btn" id="dock-x" aria-label="Close lab guide">${I("close")}</button></div>
      ${collapsed ? "" : cur >= 0 ? `<div class="dock-body"><small class="muted">Current step</small><b>${esc(l.steps[cur].title)}</b><div class="step-detail">${l.steps[cur].detail}</div></div>` : `<div class="dock-body"><b>${I("check")} Lab complete</b></div>`}</div>`;
    dock.querySelector("#dock-min").onclick = () => { try { localStorage.setItem("nimbus-dock-min", collapsed ? "0" : "1"); } catch (e) {} N.renderLabDock(); };
    dock.querySelector("#dock-x").onclick = () => N.setActiveLab(null);
  };
  let tracking = false;
  function trackDone() {
    if (tracking) return;
    tracking = true;
    const finished = [], newly = [];
    try {
      N.labs.forEach((lab) => {
        const p = N.labProgress(lab);
        const prev = lastDone[lab.id];
        lastDone[lab.id] = p.done;
        if (!prev) return;
        p.done.forEach((d, i) => { if (d && !prev[i]) newly.push(lab.steps[i].title); });
        if (p.complete && prev.some((x) => !x)) finished.push(lab);
      });
    } finally { tracking = false; }
    if (newly.length === 1) N.toast(`Step complete: ${newly[0]}`, "success", 4000);
    else if (newly.length > 1) N.toast(`${newly.length} lab steps complete`, "success", 4000);
    if (finished.length) setTimeout(() => finished.forEach((lab) => S.notify(`Lab complete: ${lab.title}`, "Nice work. The next lab is ready in the Learning center.", "success")), 0);
  }
  N.primeLabTracking = () => N.labs.forEach((lab) => (lastDone[lab.id] = N.labProgress(lab).done));

  /* ---------------- Tutor ---------------- */
  const turns = [];
  let sampleFn = undefined, ctl = null, busy = false;

  function contextSummary() {
    const r = N.route();
    const res = r.id ? S.resById(r.id) : null;
    const lab = N.labs.find((x) => x.id === N.activeLab());
    const p = lab && N.labProgress(lab);
    const tables = Object.entries(S.dbs).map(([n, d]) => { try { return `${n}: ${S.tables(d).map((t) => `${t.name}(${t.rows})`).join(", ") || "no tables"}`; } catch (e) { return n; } }).join("; ");
    const lakes = Object.entries(S.state.lake).map(([a, x]) => `${a}: ${Object.entries(x.containers).map(([c, v]) => `${c}(${Object.keys(v.files).length} files)`).join(", ") || "no containers"}`).join("; ");
    const pls = Object.entries(S.state.factories).map(([f, x]) => `${f}: linked=[${x.linked.map((l) => l.name + "→" + l.target).join(", ")}] pipelines=[${x.pipelines.map((p) => p.name + "{" + p.activities.map((a) => a.type).join(">") + "}").join(", ")}] triggers=${x.triggers.length}`).join("; ");
    const lastRun = S.state.runs[0];
    return [
      `Current blade: ${r.view}${res ? ` → ${N.typeMeta[res.type].label} "${res.name}"` : ""}${r.tab ? ` (tab ${r.tab})` : ""}`,
      lab ? `Active lab: "${lab.title}" (${p.count}/${p.total} steps). Current step: ${p.done.indexOf(false) >= 0 ? lab.steps[p.done.indexOf(false)].title : "all done"}` : "No active lab",
      `Resource groups: ${S.state.rgs.map((g) => g.name).join(", ") || "none"}`,
      `Lake: ${lakes || "none"}`, `SQL: ${tables || "none"}`, `Factories: ${pls || "none"}`,
      lastRun ? `Last pipeline run: ${lastRun.pipeline} ${lastRun.status}${lastRun.error ? " — " + lastRun.error : ""}` : "",
    ].filter(Boolean).join("\n");
  }

  const RULES = () => `You are the tutor inside "Nimbus Portal", a free in-browser sandbox that imitates a cloud portal so learners can practise data engineering. Mapping to Azure: Lake storage = ADLS Gen2 storage account; SQL database = Azure SQL Database (but the engine here is SQLite, so use SQLite syntax); Pipeline factory = Azure Data Factory (activities: Copy, Script, Data flow, Validate, Delete, Wait; linked services; parameters; schedule and storage-event triggers; expressions like @pipeline().parameters.x, @{...} interpolation, @triggerBody().fileName, formatDateTime, utcNow, addDays, concat); Analytics workspace = Databricks/Synapse notebooks (SQL + Markdown cells only). Sandbox helpers in any SQL: read_csv('lake://account/container/path-or-glob'), read_json(...), read_table('db.table'); notebook first line "%%write lake://acct/container/file.csv" or "%%write sql://db/table" saves results. Lake paths in pipeline activities are relative to the linked service: container/folder/file.

How to teach: be warm, concise and concrete. Prefer short paragraphs and small code blocks. When the learner asks for help with a lab step, give a hint first and the full answer only if they ask or are clearly stuck. Relate sandbox concepts to how they work in Azure and in real data teams. If something cannot be done in the sandbox (Python, Spark clusters, Parquet), say so plainly and suggest the closest sandbox equivalent.

The learner's current portal state:
${contextSummary()}`;

  function tutorShell() {
    const el = document.getElementById("tutor");
    el.innerHTML = `<div class="tutor-head">${I("tutor")}<b>Tutor</b><span class="grow"></span><button class="icon-btn" id="tutor-new" title="New conversation" aria-label="New conversation">${I("refresh")}</button><button class="icon-btn" id="tutor-close" aria-label="Close tutor">${I("close")}</button></div>
      <div class="tutor-msgs" id="tutor-msgs"></div>
      <div class="tutor-chips" id="tutor-chips">${["Explain my current step", "Give me a hint", "Quiz me", "What is ELT vs ETL?", "Explain the medallion architecture"].map((c) => `<button class="chip" data-q="${esc(c)}">${esc(c)}</button>`).join("")}</div>
      <form class="tutor-input" id="tutor-form"><textarea id="tutor-text" rows="2" placeholder="Ask about data engineering, SQL, pipelines…" aria-label="Message the tutor"></textarea><button class="btn btn-primary" id="tutor-send" aria-label="Send">${I("send")}</button></form>`;
    el.querySelector("#tutor-close").onclick = () => N.toggleTutor(false);
    el.querySelector("#tutor-new").onclick = () => { if (ctl) ctl.abort(); turns.length = 0; renderMsgs(); };
    el.querySelector("#tutor-form").onsubmit = (e) => { e.preventDefault(); send(el.querySelector("#tutor-text").value); };
    el.querySelector("#tutor-text").addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(e.target.value); } });
    el.querySelectorAll("[data-q]").forEach((b) => (b.onclick = () => send(b.dataset.q)));
    renderMsgs();
  }

  function renderMsgs(streamText) {
    const box = document.getElementById("tutor-msgs");
    if (!box) return;
    const intro = `<div class="msg bot"><p>Hi! I'm your data engineering tutor. I can see which lab you're on and what you've built, so ask me anything: a hint for a step, why a query failed, or how this maps to Azure.</p></div>`;
    box.innerHTML = intro + turns.map((t) => `<div class="msg ${t.role === "user" ? "me" : "bot"}">${t.role === "user" ? `<p>${esc(t.display || t.content).replace(/\n/g, "<br>")}</p>` : N.md(t.content)}</div>`).join("") +
      (streamText !== undefined ? `<div class="msg bot">${streamText ? N.md(streamText) : `<p class="thinking"><span class="spin"></span> Thinking…</p>`}<button class="btn btn-xs" id="tutor-stop">Stop</button></div>` : "");
    const stop = box.querySelector("#tutor-stop"); if (stop) stop.onclick = () => ctl && ctl.abort();
    box.scrollTop = box.scrollHeight;
  }

  async function getSample() {
    if (sampleFn !== undefined) return sampleFn;
    try { sampleFn = window.claude && window.claude.use ? await window.claude.use("sample") : null; } catch (e) { sampleFn = null; }
    return sampleFn;
  }

  async function send(text) {
    text = String(text || "").trim();
    if (!text || busy) return;
    const ta = document.getElementById("tutor-text"); if (ta) ta.value = "";
    const display = text.length > 600 ? text.slice(0, 600) + "…" : text;
    turns.push({ role: "user", content: text, display });
    busy = true;
    renderMsgs("");
    const sample = await getSample();
    if (!sample) {
      turns.push({ role: "assistant", content: "The live tutor needs this portal to be opened as a Claude artifact on claude.ai, where it can ask Claude on your behalf. You can still paste your question into a Claude chat:\n\n```\n" + text.slice(0, 2000) + "\n```" });
      busy = false; renderMsgs(); return;
    }
    ctl = new AbortController();
    const history = turns.slice(-12).map((t) => ({ role: t.role, content: t.content }));
    while (history.length && history[0].role !== "user") history.shift();
    try {
      const { text: answer } = await sample([{ role: "user", content: RULES() }, ...history], { cache: false, signal: ctl.signal, onText: ({ text: t }) => renderMsgs(t) });
      turns.push({ role: "assistant", content: answer });
    } catch (e) {
      const msg = { not_granted: "The tutor is turned off for this page. You can allow it from the artifact's permissions menu.", sampling_disabled: "Claude isn't available on this account right now.", rate_limited: "The tutor is getting a lot of questions. Wait a minute and try again.", cancelled: "" }[e && e.code];
      if (e && e.text) turns.push({ role: "assistant", content: e.text + (e.code === "cancelled" ? "\n\n*(stopped)*" : "") });
      if (msg !== "") turns.push({ role: "assistant", content: msg || "Something went wrong reaching the tutor. Try again in a moment." });
    } finally { busy = false; ctl = null; renderMsgs(); }
  }

  N.toggleTutor = (force) => {
    const el = document.getElementById("tutor");
    const open = force !== undefined ? force : el.hidden;
    el.hidden = !open;
    document.body.classList.toggle("tutor-open", open);
    if (open && !el.innerHTML) tutorShell();
    if (open) setTimeout(() => { const t = document.getElementById("tutor-text"); if (t) t.focus(); }, 50);
  };
  N.openTutor = (prompt) => { N.toggleTutor(true); if (prompt) send(prompt); };

  /* ---------------- Cloud Shell ---------------- */
  const hist = []; let hIdx = 0;
  N.toggleShell = (force) => {
    const el = document.getElementById("cloudshell");
    const open = force !== undefined ? force : el.hidden;
    el.hidden = !open;
    document.body.classList.toggle("shell-open", open);
    if (open && !el.innerHTML) {
      el.innerHTML = `<div class="sh-head">${I("shell")}<b>Cloud Shell</b><span class="muted">nimbus CLI · type <code>help</code></span><span class="grow"></span><button class="icon-btn" id="sh-close" aria-label="Close shell">${I("close")}</button></div>
        <div class="sh-out" id="sh-out"></div><div class="sh-line"><span class="sh-ps">learner@nimbus:~$</span><input id="sh-in" autocomplete="off" spellcheck="false" aria-label="Shell command"></div>`;
      el.querySelector("#sh-close").onclick = () => N.toggleShell(false);
      const inp = el.querySelector("#sh-in");
      print("Welcome to Cloud Shell. Your files and resources are the same ones you see in the portal.\nType 'help' for commands.\n");
      inp.addEventListener("keydown", async (e) => {
        if (e.key === "Enter") { const c = inp.value; inp.value = ""; hist.push(c); hIdx = hist.length; print(`learner@nimbus:~$ ${c}`, "cmd"); await exec(c); }
        if (e.key === "ArrowUp") { e.preventDefault(); if (hIdx > 0) inp.value = hist[--hIdx]; }
        if (e.key === "ArrowDown") { e.preventDefault(); hIdx = Math.min(hist.length, hIdx + 1); inp.value = hist[hIdx] || ""; }
      });
      el.addEventListener("click", (e) => { if (!e.target.closest("button")) inp.focus(); });
    }
    if (open) setTimeout(() => el.querySelector("#sh-in").focus(), 30);
  };
  function print(text, cls = "") {
    const out = document.getElementById("sh-out");
    const d = document.createElement("pre"); d.className = cls; d.textContent = text; out.appendChild(d); out.scrollTop = out.scrollHeight;
  }
  function argv(line) {
    const out = []; let cur = "", q = null, has = false;
    for (const ch of line) {
      if (q) { if (ch === q) q = null; else cur += ch; continue; }
      if (ch === '"' || ch === "'") { q = ch; has = true; continue; }
      if (/\s/.test(ch)) { if (cur || has) out.push(cur); cur = ""; has = false; continue; }
      cur += ch;
    }
    if (cur || has) out.push(cur);
    return out;
  }
  const opt = (a, ...names) => { for (const n of names) { const i = a.indexOf(n); if (i >= 0) return a[i + 1]; } return undefined; };
  function textTable(cols, rows) {
    const w = cols.map((c, i) => Math.min(40, Math.max(String(c).length, ...rows.map((r) => String(r[i] ?? "NULL").length))));
    const line = (r) => r.map((v, i) => String(v ?? "NULL").slice(0, 40).padEnd(w[i])).join("  ");
    return [line(cols), w.map((x) => "-".repeat(x)).join("  "), ...rows.map(line)].join("\n");
  }
  const HELP = `Commands
  ls [lake://account[/container[/prefix]]]   list accounts, containers or files
  cat lake://account/container/path          print the first 40 lines of a file
  rm lake://account/container/path           delete a file
  sql <database> "<query>"                   run SQL and print results
  pipeline run <factory> <pipeline> [k=v…]   start a pipeline run
  runs [n]                                   show recent pipeline runs
  nimbus group list | nimbus group create -n <name> [-l <region>]
  nimbus resource list
  nimbus storage create -n <name> -g <group>
  nimbus sql create -n <name> -g <group>
  clear, help`;
  async function exec(line) {
    const a = argv(line.trim());
    if (!a.length) return;
    const [cmd, ...rest] = a;
    try {
      switch (cmd) {
        case "help": print(HELP); break;
        case "clear": document.getElementById("sh-out").innerHTML = ""; break;
        case "ls": {
          S.flag("shell-ls");
          if (!rest[0]) { const accts = Object.keys(S.state.lake); print(accts.length ? accts.map((x) => `lake://${x}/`).join("\n") : "(no storage accounts)"); break; }
          const raw = rest[0].replace(/^lake:\/\//, "").replace(/\/+$/, "");
          const [acct, cont, ...pp] = raw.split("/");
          if (!S.state.lake[acct]) throw new Error(`storage account '${acct}' not found`);
          if (!cont) { print(Object.keys(S.state.lake[acct].containers).map((c) => c + "/").join("\n") || "(no containers)"); break; }
          const c = S.container(acct, cont); if (!c) throw new Error(`container '${cont}' not found`);
          const pre = pp.length ? pp.join("/") + "/" : "";
          const items = new Set();
          Object.entries(c.files).forEach(([p, f]) => { if (!p.startsWith(pre)) return; const rem = p.slice(pre.length); const i = rem.indexOf("/"); items.add(i >= 0 ? rem.slice(0, i + 1) : `${rem}  (${N.fmtBytes(f.size)})`); });
          print([...items].sort().join("\n") || "(empty)");
          break;
        }
        case "cat": {
          const { acct, cont, path } = S.parseLake(rest[0] || "");
          const f = S.container(acct, cont)?.files[path]; if (!f) throw new Error("file not found");
          const lines = f.content.split("\n"); print(lines.slice(0, 40).join("\n") + (lines.length > 41 ? `\n… ${lines.length - 40} more lines` : "")); break;
        }
        case "rm": { const { acct, cont, path } = S.parseLake(rest[0] || ""); if (!S.deleteFile(acct, cont, path)) throw new Error("file not found"); print("deleted"); break; }
        case "sql": {
          const [db, ...q] = rest; if (!db || !q.length) throw new Error('usage: sql <database> "<query>"');
          const r = S.runSQL(db, q.join(" ")); S.flag("shell-sql"); N.sqlFlags(q.join(" "));
          const last = r.results[r.results.length - 1];
          print(last ? textTable(last.columns, last.values.slice(0, 50)) + (last.values.length > 50 ? `\n… ${last.values.length - 50} more rows` : "") + `\n(${last.values.length} rows, ${r.ms} ms)` : `OK (${r.changes} rows affected, ${r.ms} ms)`);
          break;
        }
        case "pipeline": {
          if (rest[0] !== "run" || rest.length < 3) throw new Error("usage: pipeline run <factory> <pipeline> [key=value …]");
          const params = {}; rest.slice(3).forEach((kv) => { const i = kv.indexOf("="); if (i > 0) params[kv.slice(0, i)] = kv.slice(i + 1); });
          print(`Run started… (watch Monitor)`);
          const run = await N.engine.runPipeline(rest[1], rest[2], params, { type: "Manual", name: "Cloud Shell" });
          print(`${run.pipeline}: ${run.status}${run.error ? " — " + run.error : ""} (run ${run.id})`);
          break;
        }
        case "runs": { const n = +rest[0] || 10; const rs = S.state.runs.slice(0, n); print(rs.length ? textTable(["pipeline", "status", "start", "trigger"], rs.map((r) => [r.pipeline, r.status, new Date(r.start).toISOString().slice(0, 19), r.trigger.name])) : "(no runs)"); break; }
        case "nimbus": case "az": {
          const [grp, verb] = rest;
          if (cmd === "az") print("(tip: in Nimbus the CLI is called 'nimbus'; running it for you)");
          if (grp === "group" && verb === "list") { print(textTable(["name", "location"], S.state.rgs.map((g) => [g.name, g.region])) || "(none)"); break; }
          if (grp === "group" && verb === "create") { const n = opt(rest, "-n", "--name"); if (!n) throw new Error("--name is required"); S.createRG(n, opt(rest, "-l", "--location") || N.REGIONS[0]); S.changed("resource"); print(JSON.stringify({ name: n, provisioningState: "Succeeded" }, null, 2)); break; }
          if (grp === "resource" && verb === "list") { print(S.state.resources.length ? textTable(["name", "type", "group", "location"], S.state.resources.map((r) => [r.name, r.type, r.rg, r.region])) : "(none)"); break; }
          if ((grp === "storage" || grp === "sql") && verb === "create") {
            const n = opt(rest, "-n", "--name"), g = opt(rest, "-g", "--resource-group");
            if (!n || !g) throw new Error("--name and --resource-group are required");
            if (!S.state.rgs.some((x) => x.name === g)) throw new Error(`resource group '${g}' not found`);
            const type = grp === "storage" ? "storage" : "sqldb";
            if (type === "storage" && !/^[a-z0-9]{3,24}$/.test(n)) throw new Error("storage names are 3-24 lowercase letters and digits");
            if (S.nameTaken(type, n)) throw new Error(`'${n}' already exists`);
            S.createResource(type, n, g, opt(rest, "-l", "--location") || N.REGIONS[0], type === "storage" ? { hns: true, redundancy: "LRS", performance: "Standard" } : { tier: "Serverless" });
            print(JSON.stringify({ name: n, type, resourceGroup: g, provisioningState: "Succeeded" }, null, 2)); break;
          }
          throw new Error("unknown nimbus command. Try 'help'.");
        }
        default: throw new Error(`${cmd}: command not found. Try 'help'.`);
      }
    } catch (e) { print("error: " + e.message, "err"); }
  }
})(window.N);
