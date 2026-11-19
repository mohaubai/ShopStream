/* Nimbus Portal — Azure SQL: logical server + database (T-SQL query editor) */
(function (N) {
  const S = N.store, esc = N.esc, I = N.icon;
  const J = (o) => esc(JSON.stringify(o));

  N.sqlFlags = (sql) => {
    if (/read_(csv|json|lake|files)\s*\(/i.test(sql)) S.flag("sql-readlake");
    if (/group\s+by/i.test(sql)) S.flag("sql-groupby");
    if (/\bjoin\b/i.test(sql)) S.flag("sql-join");
    if (/\bover\s*\(/i.test(sql)) S.flag("window-fn");
  };

  /* ================= SQL server ================= */
  N.resourceTabs.sqlserver = [
    { id: "overview", label: "Overview", icon: "info", render: srvOverview },
    { group: "Security" },
    { id: "networking", label: "Networking", icon: "shield", render: srvNetworking, live: ["resource"] },
    { id: "entra", label: "Microsoft Entra ID", icon: "key", render: srvEntra },
    { group: "Data management" },
    { id: "dbs", label: "SQL databases", icon: "sql", render: srvDbs, live: ["resource"] },
  ];
  function srvOverview(res) {
    const dbs = S.state.resources.filter((d) => d.type === "sqldb" && d.props.server === res.name);
    const p = res.props;
    return {
      html: `<div class="blade">${N.overview(res, [
        ["Server name", `<code>${esc(S.fqdn(res.name))}</code>`],
        ["Server admin", p.auth === "entra" ? "Not applicable (Microsoft Entra-only)" : esc(p.admin || "")],
        ["Microsoft Entra admin", p.entraAdmin ? esc(p.entraAdmin) : `<span class="bad-text">Not configured</span>`],
        ["Public network access", p.publicAccess === "disabled" ? `<span class="bad-text">Disabled</span>` : "Selected networks"],
        ["Firewall rules", (p.firewall || []).length],
        ["Databases", dbs.length],
      ], `<p>A logical server is a security and management boundary, not a VM. Clients connect to <code>${esc(S.fqdn(res.name))}</code> on port 1433. Firewall rules here apply to every database on the server.</p>`)}</div>`,
      mount: (root) => N.mountOverview(root, res),
    };
  }
  function srvNetworking(res) {
    const p = res.props; p.firewall = p.firewall || [];
    const allowAzure = p.firewall.some((f) => f.start === "0.0.0.0" && f.end === "0.0.0.0");
    const rules = p.firewall.filter((f) => !(f.start === "0.0.0.0" && f.end === "0.0.0.0"));
    return {
      html: `<div class="blade"><div class="blade-head"><h1>Networking</h1></div>
        <div class="tabs"><span class="tab active">Public access</span><span class="tab">Private access</span><span class="tab">Connectivity</span></div>
        <div class="form">
          <div class="field"><label>Public network access</label><div class="radios col"><label><input type="radio" name="pna" value="disabled" ${p.publicAccess === "disabled" ? "checked" : ""}> Disable</label><label><input type="radio" name="pna" value="selected" ${p.publicAccess !== "disabled" ? "checked" : ""}> Selected networks</label></div><small class="muted">Disabled blocks every public connection. Only private endpoints work then.</small></div>
          ${p.publicAccess !== "disabled" ? `<h3 class="form-sec">Firewall rules</h3><p class="muted">Allow certain public internet IP addresses to access your resource.</p>
            <button class="btn btn-sm" id="add-client">${I("plus")} Add your client IPv4 address (${esc(N.CLIENT_IP)})</button> <button class="btn btn-sm" id="add-rule">${I("plus")} Add a firewall rule</button>
            <div class="table-wrap" style="margin-top:10px"><table class="list"><thead><tr><th>Rule name</th><th>Start IPv4 address</th><th>End IPv4 address</th><th></th></tr></thead><tbody>${rules.map((f) => `<tr><td>${esc(f.name)}</td><td><code>${esc(f.start)}</code></td><td><code>${esc(f.end)}</code></td><td><button class="icon-btn" data-del="${esc(f.name)}" aria-label="Delete rule">${I("trash")}</button></td></tr>`).join("") || `<tr><td colspan="4" class="muted">No firewall rules.</td></tr>`}</tbody></table></div>
            <h3 class="form-sec">Exceptions</h3><div class="field"><label class="check"><input type="checkbox" id="aas" ${allowAzure ? "checked" : ""}> Allow Azure services and resources to access this server</label><small class="muted">Adds the special rule <code>AllowAllWindowsAzureIps</code> (0.0.0.0). It admits any Azure service in any tenant, so you still rely on authentication. Data Factory's Azure IR needs it unless you use a managed VNet with private endpoints.</small></div>` : ""}
          <div class="btn-row"><button class="btn btn-primary" id="save">Save</button></div>
          <div class="snippet"><b>CLI equivalents</b><pre>az sql server update -g ${esc(res.rg)} -n ${esc(res.name)} --enable-public-network true
az sql server firewall-rule create -g ${esc(res.rg)} -s ${esc(res.name)} -n AllowAllWindowsAzureIps --start-ip-address 0.0.0.0 --end-ip-address 0.0.0.0
az sql server firewall-rule create -g ${esc(res.rg)} -s ${esc(res.name)} -n ClientIP --start-ip-address ${esc(N.CLIENT_IP)} --end-ip-address ${esc(N.CLIENT_IP)}</pre></div>
        </div></div>`,
      mount(root) {
        const draft = { pna: p.publicAccess, aas: allowAzure, rules: rules.slice() };
        root.querySelectorAll("input[name=pna]").forEach((x) => (x.onchange = () => { p.publicAccess = x.value; N.rerender(); }));
        const ac = root.querySelector("#add-client"); if (ac) ac.onclick = () => { if (!p.firewall.some((f) => f.start === N.CLIENT_IP)) p.firewall.push({ name: "ClientIPAddress_" + new Date().toISOString().slice(0, 19).replace(/\D/g, "-"), start: N.CLIENT_IP, end: N.CLIENT_IP }); N.rerender(); };
        const ar = root.querySelector("#add-rule"); if (ar) ar.onclick = () => N.modal({ title: "Add a firewall rule", body: `<div class="field"><label for="fn">Rule name</label><input id="fn"></div><div class="two"><div class="field"><label for="fs">Start IP</label><input id="fs" placeholder="203.0.113.10"></div><div class="field"><label for="fe">End IP</label><input id="fe" placeholder="203.0.113.10"></div></div>`, actions: [{ label: "OK", kind: "primary", onClick: (c, w) => { const ip = /^(\d{1,3}\.){3}\d{1,3}$/; const n = w.querySelector("#fn").value.trim(), a = w.querySelector("#fs").value.trim(), b = w.querySelector("#fe").value.trim(); if (!n || !ip.test(a) || !ip.test(b)) { N.toast("Enter a name and valid IPv4 addresses.", "error"); return false; } p.firewall.push({ name: n, start: a, end: b }); N.rerender(); } }, { label: "Cancel" }] });
        root.querySelectorAll("[data-del]").forEach((b) => (b.onclick = () => { p.firewall = p.firewall.filter((f) => f.name !== b.dataset.del); N.rerender(); }));
        const aas = root.querySelector("#aas"); if (aas) aas.onchange = () => { p.firewall = p.firewall.filter((f) => !(f.start === "0.0.0.0" && f.end === "0.0.0.0")); if (aas.checked) p.firewall.push({ name: "AllowAllWindowsAzureIps", start: "0.0.0.0", end: "0.0.0.0" }); };
        root.querySelector("#save").onclick = () => { S.log("Update server networking", res.name); S.changed("resource"); N.toast("Successfully updated server firewall rules. It can take up to five minutes to apply in Azure.", "success", 5000); };
      },
    };
  }
  function srvEntra(res) {
    const p = res.props;
    return {
      html: `<div class="blade"><div class="blade-head"><h1>Microsoft Entra ID</h1></div><div class="form">
        <div class="field"><label>Microsoft Entra admin</label><input value="${esc(p.entraAdmin || "No Microsoft Entra admin")}" disabled>${p.entraAdmin ? `<button class="btn btn-sm" id="rm">Remove admin</button>` : `<button class="btn btn-sm btn-primary" id="set">Set admin: learner@nimbuslearn.onmicrosoft.com</button>`}<small class="muted">Only connections made as an Entra principal can create users <code>FROM EXTERNAL PROVIDER</code>, which is how managed identities get database access.</small></div>
        <div class="field"><label class="check"><input type="checkbox" id="only" ${p.auth === "entra" ? "checked" : ""} ${p.entraAdmin ? "" : "disabled"}> Support only Microsoft Entra authentication for this server</label><small class="muted">Recommended. Disables SQL logins and passwords entirely.</small></div>
        <div class="btn-row"><button class="btn btn-primary" id="save">Save</button></div></div></div>`,
      mount(root) {
        const set = root.querySelector("#set"); if (set) set.onclick = () => { p.entraAdmin = "learner@nimbuslearn.onmicrosoft.com"; if (p.auth === "sql") p.auth = "both"; S.changed("resource"); N.rerender(); };
        const rm = root.querySelector("#rm"); if (rm) rm.onclick = () => { if (p.auth === "entra") { N.toast("Turn off Entra-only authentication first.", "error"); return; } p.entraAdmin = null; p.auth = "sql"; S.changed("resource"); N.rerender(); };
        root.querySelector("#save").onclick = () => { const o = root.querySelector("#only"); if (p.entraAdmin) p.auth = o.checked ? "entra" : "both"; S.changed("resource"); N.toast("Saved", "success"); };
      },
    };
  }
  function srvDbs(res) {
    const dbs = S.state.resources.filter((d) => d.type === "sqldb" && d.props.server === res.name);
    return { html: `<div class="blade"><div class="blade-head"><h1>SQL databases</h1></div>${N.cmdbar([{ icon: "plus", label: "Create database", go: { view: "create", type: "sqldb" } }])}${dbs.length ? `<div class="table-wrap"><table class="list"><thead><tr><th>Name</th><th>Status</th><th>Pricing tier</th></tr></thead><tbody>${dbs.map((d) => `<tr><td>${N.resLink(d)}</td><td>${N.statusPill("Online")}</td><td>${esc(d.props.compute || "")}</td></tr>`).join("")}</tbody></table></div>` : `<div class="empty-note">No databases on this server.</div>`}</div>` };
  }

  /* ================= SQL database ================= */
  N.resourceTabs.sqldb = [
    { id: "overview", label: "Overview", icon: "info", render: overview },
    { id: "query", label: "Query editor (preview)", icon: "code", render: queryEditor },
    { group: "Settings" },
    { id: "tables", label: "Tables", icon: "table", render: tablesView },
    { id: "users", label: "Database users", icon: "key", render: usersView, live: ["resource"] },
    { id: "conn", label: "Connection strings", icon: "link", render: connStrings },
  ];

  function overview(res) {
    const db = S.db(res.name);
    const t = S.tables(db).filter((x) => !x.name.startsWith("__"));
    const srv = S.res("sqlserver", res.props.server);
    return {
      html: `<div class="blade">${N.overview(res, [
        ["Server name", srv ? `<button class="link" data-go='${J({ view: "resource", id: srv.id })}'>${esc(S.fqdn(srv.name))}</button>` : esc(res.props.server || "")],
        ["Pricing tier", esc(res.props.compute === "Basic" ? "Basic" : `General Purpose: ${String(res.props.compute || "").includes("_S_") ? "Serverless" : "Provisioned"}: Standard-series (Gen5), 1 vCore`)],
        ["Status", "Online"],
        ["Earliest restore point", N.fmtTime(res.created + 600000)],
        ["Tables / views", `${t.filter((x) => x.type === "table").length} / ${t.filter((x) => x.type === "view").length}`],
        ["Engine", "T-SQL emulated on SQLite (see the course's realism notes)"],
      ], `<p>Language: <b>T-SQL</b>. <code>TOP</code> not <code>LIMIT</code>, <code>SELECT … INTO</code> not <code>CREATE TABLE … AS</code>, <code>GETDATE()</code>, <code>DATEADD</code>, <code>MERGE</code>, <code>TRY_CONVERT</code>. SQLite-only syntax fails here with the error SQL Server would give.</p>`)}
      <div class="btn-row"><button class="btn btn-primary" data-go='${J({ view: "resource", id: res.id, tab: "query" })}'>Query editor</button></div></div>`,
      mount: (root) => N.mountOverview(root, res),
    };
  }
  function tablesView(res) {
    const t = S.tables(S.db(res.name)).filter((x) => !x.name.startsWith("__"));
    return {
      html: `<div class="blade"><div class="blade-head"><h1>Tables</h1></div>
        ${t.length ? t.map((x) => `<details class="tbl-card"><summary>${I(x.type === "view" ? "filter" : "table")}<b>dbo.${esc(x.name)}</b><span class="muted">${x.type} · ${x.rows ?? "?"} rows · ${x.cols.length} columns</span></summary>
          <table class="list"><thead><tr><th>Column</th><th>Declared type</th><th>Key</th><th>Nullable</th></tr></thead><tbody>${x.cols.map((c) => `<tr><td><code>${esc(c.name)}</code></td><td>${esc(c.type)}</td><td>${c.pk ? "PK" : ""}</td><td>${c.notnull ? "No" : "Yes"}</td></tr>`).join("")}</tbody></table></details>`).join("")
          : `<div class="empty"><p>No tables yet.</p><button class="btn btn-primary" data-go='${J({ view: "resource", id: res.id, tab: "query" })}'>Open query editor</button></div>`}</div>`,
    };
  }
  function usersView(res) {
    const u = Object.values(res.props.users || {});
    return {
      html: `<div class="blade"><div class="blade-head"><h1>Database users</h1><p class="muted">Contained database users. Managed identities are created with <code>CREATE USER [name] FROM EXTERNAL PROVIDER;</code> and given rights with <code>ALTER ROLE db_datareader ADD MEMBER [name];</code></p></div>
        <div class="table-wrap"><table class="list"><thead><tr><th>User</th><th>Type</th><th>Roles</th></tr></thead><tbody><tr><td>learner@nimbuslearn.onmicrosoft.com</td><td>Microsoft Entra admin (server)</td><td>db_owner (implicit)</td></tr>${u.map((x) => `<tr><td>${esc(x.name)}</td><td>EXTERNAL_USER (managed identity)</td><td>${esc((x.roles || []).join(", ") || "none")}</td></tr>`).join("")}</tbody></table></div>
        <div class="snippet"><b>Fixed database roles</b><pre>db_datareader   SELECT on all tables and views
db_datawriter   INSERT, UPDATE, DELETE on all tables
db_ddladmin     CREATE / ALTER / DROP objects (needed for TRUNCATE and auto-create)
db_owner        everything in the database (avoid for pipelines)</pre></div></div>`,
    };
  }
  function connStrings(res) {
    const srv = S.res("sqlserver", res.props.server);
    const host = srv ? S.fqdn(srv.name) : "?";
    return { html: `<div class="blade"><div class="blade-head"><h1>Connection strings</h1></div>
      <h3 class="form-sec">ADO.NET (Microsoft Entra passwordless)</h3><pre>Server=tcp:${esc(host)},1433;Initial Catalog=${esc(res.name)};Encrypt=True;TrustServerCertificate=False;Connection Timeout=30;Authentication="Active Directory Default";</pre>
      <h3 class="form-sec">JDBC (Databricks / Spark)</h3><pre>jdbc:sqlserver://${esc(host)}:1433;database=${esc(res.name)};encrypt=true;trustServerCertificate=false;hostNameInCertificate=*.database.windows.net;loginTimeout=30;authentication=ActiveDirectoryMSI</pre>
      <h3 class="form-sec">sqlcmd</h3><pre>sqlcmd -S ${esc(host)} -d ${esc(res.name)} --authentication-method ActiveDirectoryDefault</pre></div>` };
  }

  /* ---- query editor ---- */
  const SNIPPETS = [
    ["Create a typed table", `CREATE TABLE dbo.stg_products (\n    product_id   NVARCHAR(10)  NOT NULL PRIMARY KEY,\n    product_name NVARCHAR(100) NOT NULL,\n    category     NVARCHAR(50)  NULL,\n    unit_price   DECIMAL(10,2) NOT NULL,\n    supplier     NVARCHAR(100) NULL\n);`],
    ["Grant a managed identity access", (f) => `-- Run as the Microsoft Entra admin (you)\nCREATE USER [${f}] FROM EXTERNAL PROVIDER;\nALTER ROLE db_datareader ADD MEMBER [${f}];\nALTER ROLE db_datawriter ADD MEMBER [${f}];\nALTER ROLE db_ddladmin  ADD MEMBER [${f}];`],
    ["List tables and columns", `SELECT t.TABLE_NAME, c.COLUMN_NAME, c.DATA_TYPE, c.IS_NULLABLE\nFROM INFORMATION_SCHEMA.TABLES AS t\nJOIN INFORMATION_SCHEMA.COLUMNS AS c ON c.TABLE_NAME = t.TABLE_NAME\nORDER BY t.TABLE_NAME, c.ORDINAL_POSITION;`],
    ["Top 10 rows", `SELECT TOP (10) *\nFROM dbo.stg_orders\nORDER BY order_ts DESC;`],
    ["Recursive date dimension", `WITH d AS (\n    SELECT CAST('2026-11-01' AS DATE) AS full_date\n    UNION ALL\n    SELECT DATEADD(DAY, 1, full_date) FROM d WHERE full_date < '2026-11-30'\n)\nSELECT CAST(FORMAT(full_date, 'yyyyMMdd') AS INT) AS date_key,\n       full_date,\n       DATENAME(WEEKDAY, full_date) AS day_name\nFROM d\nOPTION (MAXRECURSION 400);`],
    ["MERGE (upsert)", `MERGE dbo.target AS t\nUSING dbo.staging AS s\n    ON t.id = s.id\nWHEN MATCHED AND t.amount <> s.amount THEN\n    UPDATE SET t.amount = s.amount\nWHEN NOT MATCHED BY TARGET THEN\n    INSERT (id, amount) VALUES (s.id, s.amount)\nWHEN NOT MATCHED BY SOURCE THEN\n    DELETE;`],
    ["Stored procedure", `CREATE OR ALTER PROCEDURE dbo.usp_example\n    @min_qty INT = 1\nAS\nBEGIN\n    SET NOCOUNT ON;\n    SELECT COUNT(*) AS orders FROM dbo.stg_orders WHERE quantity >= @min_qty;\nEND\nGO\nEXEC dbo.usp_example @min_qty = 2;`],
    ["TRY…CATCH with THROW", `BEGIN TRY\n    BEGIN TRANSACTION;\n    -- your statements\n    COMMIT TRANSACTION;\nEND TRY\nBEGIN CATCH\n    IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;\n    THROW;\nEND CATCH`],
  ];
  const sessions = {};
  const draftKey = (n) => "nimbus-tsql-draft-" + n;
  function queryEditor(res) {
    const db = S.db(res.name);
    const srv = S.res("sqlserver", res.props.server);
    const sess = sessions[res.id];
    if (!sess) {
      return {
        html: `<div class="blade qe-login"><div class="blade-head"><h1>Welcome to SQL Database Query Editor</h1></div>
          <div class="login-grid"><div class="login-card"><b>SQL server authentication</b><p class="muted">${srv && srv.props.auth === "entra" ? "Disabled: this server allows Microsoft Entra authentication only." : "Login and password."}</p><button class="btn" ${srv && srv.props.auth === "entra" ? "disabled" : ""} id="sql-login">Sign in with login</button></div>
          <div class="login-card"><b>Microsoft Entra authentication</b><p class="muted">Continue as learner@nimbuslearn.onmicrosoft.com</p><button class="btn btn-primary" id="entra-login" ${srv && !srv.props.entraAdmin ? "disabled" : ""}>Continue as learner@…</button>${srv && !srv.props.entraAdmin ? `<small class="err">No Microsoft Entra admin is set on the server.</small>` : ""}</div></div>
          <div id="login-err"></div></div>`,
        mount(root) {
          const attempt = () => {
            try {
              S.checkSqlNetwork(res.name, "client");
              sessions[res.id] = { user: "learner@nimbuslearn.onmicrosoft.com" };
              N.rerender();
            } catch (e) {
              root.querySelector("#login-err").innerHTML = `<div class="callout callout-error"><b>Login failed</b><p>${esc(e.message)}</p>${e.clientIp && srv ? `<button class="btn btn-sm btn-primary" id="allow-ip">Allowlist IP ${esc(N.CLIENT_IP)} on server ${esc(srv.name)}</button>` : srv ? `<button class="btn btn-sm" data-go='${J({ view: "resource", id: srv.id, tab: "networking" })}'>Open server networking</button>` : ""}</div>`;
              const a = root.querySelector("#allow-ip");
              if (a) a.onclick = () => { srv.props.firewall = srv.props.firewall || []; srv.props.firewall.push({ name: "ClientIPAddress_" + new Date().toISOString().slice(0, 10), start: N.CLIENT_IP, end: N.CLIENT_IP }); S.log("Create firewall rule", srv.name); S.changed("resource"); N.toast("Firewall rule added", "success"); attempt(); };
            }
          };
          root.querySelector("#entra-login").onclick = attempt;
          const sl = root.querySelector("#sql-login"); if (sl) sl.onclick = () => N.toast("Use Microsoft Entra authentication in Nimbus: SQL logins can't create users for managed identities.", "info", 6000);
        },
      };
    }
    let sql = N.pendingQuery || (() => { try { return localStorage.getItem(draftKey(res.name)); } catch (e) { return null; } })() || `-- T-SQL. Ctrl+Enter runs the selection or the whole script.\nSELECT TABLE_NAME, TABLE_TYPE\nFROM INFORMATION_SCHEMA.TABLES\nORDER BY TABLE_NAME;`;
    N.pendingQuery = null;
    const tables = S.tables(db).filter((x) => !x.name.startsWith("__"));
    const fac = (S.resOfType("factory")[0] || { name: "adf-yourfactory" }).name;
    return {
      html: `<div class="qe">
        <aside class="qe-tree"><div class="qe-tree-head">${I("sql")}<b>${esc(res.name)}</b><button class="icon-btn" id="tree-refresh" aria-label="Refresh">${I("refresh")}</button></div>
          <small class="muted">Signed in as ${esc(sess.user)}</small>
          <div id="tree">${treeHtml(tables)}</div></aside>
        <div class="qe-main">
          <div class="qe-bar">
            <button class="btn btn-primary btn-sm" id="run">${I("play")} Run</button>
            <select id="snip" aria-label="Insert snippet"><option value="">Snippets…</option>${SNIPPETS.map((s, i) => `<option value="${i}">${esc(s[0])}</option>`).join("")}</select>
            <button class="btn btn-sm" id="clear">Clear</button>
            <span class="dialect">${S.realStrict() ? "T-SQL · strict (Azure SQL)" : "T-SQL · guided (SQLite accepted)"}</span>
            <span class="grow"></span>
            <button class="btn btn-sm" id="ask">${I("tutor")} Explain</button>
          </div>
          <textarea id="sql" class="code editor" spellcheck="false" aria-label="T-SQL editor">${esc(sql)}</textarea>
          <div id="out" class="qe-out"><div class="empty-note">Results appear here.</div></div>
        </div></div>`,
      mount(root) {
        const ta = root.querySelector("#sql"), out = root.querySelector("#out");
        N.codeEditor(ta, () => run());
        ta.addEventListener("input", () => { try { localStorage.setItem(draftKey(res.name), ta.value); } catch (e) {} });
        const run = () => {
          const text = (ta.selectionStart !== ta.selectionEnd ? ta.value.slice(ta.selectionStart, ta.selectionEnd) : ta.value).trim();
          if (!text) return;
          out.innerHTML = `<div class="empty-note"><span class="spin"></span> Executing query…</div>`;
          setTimeout(() => {
            const t0 = Date.now();
            try {
              S.checkSqlNetwork(res.name, "client");
              const r2 = S.runTsql(res.name, text);
              N.sqlFlags(text); S.flag("tsql-ran");
              out.innerHTML = resultsHtml(r2, t0);
              wireResults(out);
              root.querySelector("#tree").innerHTML = treeHtml(S.tables(db).filter((x) => !x.name.startsWith("__")));
            } catch (e) {
              out.innerHTML = `<div class="callout callout-error"><b>Query failed</b><pre class="json">${esc(e.message)}</pre><button class="btn btn-sm" id="explain-err">${I("tutor")} Ask tutor why</button></div>`;
              out.querySelector("#explain-err").onclick = () => N.askTutor(`My T-SQL failed in Azure SQL Database (Nimbus emulation).\n\nScript:\n${text}\n\nError:\n${e.message}\n\nExplain the cause and the correct T-SQL.`);
            }
          }, 30);
        };
        root.querySelector("#run").onclick = run;
        root.querySelector("#clear").onclick = () => { ta.value = ""; ta.focus(); };
        root.querySelector("#snip").onchange = (e) => { const s = SNIPPETS[+e.target.value]; if (!s) return; ta.value = typeof s[1] === "function" ? s[1](fac) : s[1]; e.target.value = ""; ta.focus(); };
        root.querySelector("#ask").onclick = () => N.askTutor(`Explain this T-SQL for Azure SQL Database step by step, and point out anything that would fail or perform badly in real Azure:\n\n${ta.value}`);
        root.querySelector("#tree-refresh").onclick = () => (root.querySelector("#tree").innerHTML = treeHtml(S.tables(db).filter((x) => !x.name.startsWith("__"))));
        root.querySelector("#tree").addEventListener("click", (e) => { const b = e.target.closest("[data-tbl]"); if (b) { ta.value = `SELECT TOP (1000) *\nFROM [dbo].[${b.dataset.tbl}];`; run(); } });
      },
    };
  }
  function treeHtml(tables) {
    if (!tables.length) return `<div class="empty-note">No tables yet.</div>`;
    const grp = (type, label) => { const l = tables.filter((t) => t.type === type); return l.length ? `<div class="tree-grp">${label}</div>` + l.map((t) => `<details class="tree-node"><summary>${I(t.type === "view" ? "filter" : "table")}<span>dbo.${esc(t.name)}</span><small>${t.rows ?? ""}</small></summary><button class="link tree-sel" data-tbl="${esc(t.name)}">Select Top 1000 Rows</button><ul>${t.cols.map((c) => `<li><code>${esc(c.name)}</code> <small>${esc(c.type || "")}${c.pk ? " · PK" : ""}${c.notnull ? ", not null" : ", null"}</small></li>`).join("")}</ul></details>`).join("") : ""; };
    return grp("table", "Tables") + grp("view", "Views");
  }

  N.resultsHtml = resultsHtml;
  function resultsHtml(r, t0) {
    const last = r.results[r.results.length - 1];
    const msgs = (r.messages || []).concat([`\nCompletion time: ${new Date().toISOString()}`, `Query succeeded: Affected rows: ${r.changes || 0}`]);
    return `<div class="tabs small"><button class="tab active" data-rt="res">Results${r.results.length ? "" : " (none)"}</button><button class="tab" data-rt="chart">Chart</button><button class="tab" data-rt="msg">Messages</button></div>
      <div data-rp="res">${r.results.length ? r.results.map((x, i) => `${r.results.length > 1 ? `<div class="rs-cap">Result ${i + 1} · ${x.values.length} rows</div>` : ""}${N.grid(x.columns, x.values)}`).join("") : `<pre class="msgs">${esc((r.messages || []).join("\n") || "Commands completed successfully.")}</pre>`}</div>
      <div data-rp="chart" hidden>${last ? N.barChart(last.columns, last.values) : `<div class="empty-note">Nothing to chart.</div>`}</div>
      <div data-rp="msg" hidden><pre class="msgs">${esc(msgs.join("\n"))}</pre></div>
      <div class="qe-status">${I("check")} Query succeeded | ${r.ms} ms</div>`;
  }
  N.wireResults = wireResults;
  function wireResults(out) {
    out.querySelectorAll("[data-rt]").forEach((t) => (t.onclick = () => {
      out.querySelectorAll("[data-rt]").forEach((x) => x.classList.toggle("active", x === t));
      out.querySelectorAll("[data-rp]").forEach((p) => (p.hidden = p.dataset.rp !== t.dataset.rt));
    }));
  }
  N.codeEditor = (ta, onRun) => {
    ta.addEventListener("keydown", (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); onRun && onRun(); return; }
      if (e.key === "Tab" && !e.shiftKey) { e.preventDefault(); const s = ta.selectionStart, en = ta.selectionEnd; ta.value = ta.value.slice(0, s) + "    " + ta.value.slice(en); ta.selectionStart = ta.selectionEnd = s + 4; ta.dispatchEvent(new Event("input")); }
    });
  };
})(window.N);
