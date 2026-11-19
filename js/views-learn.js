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

  /* ---------------- Tutor ---------------- */
  const turns = [];
  let sampleFn = undefined, ctl = null, busy = false;

  function contextSummary() {
    const r = N.route();
    const res = r.id ? S.resById(r.id) : null;
    const unit = N.course && N.course.active ? N.course.active() : null;
    const tables = Object.entries(S.dbs).map(([n, d]) => { try { return `${n}: ${S.tables(d).map((t) => `${t.name}(${t.rows})`).join(", ") || "no tables"}`; } catch (e) { return n; } }).join("; ");
    const lakes = Object.entries(S.state.lake).map(([a, x]) => `${a}: ${Object.entries(x.containers).map(([c, v]) => `${c}(${Object.keys(v.files).length} files)`).join(", ") || "no containers"}`).join("; ");
    const pls = Object.entries(S.state.factories).map(([f, x]) => `${f}: linked=[${x.linked.map((l) => l.name + "→" + l.target + (l.auth === "AccountKey" ? "(key)" : "(MI)")).join(", ")}] datasets=[${(x.datasets || []).map((d) => d.name + ":" + d.type).join(", ")}] pipelines=[${x.pipelines.map((p) => p.name + "{" + p.activities.map((a) => a.type).join(">") + "}").join(", ")}] triggers=${x.triggers.length} unpublished=${N.adf.unpublished(x).length}`).join("; ");
    const lastRun = S.state.runs[0];
    return [
      `Current blade: ${r.view}${res ? ` → ${N.typeMeta[res.type].label} "${res.name}"` : ""}${r.tab ? ` (tab ${r.tab})` : ""}`,
      unit ? `Active practical: ${unit.code} "${unit.title}". Last autograder score: ${N.course.best(unit.id) ?? "not graded yet"}. Requirements: ${unit.spec.map((x) => x.id + " " + x.text.replace(/<[^>]+>/g, "")).join(" | ").slice(0, 1500)}` : "No active practical",
      `Realism mode: ${S.realStrict() ? "strict (Azure behaviour: RBAC, firewalls, T-SQL only)" : "guided"}`,
      `Role assignments: ${S.state.roles.map((r) => `${r.principal}:${r.role}@${r.scope.split("/").slice(-1)[0]}`).join(", ") || "none"}`,
      `SQL servers: ${S.resOfType("sqlserver").map((x) => `${x.name}(public=${x.props.publicAccess}, rules=${(x.props.firewall || []).map((f) => f.name).join("/")})`).join(", ") || "none"}; DB users: ${S.resOfType("sqldb").map((d) => `${d.name}[${Object.values(d.props.users || {}).map((u) => u.name + ":" + u.roles.join("+")).join(", ")}]`).join(" ") || "none"}`,
      `Event Grid provider: ${S.state.providers["Microsoft.EventGrid"]}`,
      `Resource groups: ${S.state.rgs.map((g) => g.name).join(", ") || "none"}`,
      `Lake: ${lakes || "none"}`, `SQL: ${tables || "none"}`, `Factories: ${pls || "none"}`,
      lastRun ? `Last pipeline run: ${lastRun.pipeline} ${lastRun.status}${lastRun.error ? " — " + lastRun.error : ""}` : "",
    ].filter(Boolean).join("\n");
  }

  const RULES = () => `You are the instructor for "DE101", a rigorous, MIT-style practical course in data engineering on Microsoft Azure. The learner works inside Nimbus Portal, a browser sandbox that reproduces Azure's behaviour closely: Azure Storage (ADLS Gen2) with RBAC data roles, Azure SQL Database (logical server, firewall, Microsoft Entra admin, contained users FROM EXTERNAL PROVIDER, strict T-SQL), Azure Data Factory Studio (linked services, datasets, Copy/Script/Lookup/If Condition/Fail/Execute Pipeline/Execute Data Flow, dependency conditions, Debug vs Publish all, schedule and storage event triggers, Monitor), Databricks-style notebooks (Spark SQL: read_files with abfss:// paths, INSERT OVERWRITE DIRECTORY), Azure CLI in Cloud Shell, and the Microsoft.EventGrid resource provider. Known sandbox limits: T-SQL is emulated on SQLite (no schemas other than dbo, no table variables or cursors, collation is case-sensitive), no Python, no Parquet/Delta, no networking/private endpoints.

How to teach:
- Be precise and technical, like a strong TA at a top university. Use correct Azure terminology, real error codes and the real portal path.
- Always connect the sandbox to real Azure: what the learner would click or run (az CLI, T-SQL, ADF JSON), what it costs, and what would break in production.
- For practical work, give the smallest useful hint first (a question or a pointer to the relevant concept). Give a full solution only if asked explicitly; then explain why each line exists.
- When diagnosing errors, name the layer that failed (network, authentication, authorization, data, logic) before the fix.
- Use short paragraphs and small code blocks. No filler.

The learner's current environment:
${contextSummary()}`;

  function tutorShell() {
    const el = document.getElementById("tutor");
    el.innerHTML = `<div class="tutor-head">${I("tutor")}<b>Tutor</b><span class="grow"></span><button class="icon-btn" id="tutor-new" title="New conversation" aria-label="New conversation">${I("refresh")}</button><button class="icon-btn" id="tutor-close" aria-label="Close tutor">${I("close")}</button></div>
      <div class="tutor-msgs" id="tutor-msgs"></div>
      <div class="tutor-chips" id="tutor-chips">${["Hint for my current requirement", "Why did my last run fail?", "Quiz me on this unit", "Control plane vs data plane?", "Debug vs Publish in ADF?"].map((c) => `<button class="chip" data-q="${esc(c)}">${esc(c)}</button>`).join("")}</div>
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
    const intro = `<div class="msg bot"><p>Hi! I'm your DE101 instructor. I can see your practical, your resources, permissions and last run, so ask for a hint, a diagnosis of an error, or how something works in real Azure.</p></div>`;
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

})(window.N);
