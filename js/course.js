/* Nimbus Portal — DE101: Data Engineering on Azure. Practicals, quizzes, Azure translation sheets and autograders. */
(function (N) {
  const S = N.store;
  const esc = (s) => N.esc(s);
  const RG = "rg-de101-dev";
  const ME = "learner@nimbuslearn.onmicrosoft.com";

  /* ======================= grader toolkit ======================= */
  const G = {
    rg: () => S.state.rgs.find((g) => g.name === RG),
    inRg: (type, prefix) => S.state.resources.filter((r) => r.type === type && r.rg === RG && (!prefix || r.name.startsWith(prefix))),
    acct: () => G.inRg("storage", "stde101")[0],
    server: () => G.inRg("sqlserver", "sql-de101")[0],
    dbRes: () => S.state.resources.find((r) => r.type === "sqldb" && r.name === "sqldb-de101" && G.server() && r.props.server === G.server().name),
    db: () => { const d = G.dbRes(); return d ? S.db(d.name) : null; },
    fac: () => G.inRg("factory", "adf-de101")[0],
    facObj: () => { const f = G.fac(); return f ? S.state.factories[f.name] : null; },
    ws: () => G.inRg("workspace").find((w) => w.name === "dbw-de101-dev"),
    q: (sql) => { const db = G.db(); if (!db) throw new Error("sqldb-de101 not found"); const r = db.exec(sql); return r.length ? r[0].values : []; },
    one: (sql) => { const v = G.q(sql); return v.length ? v[0][0] : null; },
    cols: (table) => { try { return G.db().exec(`PRAGMA table_info(${N.qid(table)})`)[0].values.map((v) => ({ name: v[1].toLowerCase(), type: String(v[2]).toLowerCase().replace(/\s+/g, ""), notnull: !!v[3], pk: !!v[5] })); } catch (e) { return []; } },
    exists: (name, type = "table") => { try { return !!G.db() && G.db().exec(`SELECT 1 FROM sqlite_master WHERE type='${type}' AND lower(name)=lower('${name}')`).length > 0; } catch (e) { return false; } },
    pub: (kind, name) => { const f = G.facObj(); return f && f.published ? (f.published[kind] || []).find((x) => x.name === name) : null; },
    draft: (kind, name) => { const f = G.facObj(); return f ? (f[kind] || []).find((x) => x.name === name) : null; },
    file: (path) => { const a = G.acct(); if (!a) return null; const [c, ...p] = path.split("/"); const cc = S.container(a.name, c); return cc ? cc.files[p.join("/")] : null; },
    put: (path, content) => { const a = G.acct(); const [c, ...p] = path.split("/"); S.putFile(a.name, c, p.join("/"), content, { source: "autograder" }); },
    del: (path) => { const a = G.acct(); const [c, ...p] = path.split("/"); S.deleteFile(a.name, c, p.join("/")); },
    async run(pl, params = {}) { const f = G.fac(); return N.engine.runPipeline(f.name, pl, params, { type: "Manual", name: "Autograder" }, {}); },
    async waitRun(pred, timeout = 25000) { const t0 = Date.now(); while (Date.now() - t0 < timeout) { const r = S.state.runs.find((x) => pred(x)); if (r && !["Queued", "InProgress"].includes(r.status)) return r; await N.sleep(400); } return null; },
    hasType: (cols, name, re) => { const c = cols.find((x) => x.name === name); return c && re.test(c.type); },
    approx: (a, b, tol = 0.011) => Math.abs(Number(a) - Number(b)) <= tol,
    acts: (pl) => (pl ? pl.activities || [] : []),
    ds: (name) => { const f = G.facObj(); return f && f.datasets.find((d) => d.name === name); },
  };
  const r2 = (x) => Math.round((x + Math.sign(x) * 1e-9) * 100) / 100;
  const hashStr = (s) => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return h; };
  N.course = N.course || {};
  N.course.G = G;

  /* ======================= reference data ======================= */
  function ref() {
    const d = N.sampleData();
    const orders = Object.values(d.orderFiles).flat();
    const ok = orders.filter((o) => o.status === "completed" || o.status === "shipped");
    return { d, orders, ok };
  }
  function syntheticDay(seedDay, n) {
    const d = N.sampleData(); const r = N.rng(7000 + seedDay);
    const rows = [];
    for (let i = 0; i < n; i++) { const p = r.pick(d.products); rows.push({ order_id: 60000 + seedDay * 1000 + i, order_ts: `2026-11-${String(seedDay).padStart(2, "0")}T${String(r.int(6, 23)).padStart(2, "0")}:${String(r.int(0, 59)).padStart(2, "0")}:00Z`, customer_id: r.pick(d.customers).customer_id, product_id: p.product_id, quantity: r.int(1, 4), unit_price: p.unit_price, discount_pct: r.pick([0, 0, 0, 10]), status: r.pick(["completed", "completed", "shipped"]), channel: r.pick(["web", "mobile_app"]) }); }
    return rows;
  }
  const csv = (rows) => N.toCSV(Object.keys(rows[0]), rows);
  /* data quality rules, evaluated in this order (spec R7.3) */
  function dqExpected(rows) {
    const prods = new Set(N.sampleData().products.map((p) => p.product_id));
    const out = { missing_customer: 0, bad_quantity: 0, bad_timestamp: 0, unknown_product: 0, duplicate: 0, clean: [] };
    const seen = new Set();
    for (const o of rows) {
      const q = String(o.quantity ?? "").trim();
      if (o.customer_id === "" || o.customer_id === null || o.customer_id === undefined) { out.missing_customer++; continue; }
      if (!/^[+-]?\d+$/.test(q) || +q <= 0) { out.bad_quantity++; continue; }
      if (!N.tsql.parseDate(o.order_ts, 127) || !/T/.test(o.order_ts)) { out.bad_timestamp++; continue; }
      if (!prods.has(o.product_id)) { out.unknown_product++; continue; }
      const key = JSON.stringify(o);
      if (seen.has(key)) { out.duplicate++; continue; }
      seen.add(key); out.clean.push(o);
    }
    return out;
  }

  /* ======================= shared Azure translation helpers ======================= */
  const code = (lang, s) => `<div class="code-cap">${esc(lang)}</div><pre>${esc(s)}</pre>`;
  const steps = (arr) => `<ol class="portal-steps">${arr.map((x) => `<li>${x}</li>`).join("")}</ol>`;
  const gotchas = (arr) => `<ul class="gotchas">${arr.map((x) => `<li>${x}</li>`).join("")}</ul>`;
  const teardown = code("bash", `# Stop all charges for this course: deletes everything in the group
az group delete --name ${RG} --yes --no-wait`);

  /* ======================= the course ======================= */
  const U = [];

  /* ---------- P1 ---------- */
  U.push({
    id: "p1", code: "P1", title: "The Azure resource model and a production-grade lake", weeks: "Week 1", minutes: 60,
    lecture: `
<h3>1. The hierarchy</h3>
<p>Every Azure object sits in one tree: <b>Microsoft Entra tenant</b> (identities) → <b>management groups</b> (policy at scale) → <b>subscriptions</b> (billing and quota boundary) → <b>resource groups</b> → <b>resources</b>. Two rules follow and matter daily:</p>
<ul><li><b>Inheritance.</b> RBAC role assignments and Azure Policy assignments flow down. Owner on a subscription is Owner on every resource in it.</li>
<li><b>Lifecycle.</b> A resource belongs to exactly one resource group. Deleting the group deletes everything in it. Group by lifecycle (one group per workload and environment), not by resource type.</li></ul>
<p>Every resource has a <b>resource ID</b>, the address Azure Resource Manager (ARM) uses for everything (APIs, RBAC scopes, templates):<br><code>/subscriptions/{sub}/resourceGroups/{rg}/providers/Microsoft.Storage/storageAccounts/{name}</code></p>
<h3>2. Resource Manager and resource providers</h3>
<p>The portal, the CLI, Bicep and Terraform all call the same ARM REST API. ARM routes each request to a <b>resource provider</b> (<code>Microsoft.Storage</code>, <code>Microsoft.Sql</code>, <code>Microsoft.DataFactory</code>…). A subscription must have a provider <i>registered</i> before it can use it, which you will hit in P6.</p>
<h3>3. Naming</h3>
<p>Use the Cloud Adoption Framework abbreviations: <code>rg-</code>, <code>st</code>, <code>sql-</code>, <code>sqldb-</code>, <code>adf-</code>, <code>dbw-</code>. Some names become DNS names and must be <b>globally unique</b> across all Azure customers: storage accounts (<code>{name}.blob.core.windows.net</code>, 3–24 lowercase letters and digits, no hyphens), SQL servers (<code>{name}.database.windows.net</code>), data factories.</p>
<h3>4. Storage accounts and ADLS Gen2</h3>
<p>A general-purpose v2 storage account offers Blob, File, Queue and Table services. Turning on <b>hierarchical namespace (HNS)</b> makes Blob storage a data lake (ADLS Gen2): directories become real objects (renames are atomic and O(1)), POSIX-style ACLs work, and analytics engines use the <code>dfs</code> endpoint through the <code>abfss://</code> driver. HNS sits on the portal's <b>Advanced</b> tab and is <b>off by default</b>. Enabling it later is a one-way upgrade.</p>
<p><b>Redundancy</b> decides how many copies exist and where:</p>
<table class="mini"><tr><th>SKU</th><th>Copies</th><th>Survives</th></tr><tr><td>LRS</td><td>3 in one datacenter</td><td>disk/rack failure</td></tr><tr><td>ZRS</td><td>3 across availability zones</td><td>a datacenter outage</td></tr><tr><td>GRS</td><td>LRS + LRS in the paired region (async)</td><td>a regional outage (after failover)</td></tr><tr><td>RA-GRS</td><td>GRS + read access to the secondary</td><td>reads during a regional outage</td></tr></table>
<p>The portal pre-selects RA-GRS. A dev lake rarely needs it: pick LRS deliberately.</p>
<h3>5. A security baseline</h3>
<ul><li>Minimum TLS 1.2, HTTPS only.</li><li>Anonymous blob access disabled at the account level.</li><li>Prefer Microsoft Entra ID (RBAC) over account keys. In production, disable shared key access entirely.</li><li>Tags (<code>env</code>, <code>owner</code>, <code>costCenter</code>) for cost allocation and policy.</li></ul>
<h3>6. Lake zones</h3>
<p>Separate data by quality: <b>bronze</b> (raw, immutable, replayable), <b>silver</b> (cleaned, conformed), <b>gold</b> (business-level aggregates). Containers per zone make RBAC simple: a pipeline can read bronze and write silver without touching gold.</p>`,
    quiz: [
      { q: "You delete resource group rg-de101-dev. What happens to the storage account inside it?", a: ["It is moved to the default resource group", "It is deleted with the group", "Deletion fails until the account is empty", "It is detached and keeps running"], c: 1, why: "A resource group is a lifecycle boundary: deleting it deletes every resource it contains." },
      { q: "Why must a storage account name be globally unique?", a: ["Microsoft bills per name", "It becomes part of a public DNS name such as name.blob.core.windows.net", "Resource IDs require it", "Only for premium accounts"], c: 1, why: "The account name forms the service endpoints' host names, which are global DNS records." },
      { q: "Which redundancy keeps three copies inside a single datacenter?", a: ["ZRS", "GRS", "LRS", "RA-GRS"], c: 2, why: "Locally-redundant storage replicates three times within one datacenter in the primary region." },
      { q: "What turns a general-purpose v2 storage account into Azure Data Lake Storage Gen2?", a: ["Choosing Premium performance", "Enabling hierarchical namespace", "Creating a container named 'datalake'", "Selecting the Cool tier"], c: 1, why: "ADLS Gen2 is Blob storage with hierarchical namespace enabled." },
      { q: "Owner is assigned to you at subscription scope. Which statement is true?", a: ["You are Owner on every resource group and resource in the subscription", "You must be re-assigned per resource group", "Owner only applies to resources you created", "Owner is not inheritable"], c: 0, why: "RBAC assignments inherit from higher scopes to all child scopes." },
    ],
    spec: [
      { id: "R1.1", text: `Resource group named exactly <code>${RG}</code> with tags <code>course=de101</code> and <code>env=dev</code>.` },
      { id: "R1.2", text: "Exactly one storage account in that group whose name starts with <code>stde101</code>, with: hierarchical namespace enabled, replication <b>LRS</b>, minimum TLS 1.2, anonymous blob access disabled, tag <code>env=dev</code>." },
      { id: "R1.3", text: "The storage account is in the same region as the resource group." },
      { id: "R1.4", text: "Containers <code>bronze</code>, <code>silver</code> and <code>gold</code> exist." },
      { id: "R1.5", text: "Raw data landed unchanged: the seven files <code>bronze/shopstream/orders/orders_2026-11-01.csv</code> … <code>_07.csv</code>, <code>bronze/shopstream/customers/customers.csv</code> and <code>bronze/shopstream/products/products.csv</code> (the ShopStream samples), byte-identical." },
      { id: "R1.6", text: "You have used the Azure CLI in Cloud Shell at least once (for example <code>az storage account show</code>)." },
    ],
    hints: { "R1.2": "Replication is on the Basics tab (it defaults to RA-GRS); TLS, anonymous access and hierarchical namespace are on the Advanced tab.", "R1.5": "Open the bronze container and use Add sample data. The samples land under shopstream/…", "R1.1": "Tags are on the Tags tab of the create form, or use az group create … --tags course=de101 env=dev" },
    azure: () => `
<h3>Portal path</h3>${steps(["Home → <b>Resource groups</b> → <b>+ Create</b> → Basics: name <code>rg-de101-dev</code>, region → Tags tab: <code>course=de101</code>, <code>env=dev</code> → Review + create.", "Home → <b>Storage accounts</b> → <b>+ Create</b> → Basics: resource group, name, region, Performance <i>Standard</i>, Redundancy <i>LRS</i>.", "<b>Advanced</b> tab: tick <i>Enable hierarchical namespace</i>; Minimum TLS 1.2; leave <i>Allow enabling anonymous access</i> unticked.", "Tags tab: <code>env=dev</code> → Review + create → Create.", "Storage account → <b>Data storage › Containers</b> → <b>+ Container</b> × 3: bronze, silver, gold.", "Upload: container → <b>Upload</b>, or Storage Explorer, or AzCopy for bulk loads."])}
<h3>Azure CLI</h3>${code("bash", `az group create --name ${RG} --location southafricanorth --tags course=de101 env=dev

az storage account create \\
  --name stde101<yourinitials> --resource-group ${RG} --location southafricanorth \\
  --sku Standard_LRS --kind StorageV2 --hns true \\
  --min-tls-version TLS1_2 --allow-blob-public-access false --tags env=dev

# --auth-mode login uses YOUR Entra identity: you need a Storage Blob Data role first,
# even as subscription Owner (control plane ≠ data plane, see P2)
az storage fs create --name bronze --account-name stde101<yourinitials> --auth-mode login
az storage fs create --name silver --account-name stde101<yourinitials> --auth-mode login
az storage fs create --name gold   --account-name stde101<yourinitials> --auth-mode login

azcopy login
azcopy copy './shopstream/*' 'https://stde101<yourinitials>.dfs.core.windows.net/bronze/shopstream/' --recursive`)}
<h3>Bicep</h3><p class="muted">Your current resource group exported as Bicep (Resource group → Export template):</p>${code("bicep", N.bicep ? N.bicep(RG) : "")}
<h3>Gotchas in real Azure</h3>${gotchas(["Hierarchical namespace is on the <b>Advanced</b> tab and off by default. Forgetting it gives you a plain blob account, and every Spark <code>abfss://</code> path fails.", "The portal pre-selects <b>RA-GRS</b>, about twice the price of LRS. Change it deliberately.", "<code>az storage … --auth-mode login</code> fails with a permissions error for subscription Owners until you grant yourself <i>Storage Blob Data Contributor</i>.", "Names are global: <code>stde101</code> alone is probably taken; add initials or a short random suffix."])}
<h3>Cost</h3><p>An LRS Hot account with a few MB costs well under 1 USD/month (pay per GB stored plus operations). The resource group itself is free.</p>
<h3>Teardown</h3>${teardown}`,
    tests: [
      { req: "R1.1", name: "resource group exists with tags", pts: 2, run: () => { const g = G.rg(); if (!g) return [false, `No resource group named ${RG}.`]; const t = Object.fromEntries(Object.entries(g.tags || {}).map(([k, v]) => [k.toLowerCase(), String(v).toLowerCase()])); return [t.course === "de101" && t.env === "dev", `tags = ${JSON.stringify(g.tags || {})}`]; } },
      { req: "R1.2", name: "single storage account named stde101*", pts: 1, run: () => { const l = G.inRg("storage", "stde101"); return [l.length === 1, `found ${l.length}: ${l.map((x) => x.name).join(", ") || "none"}`]; } },
      { req: "R1.2", name: "hierarchical namespace enabled", pts: 1, run: () => [!!(G.acct() && G.acct().props.hns), "isHnsEnabled = " + !!(G.acct() && G.acct().props.hns)] },
      { req: "R1.2", name: "replication is Standard_LRS", pts: 1, run: () => [G.acct() && G.acct().props.redundancy === "Standard_LRS", "sku = " + (G.acct() && G.acct().props.redundancy)] },
      { req: "R1.2", name: "TLS 1.2 and anonymous access off", pts: 1, run: () => { const p = (G.acct() || {}).props || {}; return [p.minTls === "TLS1_2" && !p.allowBlobPublic, `minimumTlsVersion=${p.minTls}, allowBlobPublicAccess=${!!p.allowBlobPublic}`]; } },
      { req: "R1.2", name: "storage tag env=dev", pts: 1, run: () => { const t = ((G.acct() || {}).props || {}).tags || {}; return [Object.entries(t).some(([k, v]) => k.toLowerCase() === "env" && String(v).toLowerCase() === "dev"), JSON.stringify(t)]; } },
      { req: "R1.3", name: "same region as resource group", pts: 1, run: () => [G.acct() && G.rg() && G.acct().region === G.rg().region, `${G.acct() && G.acct().region} vs ${G.rg() && G.rg().region}`] },
      { req: "R1.4", name: "containers bronze, silver, gold", pts: 1, run: () => { const a = G.acct(); const c = a ? Object.keys(S.state.lake[a.name].containers) : []; const miss = ["bronze", "silver", "gold"].filter((x) => !c.includes(x)); return [!miss.length, miss.length ? "missing: " + miss.join(", ") : "ok"]; } },
      { req: "R1.5", name: "raw files landed byte-identical", pts: 2, run: () => { const d = N.sampleData(); const exp = {}; N.sampleCatalog.filter((x) => ["shopstream-orders", "shopstream-customers", "shopstream-products"].includes(x.id)).forEach((x) => x.files().forEach((f) => (exp["bronze/" + f.path] = f.content))); const bad = Object.entries(exp).filter(([p, c]) => { const f = G.file(p); return !f || hashStr(f.content) !== hashStr(c); }).map(([p]) => p); return [!bad.length, bad.length ? `missing or modified: ${bad.slice(0, 3).join(", ")}${bad.length > 3 ? "…" : ""}` : "9 files verified"]; } },
      { req: "R1.6", name: "used the Azure CLI", pts: 1, run: () => [!!S.state.flags["shell-az"], S.state.flags["shell-az"] ? "az command seen" : "no az command run yet"] },
    ],
  });

  /* ---------- P2 ---------- */
  U.push({
    id: "p2", code: "P2", title: "Identity and access: control plane vs data plane", weeks: "Week 2", minutes: 90,
    lecture: `
<h3>1. Two planes</h3>
<p>Azure separates <b>managing a resource</b> (control plane: ARM, <code>management.azure.com</code>) from <b>using its data</b> (data plane: <code>{account}.blob.core.windows.net</code>, the SQL TDS endpoint on port 1433). Roles are plane-specific. <i>Owner</i> and <i>Contributor</i> can reconfigure a storage account, and could read its keys, but they do <b>not</b> grant Entra-authenticated read access to a single blob. That takes a data role: <i>Storage Blob Data Reader/Contributor/Owner</i>.</p>
<h3>2. Identities for workloads</h3>
<p>Pipelines must not use passwords or account keys. A <b>managed identity</b> is an Entra service principal whose credentials Azure rotates for you. <b>System-assigned</b>: created with the resource, same name, deleted with it (every data factory gets one). <b>User-assigned</b>: a standalone resource you can attach to many services. A Databricks workspace reaches storage through an <i>Access Connector for Azure Databricks</i>, which also carries a managed identity.</p>
<h3>3. RBAC = principal + role + scope</h3>
<p>Scope can be management group, subscription, resource group, resource, or a single <b>container</b>. Grant the narrowest scope that works (least privilege). New assignments take time to propagate, typically up to about 10 minutes, so a 403 right after granting is normal.</p>
<h3>4. Azure SQL security layers</h3>
<p>A connection to Azure SQL Database passes four gates in order. Learn to name the gate from the error:</p>
<table class="mini"><tr><th>Gate</th><th>Configured on</th><th>Typical error</th></tr>
<tr><td>Network</td><td>Server → Networking: public access, firewall rules, "Allow Azure services"</td><td>Client with IP address … is not allowed to access the server</td></tr>
<tr><td>Authentication</td><td>Server → Microsoft Entra ID (admin, Entra-only)</td><td>Login failed for user '&lt;token-identified principal&gt;'</td></tr>
<tr><td>Database user</td><td>Inside the database: <code>CREATE USER [name] FROM EXTERNAL PROVIDER</code></td><td>Login failed… (no user mapped)</td></tr>
<tr><td>Permissions</td><td>Database roles: <code>db_datareader</code>, <code>db_datawriter</code>, <code>db_ddladmin</code></td><td>The SELECT/INSERT permission was denied… / CREATE TABLE permission denied</td></tr></table>
<p>The firewall rule <code>AllowAllWindowsAzureIps</code> (0.0.0.0–0.0.0.0) admits traffic from <i>any</i> Azure service, including other customers' tenants, so authentication still matters. Production designs use private endpoints and a managed VNet instead.</p>
<p>Only a connection authenticated with Microsoft Entra ID can create users <code>FROM EXTERNAL PROVIDER</code>. That's why you set yourself as the server's Entra admin, and why <i>Entra-only authentication</i> (no SQL passwords at all) is the recommended baseline.</p>
<h3>5. Linked services</h3>
<p>In Data Factory, a <b>linked service</b> holds the endpoint plus an authentication method. With "System-assigned managed identity" it stores no secret; access is decided entirely by RBAC and database users. <b>Test connection</b> runs as the factory identity, so it fails if any gate above is closed.</p>`,
    quiz: [
      { q: "A data factory's identity has Contributor on the storage account. A Copy activity reading bronze with managed-identity auth fails with 403 AuthorizationPermissionMismatch. Why?", a: ["Contributor is a control-plane role and grants no Entra data access to blobs", "The container is private", "Contributor only works after 24 hours", "Copy activities need Owner"], c: 0, why: "Blob data access via Entra ID requires a Storage Blob Data role. Contributor manages the resource only." },
      { q: "Which T-SQL creates a database user for a data factory named adf-de101-x?", a: ["CREATE LOGIN [adf-de101-x] WITH PASSWORD = '…'", "CREATE USER [adf-de101-x] FROM EXTERNAL PROVIDER;", "GRANT CONNECT TO adf-de101-x", "EXEC sp_adduser 'adf-de101-x'"], c: 1, why: "Managed identities are Entra principals; contained users are created FROM EXTERNAL PROVIDER, by an Entra-authenticated connection." },
      { q: "ADF fails with 'Client with IP address 20.x.x.x is not allowed to access the server'. Which gate failed?", a: ["Authentication", "Database permissions", "Network (server firewall)", "Storage RBAC"], c: 2, why: "The connection was rejected by the server firewall before any authentication took place." },
      { q: "Least privilege for a pipeline that only reads bronze and writes silver is:", a: ["Storage Blob Data Owner on the subscription", "Storage Blob Data Contributor on the account", "Storage Blob Data Reader on bronze + Storage Blob Data Contributor on silver", "Contributor on the resource group"], c: 2, why: "Container scope with the minimum role per container grants exactly what is needed." },
      { q: "You granted a role 30 seconds ago and still get 403. Most likely:", a: ["The role is wrong", "RBAC propagation is still in progress", "Managed identities cannot use RBAC", "You must restart the factory"], c: 1, why: "Role assignments can take several minutes to propagate." },
    ],
    spec: [
      { id: "R2.1", text: "A SQL logical server in <code>rg-de101-dev</code> whose name starts with <code>sql-de101</code>, with you as Microsoft Entra admin and <b>Microsoft Entra-only authentication</b> enabled." },
      { id: "R2.2", text: "A database named <code>sqldb-de101</code> on that server, General Purpose serverless (<code>GP_S_Gen5_1</code>)." },
      { id: "R2.3", text: "A data factory in <code>rg-de101-dev</code> whose name starts with <code>adf-de101</code>." },
      { id: "R2.4", text: "The factory identity holds <b>Storage Blob Data Contributor</b> on the storage account (account scope or every container), and holds <b>no</b> control-plane role on it (Owner, Contributor, Storage Account Contributor)." },
      { id: "R2.5", text: "Server networking: public access <i>Selected networks</i>, the <code>AllowAllWindowsAzureIps</code> exception enabled, and a firewall rule for your client IP." },
      { id: "R2.6", text: "The factory identity is a user in <code>sqldb-de101</code> and a member of <code>db_datareader</code>, <code>db_datawriter</code> and <code>db_ddladmin</code>, and <b>not</b> <code>db_owner</code>." },
      { id: "R2.7", text: "Linked services <code>ls_adls</code> (ADLS Gen2 → your account) and <code>ls_sqldb</code> (Azure SQL → sqldb-de101), both using the system-assigned managed identity." },
      { id: "R2.8", text: "End-to-end probe as the factory identity: list bronze, write and delete a file in silver, create and drop a table in sqldb-de101." },
    ],
    hints: { "R2.4": "Storage account → Access control (IAM) → Add role assignment → Storage Blob Data Contributor → Managed identity → your factory.", "R2.5": "SQL server → Networking. Public network access defaults to Disabled when you choose 'No access' during creation.", "R2.6": "Open the database's Query editor, sign in with Entra, then CREATE USER … FROM EXTERNAL PROVIDER and three ALTER ROLE … ADD MEMBER statements.", "R2.1": "SQL server → Microsoft Entra ID blade, or choose Microsoft Entra-only authentication when creating the server." },
    azure: () => `
<h3>Portal path</h3>${steps(["Home → <b>SQL databases</b> → <b>+ Create</b> → Basics: database <code>sqldb-de101</code>, Server <i>Create new</i> → name <code>sql-de101-&lt;you&gt;</code>, Authentication method <i>Use Microsoft Entra-only authentication</i>, Set admin → yourself.", "Compute + storage → <i>Configure database</i> → General Purpose, Serverless, Gen5, 1 vCore.", "<b>Networking</b> tab: Connectivity method <i>Public endpoint</i>; Allow Azure services <i>Yes</i>; Add current client IP <i>Yes</i>.", "Home → <b>Data factories</b> → <b>+ Create</b> → name <code>adf-de101-&lt;you&gt;</code>, Git: configure later.", "Storage account → <b>Access control (IAM)</b> → <b>+ Add</b> → <i>Add role assignment</i> → <i>Storage Blob Data Contributor</i> → Members: <i>Managed identity</i> → Data factory → select yours → Review + assign.", "Database → <b>Query editor (preview)</b> → sign in with Microsoft Entra → run the T-SQL below.", "Data Factory Studio → <b>Manage</b> → Linked services → New → ADLS Gen2 / Azure SQL Database → Authentication: <i>System Assigned Managed Identity</i> → Test connection → Create."])}
<h3>Azure CLI</h3>${code("bash", `ME=$(az ad signed-in-user show --query id -o tsv)
az sql server create -n sql-de101-<you> -g ${RG} -l southafricanorth \\
  --enable-ad-only-auth --external-admin-principal-type User \\
  --external-admin-name "$(az ad signed-in-user show --query userPrincipalName -o tsv)" --external-admin-sid $ME
az sql db create -g ${RG} -s sql-de101-<you> -n sqldb-de101 \\
  -e GeneralPurpose -f Gen5 -c 1 --compute-model Serverless --auto-pause-delay 60
az sql server firewall-rule create -g ${RG} -s sql-de101-<you> -n AllowAllWindowsAzureIps --start-ip-address 0.0.0.0 --end-ip-address 0.0.0.0
az sql server firewall-rule create -g ${RG} -s sql-de101-<you> -n ClientIP --start-ip-address <your-ip> --end-ip-address <your-ip>

az datafactory create -g ${RG} -n adf-de101-<you> -l southafricanorth
ADF_MI=$(az datafactory show -g ${RG} -n adf-de101-<you> --query identity.principalId -o tsv)
az role assignment create --assignee-object-id $ADF_MI --assignee-principal-type ServicePrincipal \\
  --role "Storage Blob Data Contributor" \\
  --scope $(az storage account show -n stde101<you> -g ${RG} --query id -o tsv)`)}
<h3>T-SQL (as the Entra admin, in sqldb-de101)</h3>${code("sql", `CREATE USER [adf-de101-<you>] FROM EXTERNAL PROVIDER;
ALTER ROLE db_datareader ADD MEMBER [adf-de101-<you>];
ALTER ROLE db_datawriter ADD MEMBER [adf-de101-<you>];
ALTER ROLE db_ddladmin  ADD MEMBER [adf-de101-<you>];`)}
<h3>Linked service JSON</h3>${code("json", JSON.stringify({ name: "ls_sqldb", properties: { type: "AzureSqlDatabase", typeProperties: { server: "sql-de101-<you>.database.windows.net", database: "sqldb-de101", encrypt: "mandatory", trustServerCertificate: false, authenticationType: "SystemAssignedManagedIdentity" } } }, null, 2))}
<h3>Gotchas in real Azure</h3>${gotchas(["Choosing <i>No access</i> on the Networking tab (the default) disables public network access; even the portal query editor can't connect.", "The portal query editor needs <b>your</b> client IP in the firewall; ADF needs <i>Allow Azure services</i> (or private endpoints).", "<code>CREATE USER … FROM EXTERNAL PROVIDER</code> fails unless your connection is Entra-authenticated (not a SQL login).", "Role propagation: wait a few minutes before declaring a 403 a bug.", "Don't give pipelines <code>db_owner</code>: a bug in a script could drop everything."])}
<h3>Cost</h3><p>Serverless General Purpose (1 vCore) bills per second while active and pauses after an hour idle; the monthly free offer covers light coursework. A data factory with no runs costs nothing.</p>
<h3>Teardown</h3>${teardown}`,
    tests: [
      { req: "R2.1", name: "SQL server sql-de101* exists", pts: 1, run: () => [!!G.server(), G.server() ? G.server().name : "not found in " + RG] },
      { req: "R2.1", name: "Entra admin set and Entra-only auth", pts: 1, run: () => { const p = (G.server() || {}).props || {}; return [!!p.entraAdmin && p.auth === "entra", `entraAdmin=${p.entraAdmin || "none"}, auth=${p.auth}`]; } },
      { req: "R2.2", name: "database sqldb-de101 (GP serverless)", pts: 1, run: () => { const d = G.dbRes(); return [!!d && d.props.compute === "GP_S_Gen5_1", d ? "sku = " + d.props.compute : "not found on the server"]; } },
      { req: "R2.3", name: "data factory adf-de101*", pts: 1, run: () => [!!G.fac(), G.fac() ? G.fac().name : "not found"] },
      { req: "R2.4", name: "factory can write every lake container (data role)", pts: 1, run: () => { const f = G.fac(), a = G.acct(); if (!f || !a) return [false, "factory or storage missing"]; const bad = ["bronze", "silver", "gold"].filter((c) => !S.lakeRights(f.name, a.name, c, { ignoreDelay: true }).write); return [!bad.length, bad.length ? "no write on " + bad.join(", ") : "Storage Blob Data Contributor effective"]; } },
      { req: "R2.4", name: "no control-plane role for the factory", pts: 1, run: () => { const f = G.fac(); const x = S.state.roles.filter((r) => f && r.principal === f.name && S.ROLE_DEFS[r.role].plane === "control"); return [!!f && !x.length, x.length ? "found: " + x.map((r) => r.role).join(", ") : "least privilege ok"]; } },
      { req: "R2.5", name: "public access selected + Allow Azure services", pts: 1, run: () => { const p = (G.server() || {}).props || {}; const ok = p.publicAccess !== "disabled" && (p.firewall || []).some((f) => f.start === "0.0.0.0" && f.end === "0.0.0.0"); return [ok, `publicAccess=${p.publicAccess}, rules=${(p.firewall || []).map((f) => f.name).join(",") || "none"}`]; } },
      { req: "R2.5", name: "client IP rule", pts: 1, run: () => { const p = (G.server() || {}).props || {}; return [(p.firewall || []).some((f) => f.start === N.CLIENT_IP), `your IP ${N.CLIENT_IP}`]; } },
      { req: "R2.6", name: "factory is a database user with the three roles", pts: 1, run: () => { const f = G.fac(), d = G.dbRes(); const u = f && d && (d.props.users || {})[f.name.toLowerCase()]; const need = ["db_datareader", "db_datawriter", "db_ddladmin"]; return [!!u && need.every((r) => u.roles.includes(r)), u ? "roles: " + u.roles.join(", ") : "no user"]; } },
      { req: "R2.6", name: "factory is not db_owner", pts: 1, run: () => { const f = G.fac(), d = G.dbRes(); const u = f && d && (d.props.users || {})[f.name.toLowerCase()]; return [!!u && !u.roles.includes("db_owner"), u && u.roles.includes("db_owner") ? "db_owner is too broad" : "ok"]; } },
      { req: "R2.7", name: "ls_adls and ls_sqldb with managed identity", pts: 2, run: () => { const f = G.facObj(); if (!f) return [false, "no factory"]; const a = f.linked.find((l) => l.name === "ls_adls"), b = f.linked.find((l) => l.name === "ls_sqldb"); const ok = a && b && N.adf.lsKind(a) === "lake" && a.target === (G.acct() || {}).name && a.auth !== "AccountKey" && N.adf.lsKind(b) === "sql" && b.target === "sqldb-de101"; return [!!ok, `ls_adls=${a ? a.target + "/" + (a.auth || "MI") : "missing"}, ls_sqldb=${b ? b.target : "missing"}`]; } },
      { req: "R2.8", name: "probe as factory identity: lake read/write", pts: 1, run: () => { const f = G.fac(), a = G.acct(); try { S.checkLake(f.name, a.name, "bronze", "read"); S.checkLake(f.name, a.name, "silver", "write"); G.put("silver/_grader_probe.txt", "probe"); G.del("silver/_grader_probe.txt"); return [true, "list bronze, write/delete silver: ok"]; } catch (e) { return [false, e.message.split("\n")[0].slice(0, 300)]; } } },
      { req: "R2.8", name: "probe as factory identity: SQL DDL", pts: 2, run: () => { const f = G.fac(); try { S.runTsql("sqldb-de101", "CREATE TABLE dbo.__grader_probe (id INT);\nDROP TABLE dbo.__grader_probe;", { principal: f.name }); return [true, "create/drop table ok"]; } catch (e) { return [false, e.message.split("\n")[0].slice(0, 300)]; } } },
    ],
  });

  /* ---------- P3 ---------- */
  const P3_SETUP = (() => {
    const pr = N.sampleData().products.slice(0, 12);
    return `-- Practical 3 setup. Run once in sqldb-de101 (safe to re-run).
DROP TABLE IF EXISTS dbo.product_prices;
DROP TABLE IF EXISTS dbo.price_changes;

CREATE TABLE dbo.product_prices (
    product_id NVARCHAR(10)  NOT NULL PRIMARY KEY,
    category   NVARCHAR(50)  NOT NULL,
    unit_price DECIMAL(10,2) NOT NULL,
    updated_at DATETIME2     NULL
);
INSERT INTO dbo.product_prices (product_id, category, unit_price) VALUES
${pr.map((p) => `    ('${p.product_id}', '${p.category}', ${p.unit_price.toFixed(2)})`).join(",\n")};

CREATE TABLE dbo.price_changes (
    product_id NVARCHAR(10)  NOT NULL,
    category   NVARCHAR(50)  NOT NULL,
    unit_price DECIMAL(10,2) NOT NULL
);
INSERT INTO dbo.price_changes (product_id, category, unit_price) VALUES
${pr.slice(0, 10).map((p, i) => `    ('${p.product_id}', '${p.category}', ${(i === 1 ? p.unit_price + 5 : i === 4 ? p.unit_price - 2.5 : p.unit_price).toFixed(2)})`).join(",\n")},
    ('P035', 'Electronics', 149.00),
    ('P036', 'Home', 12.75);`;
  })();
  function p3Expected() {
    const pr = N.sampleData().products.slice(0, 12);
    const rows = pr.slice(0, 10).map((p, i) => ({ product_id: p.product_id, category: p.category, unit_price: i === 1 ? r2(p.unit_price + 5) : i === 4 ? r2(p.unit_price - 2.5) : p.unit_price, changed: i === 1 || i === 4 }));
    rows.push({ product_id: "P035", category: "Electronics", unit_price: 149, changed: false, inserted: true }, { product_id: "P036", category: "Home", unit_price: 12.75, changed: false, inserted: true });
    return rows;
  }
  U.push({
    id: "p3", code: "P3", title: "T-SQL for data engineers", weeks: "Week 3", minutes: 120,
    lecture: `
<h3>1. Why T-SQL precision matters</h3>
<p>Azure SQL Database speaks <b>T-SQL</b>. Habits from other databases fail loudly here (<code>LIMIT</code> → <i>Incorrect syntax near 'LIMIT'</i>) or quietly (string comparison follows the collation, so <code>'abc' = 'ABC'</code> is true under the default <code>SQL_Latin1_General_CP1_CI_AS</code>).</p>
<table class="mini"><tr><th>Need</th><th>T-SQL</th><th>Not</th></tr>
<tr><td>first n rows</td><td><code>SELECT TOP (10) …</code> / <code>OFFSET 0 ROWS FETCH NEXT 10 ROWS ONLY</code></td><td><code>LIMIT 10</code></td></tr>
<tr><td>new table from a query</td><td><code>SELECT … INTO dbo.t FROM …</code></td><td><code>CREATE TABLE t AS SELECT</code></td></tr>
<tr><td>surrogate key</td><td><code>INT IDENTITY(1,1)</code></td><td><code>AUTOINCREMENT</code>, <code>SERIAL</code></td></tr>
<tr><td>now (UTC in Azure SQL)</td><td><code>SYSUTCDATETIME()</code>, <code>GETDATE()</code></td><td><code>now()</code></td></tr>
<tr><td>date math</td><td><code>DATEADD(DAY, 1, d)</code>, <code>DATEDIFF(DAY, a, b)</code></td><td><code>d + INTERVAL '1 day'</code></td></tr>
<tr><td>null replace</td><td><code>ISNULL(x, 0)</code>, <code>COALESCE</code></td><td><code>IFNULL</code>, <code>NVL</code></td></tr>
<tr><td>safe conversion</td><td><code>TRY_CAST</code>, <code>TRY_CONVERT(type, x, style)</code></td><td><code>x::int</code></td></tr></table>
<h3>2. Types are a contract</h3>
<p><code>DECIMAL(p,s)</code> stores money exactly; <code>FLOAT</code> doesn't. <code>NVARCHAR</code> stores Unicode (2 bytes per character); <code>VARCHAR</code> is code-page text. <code>DATE</code> has no time; <code>DATETIME2(7)</code> is the modern timestamp. <code>BIT</code> is a boolean (0/1); T-SQL has no <code>TRUE</code> literal.</p>
<h3>3. Batches</h3>
<p>Tools send scripts in <b>batches</b> separated by <code>GO</code>. <code>GO</code> is not T-SQL: it's a client-tool separator. <code>CREATE VIEW</code>, <code>CREATE PROCEDURE</code>, <code>CREATE FUNCTION</code> must be the <b>first statement</b> in their batch. A procedure's body is <i>everything up to the next GO</i>, a classic way to accidentally fold your test query into the procedure.</p>
<h3>4. Set-based thinking</h3>
<p>Write one statement that transforms a set, not loops. <b>CTEs</b> (<code>WITH</code>) name intermediate sets; a <b>recursive CTE</b> generates sequences such as a calendar (T-SQL needs no <code>RECURSIVE</code> keyword; the default recursion limit is 100, change it with <code>OPTION (MAXRECURSION n)</code>). <b>Window functions</b> (<code>ROW_NUMBER</code>, <code>RANK</code>, <code>DENSE_RANK</code>, <code>SUM() OVER</code>) compute across related rows without collapsing them.</p>
<h3>5. MERGE: the upsert</h3>
<p><code>MERGE target USING source ON key WHEN MATCHED … WHEN NOT MATCHED [BY TARGET] … WHEN NOT MATCHED BY SOURCE …;</code> applies inserts, updates and deletes in one atomic statement. It must end with <code>;</code>. Add a condition to <code>WHEN MATCHED AND t.col &lt;&gt; s.col</code> so unchanged rows aren't rewritten; otherwise audit columns lie and change tracking fires for nothing.</p>
<h3>6. Procedures and error handling</h3>
<p>Stored procedures package logic with parameters (<code>@category NVARCHAR(50)</code>) and run from ADF's Stored procedure activity. Use <code>SET NOCOUNT ON</code>, wrap multi-statement changes in <code>BEGIN TRY … BEGIN TRAN … COMMIT … END TRY BEGIN CATCH IF @@TRANCOUNT &gt; 0 ROLLBACK; THROW; END CATCH</code>.</p>`,
    quiz: [
      { q: "Which statement creates dbo.big_orders from a query in Azure SQL Database?", a: ["CREATE TABLE dbo.big_orders AS SELECT * FROM dbo.orders WHERE amount > 100", "SELECT * INTO dbo.big_orders FROM dbo.orders WHERE amount > 100", "CREATE TABLE dbo.big_orders LIKE dbo.orders", "INSERT INTO NEW dbo.big_orders SELECT …"], c: 1, why: "SELECT … INTO creates the table. CTAS exists in Synapse/Fabric warehouses, not in Azure SQL Database." },
      { q: "Your script runs: SELECT 1; CREATE VIEW dbo.v AS SELECT 2; It fails with Msg 111. Fix?", a: ["Add WITH SCHEMABINDING", "Put GO before CREATE VIEW", "Use CREATE OR ALTER", "Wrap it in BEGIN/END"], c: 1, why: "CREATE VIEW must be the first statement in a batch; GO starts a new batch." },
      { q: "What does WHEN NOT MATCHED BY SOURCE THEN DELETE do in a MERGE?", a: ["Deletes source rows with no target match", "Deletes target rows that have no matching source row", "Deletes duplicate source rows", "Nothing unless OUTPUT is used"], c: 1, why: "BY SOURCE means the target row has no counterpart in the source." },
      { q: "TRY_CAST('08/11/2026' AS DATE) under the default us_english language returns:", a: ["NULL", "2026-11-08", "2026-08-11", "an error"], c: 2, why: "us_english uses mdy order, so 08/11/2026 is 11 August. Use TRY_CONVERT with an explicit style (103 for dd/mm/yyyy, 126/127 for ISO 8601) to be unambiguous." },
    ],
    spec: [
      { id: "R3.1", text: "<code>dbo.dim_date</code> with columns <code>date_key INT NOT NULL PRIMARY KEY</code> (yyyymmdd), <code>full_date DATE NOT NULL</code>, <code>year INT</code>, <code>month INT</code>, <code>day INT</code>, <code>day_name NVARCHAR(10)</code> (e.g. Sunday), <code>is_weekend BIT</code> (1 on Saturday and Sunday); exactly the 30 days of November 2026, generated with a recursive CTE." },
      { id: "R3.2", text: `Run the setup script below once. Then write <b>one</b> <code>MERGE</code> that makes <code>dbo.product_prices</code> match <code>dbo.price_changes</code>: update the price <i>only where it changed</i> and set <code>updated_at = SYSUTCDATETIME()</code> on those rows, insert new products, delete products missing from <code>price_changes</code>. Unchanged rows must keep <code>updated_at</code> NULL.<pre class="setup">${esc(P3_SETUP)}</pre>` },
      { id: "R3.3", text: "View <code>dbo.v_price_rank</code> over <code>dbo.product_prices</code> with columns <code>product_id, category, unit_price, price_rank</code>, where <code>price_rank = DENSE_RANK()</code> by <code>unit_price</code> descending within each category." },
      { id: "R3.4", text: "Procedure <code>dbo.usp_category_summary @category NVARCHAR(50)</code> that returns one row: <code>category, products, avg_price</code> (<code>avg_price</code> as <code>DECIMAL(10,2)</code>) from <code>dbo.product_prices</code>." },
    ],
    hints: { "R3.1": "WITH d AS (SELECT CAST('2026-11-01' AS DATE) AS full_date UNION ALL SELECT DATEADD(DAY,1,full_date) FROM d WHERE full_date < '2026-11-30') SELECT … INTO dbo.dim_date FROM d. A PK needs an explicit CREATE TABLE first, then INSERT … SELECT.", "R3.2": "WHEN MATCHED AND t.unit_price <> s.unit_price THEN UPDATE SET unit_price = s.unit_price, updated_at = SYSUTCDATETIME()", "R3.3": "CREATE VIEW must start its batch: put GO on the line before it.", "R3.4": "CREATE OR ALTER PROCEDURE … AS BEGIN SET NOCOUNT ON; SELECT … END, then GO, then EXEC to test." },
    azure: () => `
<h3>Where you'd run this in Azure</h3>${steps(["Portal: database → <b>Query editor (preview)</b> → Microsoft Entra authentication. Good for quick checks; 5-minute query limit.", "Desktop: <b>SQL Server Management Studio</b> or <b>VS Code with the mssql extension</b>, server <code>sql-de101-&lt;you&gt;.database.windows.net</code>, authentication <i>Microsoft Entra MFA</i>.", "CLI: <code>sqlcmd -S sql-de101-&lt;you&gt;.database.windows.net -d sqldb-de101 --authentication-method ActiveDirectoryDefault -i p3.sql</code>.", "Version control: keep scripts in a SQL Database Project (<code>.sqlproj</code>) and deploy with a <code>dacpac</code> in CI/CD."])}
<h3>Reference: dim_date skeleton</h3>${code("sql", `CREATE TABLE dbo.dim_date (
    date_key   INT          NOT NULL PRIMARY KEY,
    full_date  DATE         NOT NULL,
    [year]     INT          NOT NULL,
    [month]    INT          NOT NULL,
    [day]      INT          NOT NULL,
    day_name   NVARCHAR(10) NOT NULL,
    is_weekend BIT          NOT NULL
);
-- then INSERT … SELECT from a recursive CTE (your work)`)}
<h3>Gotchas in real Azure</h3>${gotchas(["SSMS and the query editor send <code>GO</code>-separated batches. ADF's Script activity does not understand <code>GO</code>: use separate script blocks instead.", "Default collation is case-insensitive. A <code>WHERE status = 'Completed'</code> matches 'completed' in Azure SQL. (Nimbus's engine compares case-sensitively; write the exact case to be safe in both.)", "Recursive CTEs stop at 100 levels by default. A 10-year calendar needs <code>OPTION (MAXRECURSION 0)</code>.", "<code>MERGE</code> without a semicolon fails with Msg 10713. Under concurrency use <code>WITH (HOLDLOCK)</code> on the target."])}
<h3>Cost</h3><p>Query time on serverless bills vCore-seconds; these scripts run in milliseconds.</p>`,
    tests: [
      { req: "R3.1", name: "dim_date schema", pts: 1, run: () => { const c = G.cols("dim_date"); const ok = G.hasType(c, "date_key", /int/) && c.find((x) => x.name === "date_key").pk && G.hasType(c, "full_date", /^date$/) && G.hasType(c, "is_weekend", /bit/) && G.hasType(c, "day_name", /n?varchar\(10\)/) && ["year", "month", "day"].every((x) => G.hasType(c, x, /int/)); return [!!ok, c.map((x) => `${x.name} ${x.type}${x.pk ? " PK" : ""}`).join(", ") || "table missing"]; } },
      { req: "R3.1", name: "dim_date has November 2026 exactly", pts: 1, run: () => { if (!G.exists("dim_date")) return [false, "missing"]; const v = G.q("SELECT COUNT(*), MIN(date_key), MAX(date_key) FROM dim_date")[0]; return [v[0] === 30 && v[1] === 20261101 && v[2] === 20261130, `rows=${v[0]}, min=${v[1]}, max=${v[2]}`]; } },
      { req: "R3.1", name: "dim_date attributes correct", pts: 1, run: () => { if (!G.exists("dim_date")) return [false, "missing"]; const v = G.q("SELECT date_key, full_date, year, month, day, day_name, is_weekend FROM dim_date WHERE date_key IN (20261101, 20261103, 20261128) ORDER BY date_key"); const exp = [[20261101, "2026-11-01", 2026, 11, 1, "Sunday", 1], [20261103, "2026-11-03", 2026, 11, 3, "Tuesday", 0], [20261128, "2026-11-28", 2026, 11, 28, "Saturday", 1]]; const ok = JSON.stringify(v.map((r) => r.map((x, i) => (i === 1 ? String(x).slice(0, 10) : x)))) === JSON.stringify(exp); return [ok, ok ? "spot checks pass" : "got " + JSON.stringify(v)]; } },
      { req: "R3.2", name: "product_prices matches price_changes", pts: 2, run: () => { if (!G.exists("product_prices")) return [false, "run the setup script first"]; const v = G.q("SELECT product_id, category, unit_price FROM product_prices ORDER BY product_id"); const exp = p3Expected().sort((a, b) => a.product_id.localeCompare(b.product_id)); const ok = v.length === exp.length && exp.every((e, i) => v[i][0] === e.product_id && G.approx(v[i][2], e.unit_price)); return [ok, ok ? `${v.length} rows match` : `rows=${v.length} (expected ${exp.length}); first mismatch: ${JSON.stringify(v.find((r, i) => !exp[i] || r[0] !== exp[i].product_id || !G.approx(r[2], exp[i].unit_price)))}`]; } },
      { req: "R3.2", name: "updated_at only on changed rows", pts: 2, run: () => { if (!G.exists("product_prices")) return [false, "missing"]; const v = G.q("SELECT product_id, updated_at FROM product_prices"); const exp = p3Expected(); const changed = exp.filter((e) => e.changed).map((e) => e.product_id); const keep = exp.filter((e) => !e.changed && !e.inserted).map((e) => e.product_id); const bad = v.filter(([id, u]) => (changed.includes(id) && u == null) || (keep.includes(id) && u != null)); return [!bad.length && v.length > 0, bad.length ? "wrong updated_at on " + bad.map((x) => x[0]).join(", ") : "only changed rows stamped"]; } },
      { req: "R3.3", name: "v_price_rank matches DENSE_RANK", pts: 3, run: () => { if (!G.exists("v_price_rank", "view")) return [false, "view dbo.v_price_rank not found"]; const v = G.q("SELECT product_id, price_rank FROM v_price_rank"); const rows = G.q("SELECT product_id, category, unit_price FROM product_prices"); const exp = {}; const byCat = {}; rows.forEach((r) => (byCat[r[1]] = byCat[r[1]] || []).push(r)); Object.values(byCat).forEach((l) => { const prices = [...new Set(l.map((r) => r[2]))].sort((a, b) => b - a); l.forEach((r) => (exp[r[0]] = prices.indexOf(r[2]) + 1)); }); const bad = v.filter(([id, rk]) => exp[id] !== rk); return [v.length === rows.length && !bad.length, bad.length ? "wrong rank for " + bad.slice(0, 3).map((x) => x[0]).join(", ") : `${v.length} ranks correct`]; } },
      { req: "R3.4", name: "usp_category_summary returns the right row", pts: 3, run: () => { try { const r = N.tsql.run(G.db(), "EXEC dbo.usp_category_summary @category = N'Electronics'", { strict: true }); const last = r.results[r.results.length - 1]; if (!last || !last.values.length) return [false, "no result set"]; const cols = last.columns.map((c) => c.toLowerCase()); const row = Object.fromEntries(cols.map((c, i) => [c, last.values[0][i]])); const e = G.q("SELECT COUNT(*), AVG(unit_price) FROM product_prices WHERE category = 'Electronics'")[0]; const ok = row.category === "Electronics" && row.products === e[0] && G.approx(row.avg_price, r2(e[1])); return [ok, `got ${JSON.stringify(row)}; expected products=${e[0]}, avg_price=${r2(e[1])}`]; } catch (e) { return [false, e.message.split("\n").slice(0, 2).join(" ")]; } } },
    ],
  });

  /* ---------- P4 ---------- */
  U.push({
    id: "p4", code: "P4", title: "Batch ingestion with Azure Data Factory", weeks: "Week 4", minutes: 120,
    lecture: `
<h3>1. The ADF object model</h3>
<p><b>Linked service</b> (where + how to authenticate) → <b>dataset</b> (a named shape of data in that store: container/folder/file and format, or a table) → <b>activity</b> (a step) → <b>pipeline</b> (activities plus dependencies and parameters) → <b>trigger</b> (when). Compute comes from an <b>integration runtime</b>: the serverless Azure IR by default.</p>
<h3>2. The Copy activity</h3>
<ul><li><b>Source</b>: a dataset, optionally overridden with <i>wildcard folder path</i> and <i>wildcard file name</i> (<code>orders_*.csv</code>). Only matching files are read; others are ignored.</li>
<li><b>Additional columns</b>: <code>$$FILEPATH</code> stamps each row with the file it came from (lineage), and expressions add run metadata.</li>
<li><b>Mapping</b>: by column name by default. A source column with no sink column fails the copy.</li>
<li><b>Type conversion</b>: delimited text has no types, so every value is a string until the sink converts it. Values that can't convert fail the run (<i>TypeConversionFailure</i>), and dates parse with US conventions unless you control them.</li>
<li><b>Sink</b>: <i>pre-copy script</i> runs first (the standard way to make a full reload idempotent: <code>TRUNCATE TABLE</code>). <i>Auto create table</i> exists, but from CSV it creates every column as <code>nvarchar(max)</code>. Own your DDL instead.</li></ul>
<h3>3. Idempotency</h3>
<p>A pipeline will be re-run: by retries, by humans after an incident, by backfills. Design every load so running it twice leaves the same result as running it once. Full reload = truncate + insert. Incremental = merge on a business key (P6).</p>
<h3>4. Debug, Publish, Trigger</h3>
<p>Studio edits a <b>draft</b>. <b>Debug</b> runs the draft and shows output in the pipeline's Output pane (not in the Triggered runs list). <b>Publish all</b> deploys the draft. <b>Trigger now</b> and every trigger run the <b>published</b> version. "It works in Debug but fails when scheduled" usually means you forgot to publish. In Git mode, Publish also generates the ARM template used for CI/CD.</p>
<h3>5. Reading a run</h3>
<p>Monitor → pipeline run → each activity's <b>Input</b> (the resolved JSON: what really ran), <b>Output</b> (rows read/copied, files, DIUs, billing) and <b>Error</b> (code, failure type, message). Learn the output fields: <code>rowsRead</code>, <code>rowsCopied</code>, <code>filesRead</code>, <code>usedDataIntegrationUnits</code>, <code>billingReference</code>.</p>`,
    quiz: [
      { q: "Your Copy reads bronze/shopstream/orders with wildcard orders_*.csv. Someone drops notes.txt and backup_orders.csv into the folder. What's read?", a: ["All three", "Only files matching orders_*.csv", "Nothing: the run fails on unexpected files", "Only .csv files"], c: 1, why: "Wildcard filters select files by name pattern; non-matching files are ignored." },
      { q: "Copy from CSV into Azure SQL with 'Auto create table'. What types do the new columns get?", a: ["Inferred numeric/date types", "nvarchar(max) for every column", "varchar(255)", "sql_variant"], c: 1, why: "Delimited text carries no type information, so auto-create uses nvarchar(max)." },
      { q: "A scheduled trigger runs an older version of your pipeline than the one in the editor. Why?", a: ["Triggers cache for 24 hours", "Triggers run the published version; the edits weren't published", "Debug overwrote the trigger", "The IR is out of date"], c: 1, why: "Triggers and Trigger now run what was last published." },
      { q: "Which makes a full reload of dbo.stg_orders idempotent?", a: ["Pre-copy script: TRUNCATE TABLE dbo.stg_orders", "Enable staging", "Increase DIUs", "Use Auto create table"], c: 0, why: "Emptying the target before inserting means repeat runs produce the same final state." },
    ],
    spec: [
      { id: "R4.1", text: "Dataset <code>ds_bronze_orders</code>: DelimitedText on <code>ls_adls</code>, file system <code>bronze</code>, directory <code>shopstream/orders</code>, no file name, first row as header." },
      { id: "R4.2", text: "Dataset <code>ds_sql_table</code>: Azure SQL table on <code>ls_sqldb</code> with a dataset parameter <code>tableName</code> and table <code>@dataset().tableName</code>." },
      { id: "R4.3", text: "Table <code>dbo.stg_orders</code>, created by you: <code>order_id INT NOT NULL PRIMARY KEY, order_ts DATETIME2 NOT NULL, customer_id INT NULL, product_id NVARCHAR(10) NOT NULL, quantity INT NOT NULL, unit_price DECIMAL(10,2) NOT NULL, discount_pct INT NOT NULL, status NVARCHAR(20) NOT NULL, channel NVARCHAR(20) NOT NULL, source_file NVARCHAR(400) NOT NULL</code>." },
      { id: "R4.4", text: "Published pipeline <code>pl_ingest_orders</code> with one Copy activity: source <code>ds_bronze_orders</code> with wildcard file name <code>orders_*.csv</code>; additional column <code>source_file = $$FILEPATH</code>; sink <code>ds_sql_table</code> with <code>tableName = stg_orders</code>, a pre-copy script that truncates <code>dbo.stg_orders</code>, table option <i>Use existing</i>." },
      { id: "R4.5", text: "Grader triggers <code>pl_ingest_orders</code>: it succeeds and <code>stg_orders</code> holds every order from the seven files (row count, total quantity, gross value and 7 distinct <code>source_file</code> values are checked)." },
      { id: "R4.6", text: "Idempotency: a second run leaves exactly the same data." },
      { id: "R4.7", text: "Robustness: the grader drops decoy files (<code>README.txt</code>, <code>notes_orders.csv</code>) into the folder; the pipeline ignores them." },
    ],
    hints: { "R4.2": "Dataset → Parameters tab → New: tableName. Then Connection → Table → @dataset().tableName. The Copy sink then shows a 'tableName' box.", "R4.3": "Write the DDL in the query editor. Copy maps by column name, so names must match the CSV header plus source_file.", "R4.4": "Source tab → File path type → Wildcard file path. Sink tab → Pre-copy script: TRUNCATE TABLE dbo.stg_orders. Then Publish all.", "R4.5": "If the run fails, open Monitor → the run → Error on the Copy activity. Read which gate failed." },
    azure: () => `
<h3>Portal path (ADF Studio)</h3>${steps(["Data factory → <b>Launch studio</b> → <b>Author</b> (pencil) → Datasets → New dataset → <i>Azure Data Lake Storage Gen2</i> → <i>DelimitedText</i> → linked service <code>ls_adls</code> → file path <code>bronze / shopstream/orders / (empty)</code> → First row as header.", "New dataset → <i>Azure SQL Database</i> → <code>ls_sqldb</code> → Parameters tab: <code>tableName</code> → Connection: Table → Edit → <i>Add dynamic content</i> → <code>@dataset().tableName</code>.", "Pipelines → New pipeline <code>pl_ingest_orders</code> → drag <b>Copy data</b> → Source: dataset, Wildcard file path → Additional columns → New → <code>source_file</code> = <code>$$FILEPATH</code> → Sink: dataset, tableName, Pre-copy script.", "<b>Debug</b> → watch Output → fix → <b>Publish all</b> → <b>Add trigger → Trigger now</b> → <b>Monitor</b>."])}
<h3>The pipeline JSON you are building</h3>${code("json", JSON.stringify({ name: "pl_ingest_orders", properties: { activities: [{ name: "Copy orders", type: "Copy", typeProperties: { source: { type: "DelimitedTextSource", additionalColumns: [{ name: "source_file", value: "$$FILEPATH" }], storeSettings: { type: "AzureBlobFSReadSettings", recursive: true, wildcardFolderPath: "shopstream/orders", wildcardFileName: "orders_*.csv" }, formatSettings: { type: "DelimitedTextReadSettings" } }, sink: { type: "AzureSqlSink", preCopyScript: "TRUNCATE TABLE dbo.stg_orders", writeBehavior: "insert" }, translator: { type: "TabularTranslator", typeConversion: true, typeConversionSettings: { allowDataTruncation: true } } }, inputs: [{ referenceName: "ds_bronze_orders", type: "DatasetReference" }], outputs: [{ referenceName: "ds_sql_table", type: "DatasetReference", parameters: { tableName: "stg_orders" } }] }] } }, null, 2))}
<h3>Run it from the CLI</h3>${code("bash", `RUN=$(az datafactory pipeline create-run --factory-name adf-de101-<you> -g ${RG} -n pl_ingest_orders --query runId -o tsv)
az datafactory pipeline-run show --factory-name adf-de101-<you> -g ${RG} --run-id $RUN --query status`)}
<h3>Gotchas in real Azure</h3>${gotchas(["Copy maps by <b>name</b>: a header <code>Quantity</code> vs column <code>quantity</code> maps (case-insensitive), but <code>qty</code> doesn't.", "<code>TRUNCATE</code> needs ALTER permission on the table (<code>db_ddladmin</code>), not just <code>db_datawriter</code>.", "Each Copy bills at least one minute × DIUs (4 by default): many tiny copies cost more than one big one.", "If Debug works and Trigger now fails with 'pipeline not found', you haven't published."])}
<h3>Cost</h3><p>About 0.25 USD per DIU-hour for Azure IR data movement: a one-minute copy at 4 DIU ≈ 0.017 USD. Pipeline orchestration bills per activity run (fractions of a cent).</p>`,
    tests: [
      { req: "R4.1", name: "ds_bronze_orders", pts: 1, run: () => { const d = G.ds("ds_bronze_orders"); const ok = d && d.type === "DelimitedText" && d.linkedServiceName === "ls_adls" && d.container === "bronze" && d.folderPath.replace(/^\/|\/$/g, "") === "shopstream/orders" && !d.fileName && d.firstRowAsHeader !== false; return [!!ok, d ? JSON.stringify({ type: d.type, ls: d.linkedServiceName, path: `${d.container}/${d.folderPath}/${d.fileName}`, header: d.firstRowAsHeader }) : "missing"]; } },
      { req: "R4.2", name: "ds_sql_table parameterised", pts: 1, run: () => { const d = G.ds("ds_sql_table"); const ok = d && d.type === "AzureSqlTable" && d.linkedServiceName === "ls_sqldb" && (d.parameters || []).some((p) => p.name === "tableName") && /@dataset\(\)\.tableName/.test(d.table); return [!!ok, d ? `table=${d.table}, params=${(d.parameters || []).map((p) => p.name)}` : "missing"]; } },
      { req: "R4.3", name: "stg_orders DDL exact", pts: 2, run: () => { const c = G.cols("stg_orders"); const exp = { order_id: /^int$/, order_ts: /datetime2/, customer_id: /^int$/, product_id: /n?varchar\(10\)/, quantity: /^int$/, unit_price: /decimal\(10,2\)/, discount_pct: /^int$/, status: /n?varchar\(20\)/, channel: /n?varchar\(20\)/, source_file: /n?varchar\(400\)/ }; const bad = Object.entries(exp).filter(([k, re]) => !G.hasType(c, k, re)).map(([k]) => k); const pk = (c.find((x) => x.name === "order_id") || {}).pk; return [!bad.length && pk && c.length === 10, bad.length ? "wrong/missing: " + bad.join(", ") : !pk ? "order_id must be the PRIMARY KEY" : c.length !== 10 ? `expected 10 columns, found ${c.length}` : "ok"]; } },
      { req: "R4.4", name: "pl_ingest_orders published with the right Copy", pts: 3, run: () => { const p = G.pub("pipelines", "pl_ingest_orders"); if (!p) return [false, "not published"]; const c = G.acts(p).filter((a) => a.type === "Copy"); if (c.length !== 1) return [false, `expected one Copy activity, found ${c.length}`]; const a = c[0]; const errs = []; if (a.inputs[0].referenceName !== "ds_bronze_orders") errs.push("source dataset"); if (a.source.wildcardFileName !== "orders_*.csv") errs.push("wildcard file name"); if (!(a.source.additionalColumns || []).some((x) => x.name === "source_file" && x.value === "$$FILEPATH")) errs.push("source_file = $$FILEPATH"); if (a.outputs[0].referenceName !== "ds_sql_table" || (a.outputs[0].parameters || {}).tableName !== "stg_orders") errs.push("sink tableName"); if (!/truncate\s+table\s+(\[?dbo\]?\.)?\[?stg_orders\]?/i.test(a.sink.preCopyScript || "")) errs.push("pre-copy TRUNCATE"); if (a.sink.tableOption === "autoCreate") errs.push("table option should be Use existing"); return [!errs.length, errs.length ? "check: " + errs.join(", ") : "ok"]; } },
      { req: "R4.5", name: "triggered run loads every order", pts: 3, run: async () => { const extra = Object.keys((S.container(G.acct().name, "bronze") || { files: {} }).files).filter((p) => /^shopstream\/orders\/orders_.*\.csv$/.test(p) && !/orders_2026-11-0[1-7]\.csv$/.test(p)); if (extra.length) return [false, `remove extra files first: ${extra.join(", ")}`]; const run = await G.run("pl_ingest_orders"); if (run.status !== "Succeeded") return [false, "run failed: " + (run.error || "").slice(0, 400)]; const { orders } = ref(); const v = G.q("SELECT COUNT(*), SUM(quantity), ROUND(SUM(quantity * unit_price), 2), COUNT(DISTINCT source_file) FROM stg_orders")[0]; const eq = orders.length, qq = orders.reduce((s, o) => s + o.quantity, 0), gg = r2(orders.reduce((s, o) => s + o.quantity * o.unit_price, 0)); return [v[0] === eq && v[1] === qq && G.approx(v[2], gg, 0.05) && v[3] === 7, `rows ${v[0]}/${eq}, qty ${v[1]}/${qq}, gross ${v[2]}/${gg}, files ${v[3]}/7`]; } },
      { req: "R4.6", name: "second run is idempotent", pts: 2, run: async () => { const run = await G.run("pl_ingest_orders"); const n = G.one("SELECT COUNT(*) FROM stg_orders"); return [run.status === "Succeeded" && n === ref().orders.length, `status ${run.status}, rows ${n}`]; } },
      { req: "R4.7", name: "decoy files ignored", pts: 2, run: async () => { G.put("bronze/shopstream/orders/README.txt", "order files land here daily\n"); G.put("bronze/shopstream/orders/notes_orders.csv", "order_id,note\n1,hello\n"); try { const run = await G.run("pl_ingest_orders"); const n = G.one("SELECT COUNT(*) FROM stg_orders"); return [run.status === "Succeeded" && n === ref().orders.length, `status ${run.status}, rows ${n}`]; } finally { G.del("bronze/shopstream/orders/README.txt"); G.del("bronze/shopstream/orders/notes_orders.csv"); } } },
    ],
  });

  /* ---------- P5 ---------- */
  U.push({
    id: "p5", code: "P5", title: "Dimensional modelling and ELT orchestration", weeks: "Week 5", minutes: 150,
    lecture: `
<h3>1. Kimball in one page</h3>
<p>Analytical models are built around <b>business processes</b> (sales, returns). Each process becomes a <b>fact table</b> whose <b>grain</b> you declare first, one sentence such as "one row per order". Facts hold <b>measures</b> (quantity, net revenue) and <b>foreign keys</b> to <b>dimensions</b> (customer, product, date) that hold descriptive attributes. Measures are additive (sum over any dimension), semi-additive (balances) or non-additive (ratios).</p>
<h3>2. Keys</h3>
<p><b>Business keys</b> come from source systems (<code>customer_id</code>). <b>Surrogate keys</b> are warehouse-owned integers (<code>customer_key INT IDENTITY</code>). They insulate the warehouse from source key changes and enable slowly changing dimensions (SCD type 2 keeps history by adding a new row and a new key per change). Dates use a smart key <code>yyyymmdd</code>.</p>
<h3>3. ELT and orchestration</h3>
<p>Land raw data first (P4), then transform <i>inside</i> the database with set-based SQL, versioned as stored procedures. ADF orchestrates: <b>Execute Pipeline</b> composes pipelines, <b>Stored procedure</b> activities run the transforms, dependency conditions decide the order. Each step must be <b>re-runnable</b>: rebuild dimensions with MERGE or truncate-and-reload, rebuild facts per load window.</p>
<h3>4. Referential integrity</h3>
<p>Every fact row must find its dimension rows. Late-arriving or unknown members are mapped to an <i>unknown</i> row (key −1) rather than dropped. Test it: an orphan count of zero is a release gate.</p>
<h3>5. Parameterised datasets</h3>
<p>Don't create one dataset per file. A dataset with parameters (<code>folder</code>, <code>file</code>) used by many Copy activities keeps the factory small and reviewable.</p>`,
    quiz: [
      { q: "The grain 'one row per order' means:", a: ["Each order_id appears at most once in the fact table", "Every column is an order attribute", "The table is partitioned by order", "Orders are pre-aggregated by day"], c: 0, why: "The grain defines what a single fact row represents." },
      { q: "Why use a surrogate key in dim_customer instead of customer_id?", a: ["It's faster to type", "It decouples the warehouse from source keys and enables SCD type 2 history", "Azure SQL requires IDENTITY columns", "To hide customer IDs"], c: 1, why: "Surrogate keys let one business entity have several historical versions and survive source key changes." },
      { q: "Which ADF activity runs another pipeline and waits for it?", a: ["Lookup", "Execute Pipeline (wait on completion)", "Web", "Until"], c: 1, why: "Execute Pipeline invokes a child pipeline; with waitOnCompletion it blocks until the child finishes." },
      { q: "net_revenue is quantity × unit_price × (1 − discount_pct/100). In T-SQL, why divide by 100.0 rather than 100?", a: ["Style only", "discount_pct/100 with INT operands is integer division and returns 0 for 5/100", "100.0 is faster", "To avoid NULLs"], c: 1, why: "INT / INT truncates in T-SQL; 100.0 forces a decimal division." },
    ],
    spec: [
      { id: "R5.1", text: "One parameterised dataset <code>ds_bronze_file</code> (DelimitedText, bronze, parameters <code>folder</code> and <code>file</code>) used by a published pipeline <code>pl_ingest_reference</code> that loads <code>customers.csv</code> → <code>dbo.stg_customers</code> and <code>products.csv</code> → <code>dbo.stg_products</code> (your own typed tables, truncated before load)." },
      { id: "R5.2", text: "<code>dbo.dim_customer</code>: <code>customer_key INT IDENTITY PRIMARY KEY</code>, <code>customer_id INT NOT NULL UNIQUE</code>, <code>customer_name NVARCHAR(101)</code> (first + space + last), <code>city</code>, <code>country</code>, <code>segment</code>. One row per customer." },
      { id: "R5.3", text: "<code>dbo.dim_product</code>: <code>product_key INT IDENTITY PRIMARY KEY</code>, <code>product_id NVARCHAR(10) NOT NULL UNIQUE</code>, <code>product_name</code>, <code>category</code>, <code>list_price DECIMAL(10,2)</code>. One row per product." },
      { id: "R5.4", text: "<code>dbo.fact_sales</code>, grain one row per order with status <code>completed</code> or <code>shipped</code>: <code>order_id INT PRIMARY KEY, date_key INT, customer_key INT, product_key INT, quantity INT, net_revenue DECIMAL(12,2)</code> where <code>net_revenue = ROUND(quantity * unit_price * (1 - discount_pct / 100.0), 2)</code>. Every key resolves to its dimension (including <code>dim_date</code> from P3)." },
      { id: "R5.5", text: "Procedure <code>dbo.usp_build_warehouse</code> (no parameters) rebuilds both dimensions and the fact idempotently. Published pipeline <code>pl_build_warehouse</code>: Execute Pipeline <code>pl_ingest_orders</code> → Execute Pipeline <code>pl_ingest_reference</code> → Stored procedure <code>usp_build_warehouse</code>. The factory identity needs permission to execute procedures: grant it explicitly (<code>GRANT EXECUTE</code>), not <code>db_owner</code>. The grader runs it twice." },
    ],
    hints: { "R5.1": "Dataset path: bronze / @dataset().folder / @dataset().file. In each Copy, supply folder=shopstream/customers and file=customers.csv.", "R5.4": "INSERT INTO fact_sales SELECT o.order_id, CAST(FORMAT(o.order_ts,'yyyyMMdd') AS INT), c.customer_key, p.product_key, … FROM stg_orders o JOIN dim_customer c ON … JOIN dim_product p ON … WHERE o.status IN ('completed','shipped')", "R5.5": "Inside the procedure: DELETE FROM fact_sales first (facts reference dims), then rebuild dims, then the fact. Wrap it in TRY/CATCH with a transaction." },
    azure: () => `
<h3>Portal path</h3>${steps(["Studio → Author → Datasets → New → ADLS Gen2 → DelimitedText → Parameters: <code>folder</code>, <code>file</code> → Connection: <code>bronze / @dataset().folder / @dataset().file</code>.", "Pipeline <code>pl_ingest_reference</code>: two Copy activities, each sourcing <code>ds_bronze_file</code> with different parameter values.", "Query editor: create tables and <code>usp_build_warehouse</code>.", "Pipeline <code>pl_build_warehouse</code>: <b>General › Execute Pipeline</b> ×2 (Wait on completion ✓) → <b>General › Stored procedure</b> (linked service ls_sqldb, procedure name). Connect them with green Success arrows.", "Publish all → Trigger now."])}
<h3>Procedure skeleton</h3>${code("sql", `CREATE OR ALTER PROCEDURE dbo.usp_build_warehouse
AS
BEGIN
    SET NOCOUNT ON;
    BEGIN TRY
        BEGIN TRANSACTION;
        DELETE FROM dbo.fact_sales;
        -- rebuild dim_customer, dim_product (MERGE or delete + insert)
        -- INSERT INTO dbo.fact_sales (…) SELECT … FROM dbo.stg_orders o JOIN …
        COMMIT TRANSACTION;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH
END`)}
<h3>Execute Pipeline JSON</h3>${code("json", JSON.stringify({ name: "Ingest orders", type: "ExecutePipeline", typeProperties: { pipeline: { referenceName: "pl_ingest_orders", type: "PipelineReference" }, waitOnCompletion: true } }, null, 2))}
<h3>Gotchas in real Azure</h3>${gotchas(["Deleting dimension rows that facts reference fails if you declared foreign keys: delete facts first.", "<code>TRUNCATE</code> resets IDENTITY; <code>DELETE</code> doesn't. Surrogate keys change between rebuilds unless you MERGE.", "The Stored procedure activity needs EXECUTE permission: grant it (<code>GRANT EXECUTE ON SCHEMA::dbo TO [adf-…]</code>) or use a role that has it.", "Execute Pipeline with 'Wait on completion' unticked makes the parent continue immediately: subtle race conditions."])}`,
    tests: [
      { req: "R5.1", name: "ds_bronze_file parameterised", pts: 1, run: () => { const d = G.ds("ds_bronze_file"); const ps = (d && d.parameters || []).map((p) => p.name); return [!!d && d.container === "bronze" && ps.includes("folder") && ps.includes("file") && /@dataset\(\)\.folder/.test(d.folderPath) && /@dataset\(\)\.file/.test(d.fileName), d ? `path=${d.container}/${d.folderPath}/${d.fileName}` : "missing"]; } },
      { req: "R5.1", name: "pl_ingest_reference loads both staging tables", pts: 2, run: async () => { const p = G.pub("pipelines", "pl_ingest_reference"); if (!p) return [false, "not published"]; const uses = G.acts(p).filter((a) => a.type === "Copy" && a.inputs[0].referenceName === "ds_bronze_file").length; if (uses < 2) return [false, "both Copy activities must use ds_bronze_file"]; const run = await G.run("pl_ingest_reference"); if (run.status !== "Succeeded") return [false, (run.error || "").slice(0, 300)]; const a = G.exists("stg_customers") && G.one("SELECT COUNT(*) FROM stg_customers"), b = G.exists("stg_products") && G.one("SELECT COUNT(*) FROM stg_products"); return [a === 180 && b === 34, `stg_customers=${a}, stg_products=${b}`]; } },
      { req: "R5.5", name: "pl_build_warehouse runs (1st)", pts: 2, run: async () => { const p = G.pub("pipelines", "pl_build_warehouse"); if (!p) return [false, "not published"]; const t = G.acts(p).map((a) => a.type); if (!(t.filter((x) => x === "ExecutePipeline").length >= 2 && t.includes("SqlServerStoredProcedure"))) return [false, "expected 2× Execute Pipeline + Stored procedure, found " + t.join(", ")]; const run = await G.run("pl_build_warehouse"); return [run.status === "Succeeded", run.status === "Succeeded" ? "succeeded" : (run.error || "").slice(0, 400)]; } },
      { req: "R5.2", name: "dim_customer", pts: 2, run: () => { const c = G.cols("dim_customer"); if (!c.length) return [false, "missing"]; const v = G.q("SELECT COUNT(*), COUNT(DISTINCT customer_id), MAX(CASE WHEN customer_id = 1001 THEN customer_name END) FROM dim_customer")[0]; const c1 = N.sampleData().customers[0]; return [(c.find((x) => x.name === "customer_key") || {}).pk && v[0] === 180 && v[1] === 180 && v[2] === `${c1.first_name} ${c1.last_name}`, `rows=${v[0]}, distinct ids=${v[1]}, 1001 name='${v[2]}'`]; } },
      { req: "R5.3", name: "dim_product", pts: 1, run: () => { const c = G.cols("dim_product"); if (!c.length) return [false, "missing"]; const v = G.q("SELECT COUNT(*), COUNT(DISTINCT product_id) FROM dim_product")[0]; return [(c.find((x) => x.name === "product_key") || {}).pk && v[0] === 34 && v[1] === 34 && G.hasType(c, "list_price", /decimal\(10,2\)/), `rows=${v[0]}, list_price type=${(c.find((x) => x.name === "list_price") || {}).type}`]; } },
      { req: "R5.4", name: "fact_sales grain and totals", pts: 3, run: () => { if (!G.exists("fact_sales")) return [false, "missing"]; const { ok } = ref(); const exp = r2(ok.reduce((s, o) => s + r2(o.quantity * o.unit_price * (1 - o.discount_pct / 100)), 0)); const v = G.q("SELECT COUNT(*), COUNT(DISTINCT order_id), ROUND(SUM(net_revenue), 2) FROM fact_sales")[0]; return [v[0] === ok.length && v[1] === ok.length && G.approx(v[2], exp, 0.05), `rows ${v[0]}/${ok.length}, sum(net_revenue) ${v[2]}/${exp}`]; } },
      { req: "R5.4", name: "no orphan keys", pts: 2, run: () => { if (!G.exists("fact_sales")) return [false, "missing"]; const v = G.q(`SELECT SUM(CASE WHEN c.customer_key IS NULL THEN 1 ELSE 0 END), SUM(CASE WHEN p.product_key IS NULL THEN 1 ELSE 0 END), SUM(CASE WHEN d.date_key IS NULL THEN 1 ELSE 0 END) FROM fact_sales f LEFT JOIN dim_customer c ON c.customer_key = f.customer_key LEFT JOIN dim_product p ON p.product_key = f.product_key LEFT JOIN dim_date d ON d.date_key = f.date_key`)[0]; return [v.every((x) => x === 0), `orphans: customer ${v[0]}, product ${v[1]}, date ${v[2]}`]; } },
      { req: "R5.5", name: "EXECUTE granted without db_owner", pts: 1, run: () => { const f = G.fac(), d = G.dbRes(); const u = f && d && (d.props.users || {})[f.name.toLowerCase()]; return [!!u && (u.grants || []).includes("exec") && !u.roles.includes("db_owner"), u ? `roles ${u.roles.join(",")}, grants ${(u.grants || []).join(",") || "none"}` : "no user"]; } },
      { req: "R5.5", name: "second run: identical results", pts: 2, run: async () => { const before = G.q("SELECT COUNT(*), ROUND(SUM(net_revenue),2) FROM fact_sales")[0]; const run = await G.run("pl_build_warehouse"); const after = G.q("SELECT COUNT(*), ROUND(SUM(net_revenue),2), (SELECT COUNT(*) FROM dim_customer), (SELECT COUNT(*) FROM dim_product) FROM fact_sales")[0]; return [run.status === "Succeeded" && before[0] === after[0] && G.approx(before[1], after[1]) && after[2] === 180 && after[3] === 34, `fact ${before[0]}→${after[0]}, dims ${after[2]}/${after[3]}`]; } },
    ],
  });

  /* ---------- P6 ---------- */
  U.push({
    id: "p6", code: "P6", title: "Incremental, event-driven ingestion", weeks: "Week 6", minutes: 150,
    lecture: `
<h3>1. Full vs incremental</h3>
<p>Reloading everything is simple and correct, and it stops scaling. Incremental loads process only what's new, using either a <b>watermark</b> (max timestamp already loaded, stored in a control table and read with a Lookup) or <b>file-based arrival</b> (each new file is a unit of work). Either way you must handle <b>duplicates</b> (re-delivered files, retries) and <b>late corrections</b> (a fixed version of yesterday's file).</p>
<h3>2. Exactly-once is a property you build</h3>
<p>Event systems deliver <i>at least once</i>. A pipeline that blindly appends produces duplicates on the first retry. Stage the file, then <b>MERGE</b> on the business key: new keys insert, changed rows update, identical rows do nothing. Re-processing the same file then becomes a no-op.</p>
<h3>3. Storage event triggers</h3>
<p>ADF subscribes to <b>Event Grid</b> <code>Microsoft.Storage.BlobCreated</code> events for a storage account. Filters: <i>blob path begins with</i> (in JSON: <code>/container/blobs/path/</code>) and <i>ends with</i> (<code>.csv</code>). The trigger exposes <code>@triggerBody().fileName</code> and <code>@triggerBody().folderPath</code> to map into pipeline parameters. The subscription must have the <code>Microsoft.EventGrid</code> resource provider registered, or the trigger fails to start.</p>
<h3>4. Expressions</h3>
<p>Pipeline expressions start with <code>@</code>: <code>@pipeline().parameters.fileName</code>; inside strings use interpolation <code>@{…}</code>: <code>shopstream/incoming/@{pipeline().parameters.fileName}</code>. Functions: <code>concat</code>, <code>formatDateTime(utcNow(),'yyyy-MM-dd')</code>, <code>addDays</code>, <code>equals</code>, <code>greater</code>, <code>if</code>.</p>`,
    quiz: [
      { q: "Event Grid redelivers the same BlobCreated event and your pipeline runs twice for one file. Which design keeps the table correct?", a: ["Append with a unique index and ignore errors", "Stage the file, then MERGE on order_id", "Disable retries", "Use a schedule trigger instead"], c: 1, why: "MERGE on the business key makes reprocessing idempotent." },
      { q: "In trigger JSON, 'blob path begins with' for container bronze and folder shopstream/incoming/ is:", a: ["bronze/shopstream/incoming/", "/bronze/blobs/shopstream/incoming/", "/blobs/bronze/shopstream/incoming/", "shopstream/incoming/"], c: 1, why: "The format is /<container>/blobs/<path>." },
      { q: "Publishing a storage event trigger fails: subscription not registered to use namespace 'Microsoft.EventGrid'. Fix?", a: ["Create an Event Grid topic", "Register the Microsoft.EventGrid resource provider on the subscription", "Give the factory Owner", "Enable HNS"], c: 1, why: "Resource providers must be registered per subscription before use." },
      { q: "Which expression builds the source path for a parameter fileName?", a: ["shopstream/incoming/+fileName", "@concat('shopstream/incoming/', pipeline().parameters.fileName)", "${fileName}", "@shopstream/incoming/fileName"], c: 1, why: "Use @concat(...) or string interpolation shopstream/incoming/@{pipeline().parameters.fileName}." },
    ],
    spec: [
      { id: "R6.1", text: "Resource provider <code>Microsoft.EventGrid</code> is registered on the subscription." },
      { id: "R6.2", text: "Tables <code>dbo.stg_orders_delta</code> (same columns as <code>stg_orders</code>, no primary key needed) and <code>dbo.orders_incremental</code> (same columns, <code>order_id</code> primary key)." },
      { id: "R6.3", text: "Published pipeline <code>pl_ingest_file</code> with string parameter <code>fileName</code>: Copy <code>bronze/shopstream/incoming/&lt;fileName&gt;</code> (through a parameterised dataset) into <code>stg_orders_delta</code> (truncated first, <code>source_file = $$FILEPATH</code>), then MERGE <code>stg_orders_delta</code> into <code>orders_incremental</code> on <code>order_id</code>: insert new orders, update rows where any value differs." },
      { id: "R6.4", text: "Published, started storage event trigger <code>tr_orders_incoming</code>: your account, container <code>bronze</code>, path begins with <code>shopstream/incoming/</code>, ends with <code>.csv</code>, passing <code>fileName = @triggerBody().fileName</code>." },
      { id: "R6.5", text: "The grader drops <code>orders_2026-11-09.csv</code> (50 orders) into <code>bronze/shopstream/incoming/</code>; the trigger loads exactly those 50." },
      { id: "R6.6", text: "Redelivery: the same file is dropped again; <code>orders_incremental</code> is unchanged." },
      { id: "R6.7", text: "Correction: <code>orders_2026-11-09_v2.csv</code> arrives with 5 changed statuses and 3 new orders; the table ends with 53 rows and the changes applied." },
      { id: "R6.8", text: "Noise: <code>readme.txt</code> dropped in the same folder starts no pipeline run." },
    ],
    hints: { "R6.3": "Reuse ds_bronze_file with folder=shopstream/incoming and file=@pipeline().parameters.fileName. Put the MERGE in a Script activity or a stored procedure after the Copy.", "R6.4": "Studio → Manage → Triggers → New → Storage events. Then Publish all. If publishing fails, read the message about resource providers.", "R6.6": "If the second drop doubles your rows, you are appending instead of merging." },
    azure: () => `
<h3>Portal path</h3>${steps(["Subscriptions → your subscription → <b>Resource providers</b> → search <i>Microsoft.EventGrid</i> → <b>Register</b>.", "Studio → Author → pipeline <code>pl_ingest_file</code> → Parameters: <code>fileName</code> (String).", "Copy source: <code>ds_bronze_file</code> with folder <code>shopstream/incoming</code>, file <code>@pipeline().parameters.fileName</code>.", "Script activity (or Stored procedure) with the MERGE, connected on Success.", "Manage → <b>Triggers</b> → New → Type <i>Storage events</i> → account, container, begins with, ends with, Event <i>Blob created</i> → Continue → map <code>fileName</code> to <code>@triggerBody().fileName</code> → Start trigger on creation → <b>Publish all</b>."])}
<h3>Trigger JSON</h3>${code("json", JSON.stringify({ name: "tr_orders_incoming", properties: { type: "BlobEventsTrigger", runtimeState: "Started", typeProperties: { blobPathBeginsWith: "/bronze/blobs/shopstream/incoming/", blobPathEndsWith: ".csv", ignoreEmptyBlobs: true, scope: `/subscriptions/<sub>/resourceGroups/${RG}/providers/Microsoft.Storage/storageAccounts/stde101<you>`, events: ["Microsoft.Storage.BlobCreated"] }, pipelines: [{ pipelineReference: { referenceName: "pl_ingest_file", type: "PipelineReference" }, parameters: { fileName: "@triggerBody().fileName" } }] } }, null, 2))}
<h3>CLI</h3>${code("bash", `az provider register --namespace Microsoft.EventGrid
az provider show --namespace Microsoft.EventGrid --query registrationState -o tsv
# test the event path end to end
az storage fs file upload -f bronze --account-name stde101<you> --auth-mode login \\
  -s ./orders_2026-11-09.csv -p shopstream/incoming/orders_2026-11-09.csv`)}
<h3>Gotchas in real Azure</h3>${gotchas(["Event Grid delivery is at-least-once and usually arrives within seconds, but not in order. Design for duplicates and out-of-order files.", "The trigger only fires for <b>published, started</b> triggers. Stopped triggers silently miss files (events aren't replayed later).", "Files written by your own pipeline into the watched folder trigger it again: keep outputs out of the trigger's path.", "Uploading with tools that create a temp blob then rename can produce two events; filter with 'ends with'."])}`,
    tests: [
      { req: "R6.1", name: "Microsoft.EventGrid registered", pts: 1, run: () => [S.state.providers["Microsoft.EventGrid"] === "Registered", S.state.providers["Microsoft.EventGrid"]] },
      { req: "R6.2", name: "tables exist with PK on orders_incremental", pts: 1, run: () => { const a = G.cols("stg_orders_delta"), b = G.cols("orders_incremental"); return [a.length >= 10 && b.length >= 10 && (b.find((x) => x.name === "order_id") || {}).pk, `stg_orders_delta ${a.length} cols, orders_incremental ${b.length} cols, PK ${(b.find((x) => x.name === "order_id") || {}).pk ? "ok" : "missing"}`]; } },
      { req: "R6.3", name: "pl_ingest_file published with fileName", pts: 2, run: () => { const p = G.pub("pipelines", "pl_ingest_file"); if (!p) return [false, "not published"]; const has = (p.params || []).some((x) => x.name === "fileName"); const t = G.acts(p).map((a) => a.type); return [has && t.includes("Copy") && (t.includes("Script") || t.includes("SqlServerStoredProcedure")), `params=${(p.params || []).map((x) => x.name)}, activities=${t.join(", ")}`]; } },
      { req: "R6.4", name: "tr_orders_incoming published & started", pts: 2, run: () => { const t = G.pub("triggers", "tr_orders_incoming"); if (!t) return [false, "not published"]; const ok = t.type === "BlobEventsTrigger" && t.enabled && t.container === "bronze" && t.blobPathBeginsWith.replace(/^\/+/, "") === "shopstream/incoming/" && t.blobPathEndsWith === ".csv" && /triggerBody\(\)\.fileName/.test((t.parameters || {}).fileName || "") && t.pipeline === "pl_ingest_file"; return [ok, JSON.stringify({ container: t.container, begins: t.blobPathBeginsWith, ends: t.blobPathEndsWith, params: t.parameters, started: t.enabled })]; } },
      { req: "R6.5", name: "new file loaded by the trigger", pts: 3, run: async () => { if (G.exists("orders_incremental")) G.q("SELECT 1"); const before = Date.now(); const rows = syntheticDay(9, 50); G.put("bronze/shopstream/incoming/orders_2026-11-09.csv", csv(rows)); const run = await G.waitRun((x) => x.pipeline === "pl_ingest_file" && x.trigger.type === "BlobEventsTrigger" && x.start >= before - 50); if (!run) return [false, "no trigger run started within 25 s"]; if (run.status !== "Succeeded") return [false, "run failed: " + (run.error || "").slice(0, 300)]; const n = G.one("SELECT COUNT(*) FROM orders_incremental WHERE order_id BETWEEN 69000 AND 69999"); return [n === 50, `orders for 9 Nov: ${n}/50`]; } },
      { req: "R6.6", name: "redelivery is a no-op", pts: 2, run: async () => { const before = Date.now(); G.put("bronze/shopstream/incoming/orders_2026-11-09.csv", csv(syntheticDay(9, 50))); const run = await G.waitRun((x) => x.pipeline === "pl_ingest_file" && x.trigger.type === "BlobEventsTrigger" && x.start >= before - 50); const n = G.one("SELECT COUNT(*) FROM orders_incremental WHERE order_id BETWEEN 69000 AND 69999"); return [!!run && run.status === "Succeeded" && n === 50, `run ${run ? run.status : "none"}, rows ${n}`]; } },
      { req: "R6.7", name: "late correction applied", pts: 3, run: async () => { const base = syntheticDay(9, 50); const v2 = base.slice(0, 5).map((o) => ({ ...o, status: "returned" })).concat(syntheticDay(9, 53).slice(50)); const before = Date.now(); G.put("bronze/shopstream/incoming/orders_2026-11-09_v2.csv", csv(v2)); const run = await G.waitRun((x) => x.pipeline === "pl_ingest_file" && x.trigger.type === "BlobEventsTrigger" && x.start >= before - 50); const n = G.one("SELECT COUNT(*) FROM orders_incremental WHERE order_id BETWEEN 69000 AND 69999"); const ret = G.one(`SELECT COUNT(*) FROM orders_incremental WHERE status = 'returned' AND order_id IN (${base.slice(0, 5).map((o) => o.order_id).join(",")})`); return [!!run && run.status === "Succeeded" && n === 53 && ret === 5, `run ${run ? run.status : "none"}, rows ${n}/53, updated statuses ${ret}/5`]; } },
      { req: "R6.8", name: "non-csv file ignored", pts: 1, run: async () => { const before = Date.now(); G.put("bronze/shopstream/incoming/readme.txt", "incoming orders\n"); await N.sleep(2500); const runs = S.state.runs.filter((x) => x.pipeline === "pl_ingest_file" && x.start >= before - 50); G.del("bronze/shopstream/incoming/readme.txt"); return [runs.length === 0, `${runs.length} runs started`]; } },
    ],
  });

  /* ---------- P7 ---------- */
  function dqVeryBad() { const rows = syntheticDay(10, 30); rows.slice(0, 13).forEach((o, i) => { if (i % 2) o.customer_id = ""; else o.quantity = 0; }); return rows; }
  U.push({
    id: "p7", code: "P7", title: "Data quality gates and failure handling", weeks: "Week 7", minutes: 150,
    lecture: `
<h3>1. Dimensions of quality</h3>
<p><b>Completeness</b> (required values present), <b>validity</b> (types, ranges, formats), <b>uniqueness</b>, <b>referential integrity</b> (keys resolve), <b>timeliness</b> and <b>consistency</b> across systems. Every rule needs an owner and an action: <i>fix</i>, <i>quarantine</i> or <i>fail</i>.</p>
<h3>2. Land raw, validate in SQL</h3>
<p>Typed sinks reject or, worse, silently reinterpret data: a Copy into <code>DATETIME2</code> reads <code>08/11/2026</code> as 11 August. Land untrusted files into an all-<code>NVARCHAR</code> raw table, then validate with <code>TRY_CONVERT(type, value, style)</code>: <code>TRY_CONVERT(DATETIME2, x, 127)</code> accepts only ISO 8601. Good rows move on, bad rows go to a quarantine table with a <b>reason</b>, so someone can fix the source.</p>
<h3>3. Gates in ADF</h3>
<p>The standard pattern: Copy (raw) → Stored procedure (validate + split) → <b>Lookup</b> (measure: <code>SELECT … AS bad_pct</code>) → <b>If Condition</b> <code>@greater(activity('Measure').output.firstRow.bad_pct, 20)</code> → <b>Fail</b> activity with your own <code>errorCode</code> and message. A failed run fires your monitor alert; a quarantine below the threshold doesn't stop the business.</p>
<h3>4. Dependency conditions</h3>
<p>Each dependency has a condition: <b>Succeeded</b>, <b>Failed</b>, <b>Completed</b>, <b>Skipped</b>. "On failure" paths implement try/catch (send a notification, then fail). A pipeline is marked failed when a failure isn't handled by a downstream Failed/Completed path.</p>
<h3>5. Idempotent per file</h3>
<p>Reprocessing a file must replace that file's results, not add to them: delete <code>WHERE source_file = @file</code> in both the clean and quarantine tables before inserting.</p>`,
    quiz: [
      { q: "Why land untrusted CSVs into NVARCHAR columns instead of typed columns?", a: ["NVARCHAR is faster", "So bad values don't fail the copy or get silently reinterpreted, and can be validated and quarantined in SQL", "Typed columns are not supported by Copy", "To save storage"], c: 1, why: "Raw string landing preserves the original value for validation and audit." },
      { q: "Which expression fails a run when more than 20% of rows were quarantined?", a: ["If Condition @greater(activity('Measure').output.firstRow.bad_pct, 20) → Fail", "Set the Copy fault tolerance to 20%", "Lookup with firstRowOnly false", "Validation activity minimumSize 20"], c: 0, why: "Lookup measures, If Condition decides, Fail raises a custom error." },
      { q: "A Stored procedure activity has two downstream activities: Notify (dependency: Failed) and Load (dependency: Succeeded). The procedure succeeds. What runs?", a: ["Both", "Only Load; Notify is Skipped", "Only Notify", "Neither"], c: 1, why: "Dependency conditions select the path; unmatched downstream activities are skipped." },
      { q: "TRY_CONVERT(DATETIME2, '08/11/2026 14:02', 127) returns:", a: ["2026-08-11 14:02", "2026-11-08 14:02", "NULL", "an error"], c: 2, why: "Style 127 accepts only ISO 8601, so the ambiguous format yields NULL." },
    ],
    spec: [
      { id: "R7.1", text: "<code>dbo.stg_orders_raw</code>: the nine CSV columns as <code>NVARCHAR(100) NULL</code> plus <code>source_file NVARCHAR(400)</code>." },
      { id: "R7.2", text: "<code>dbo.dq_quarantine</code> (the raw columns + <code>dq_reason NVARCHAR(50) NOT NULL</code>) and <code>dbo.orders_clean</code> (typed exactly like <code>stg_orders</code>)." },
      { id: "R7.3", text: "Procedure <code>dbo.usp_dq_orders</code> processes <code>stg_orders_raw</code>. Rules in this order, each row gets the <i>first</i> rule it breaks as <code>dq_reason</code>: <code>missing_customer</code> (customer_id blank), <code>bad_quantity</code> (not an integer, or ≤ 0), <code>bad_timestamp</code> (<code>TRY_CONVERT(DATETIME2, order_ts, 127)</code> is NULL), <code>unknown_product</code> (not in <code>dim_product</code>), <code>duplicate</code> (an exact copy of an earlier valid row). Valid rows go to <code>orders_clean</code> with <code>status</code> trimmed and lower-cased. Re-processing a file replaces that file's previous results in both tables." },
      { id: "R7.4", text: "Published pipeline <code>pl_ingest_with_dq</code> (parameter <code>fileName</code>): Copy <code>bronze/shopstream/dq/&lt;fileName&gt;</code> → <code>stg_orders_raw</code> (truncated) → Stored procedure <code>usp_dq_orders</code> → Lookup computing the quarantined percentage for that file → If Condition (&gt; 20) → Fail with error code <code>DQ_THRESHOLD</code>." },
      { id: "R7.5", text: "The grader processes the messy file <code>orders_2026-11-08.csv</code>: exact quarantine counts per reason, exact clean count, normalised statuses." },
      { id: "R7.6", text: "Processing the same file again leaves both tables unchanged." },
      { id: "R7.7", text: "A file with more than 20% bad rows makes the run fail with error code <code>DQ_THRESHOLD</code> raised by your Fail activity." },
    ],
    hints: { "R7.3": "Build a CTE over stg_orders_raw computing dq_reason with CASE WHEN … in rule order. For duplicates, ROW_NUMBER() OVER (PARTITION BY all columns ORDER BY (SELECT NULL)) > 1 among rows whose reason IS NULL.", "R7.4": "Lookup query: SELECT CAST(100.0 * COUNT(*) / NULLIF((SELECT COUNT(*) FROM dbo.stg_orders_raw),0) AS INT) AS bad_pct FROM dbo.dq_quarantine WHERE source_file = (SELECT TOP (1) source_file FROM dbo.stg_orders_raw)", "R7.7": "If Condition → Activities → True branch: Fail activity with errorCode DQ_THRESHOLD." },
    azure: () => `
<h3>Portal path</h3>${steps(["Query editor: create the three tables and <code>usp_dq_orders</code>.", "Studio: pipeline <code>pl_ingest_with_dq</code> → Copy → Stored procedure → <b>Lookup</b> (source ds_sql_table, <i>Use query</i>) → <b>If Condition</b> (Activities: expression, then edit the True case and add a <b>Fail</b> activity).", "Publish all; test with Debug and parameter values."])}
<h3>The gate in ADF JSON</h3>${code("json", JSON.stringify({ name: "Gate", type: "IfCondition", dependsOn: [{ activity: "Measure", dependencyConditions: ["Succeeded"] }], typeProperties: { expression: { value: "@greater(activity('Measure').output.firstRow.bad_pct, 20)", type: "Expression" }, ifTrueActivities: [{ name: "Fail DQ", type: "Fail", typeProperties: { message: { value: "@concat('Quarantined ', string(activity('Measure').output.firstRow.bad_pct), '% of rows')", type: "Expression" }, errorCode: "DQ_THRESHOLD" } }] } }, null, 2))}
<h3>Gotchas in real Azure</h3>${gotchas(["Copy's own <i>fault tolerance</i> (skip incompatible rows) logs skipped rows to storage but gives you no business reasons. Use it for type errors, not for business rules.", "A Lookup returns at most 5,000 rows / 4 MB; measure with an aggregate query.", "If Condition branches can't contain another If Condition: use Switch, or a child pipeline.", "Alerting: Data factory → <b>Alerts & metrics</b> → New alert rule on <i>Failed pipeline runs metrics</i>, filtered by pipeline name."])}`,
    tests: [
      { req: "R7.1", name: "stg_orders_raw all strings", pts: 1, run: () => { const c = G.cols("stg_orders_raw"); const need = ["order_id", "order_ts", "customer_id", "product_id", "quantity", "unit_price", "discount_pct", "status", "channel"]; const bad = need.filter((n) => !G.hasType(c, n, /n?varchar\(100\)/)); return [!bad.length && c.some((x) => x.name === "source_file"), bad.length ? "not NVARCHAR(100): " + bad.join(", ") : "ok"]; } },
      { req: "R7.2", name: "quarantine and clean tables", pts: 1, run: () => { const q = G.cols("dq_quarantine"), c = G.cols("orders_clean"); return [q.some((x) => x.name === "dq_reason" && x.notnull) && G.hasType(c, "order_ts", /datetime2/) && G.hasType(c, "unit_price", /decimal\(10,2\)/), `dq_quarantine ${q.length} cols, orders_clean ${c.length} cols`]; } },
      { req: "R7.4", name: "pipeline shape", pts: 2, run: () => { const p = G.pub("pipelines", "pl_ingest_with_dq"); if (!p) return [false, "not published"]; const a = G.acts(p); const ifc = a.find((x) => x.type === "IfCondition"); const ok = a.some((x) => x.type === "Copy") && a.some((x) => x.type === "SqlServerStoredProcedure" && /usp_dq_orders/i.test(x.storedProcedureName)) && a.some((x) => x.type === "Lookup") && ifc && (ifc.ifTrueActivities || []).some((f) => f.type === "Fail" && f.errorCode === "DQ_THRESHOLD"); return [!!ok, a.map((x) => x.type).join(" → ")]; } },
      { req: "R7.5", name: "messy file: exact quarantine and clean counts", pts: 5, run: async () => { const rows = N.sampleData().dirty; G.put("bronze/shopstream/dq/orders_2026-11-08.csv", csv(rows)); const run = await G.run("pl_ingest_with_dq", { fileName: "orders_2026-11-08.csv" }); if (run.status !== "Succeeded") return [false, "run " + run.status + ": " + (run.error || "").slice(0, 300)]; const e = dqExpected(rows); const got = Object.fromEntries(G.q("SELECT dq_reason, COUNT(*) FROM dq_quarantine WHERE source_file LIKE '%orders_2026-11-08.csv' GROUP BY dq_reason")); const clean = G.one("SELECT COUNT(*) FROM orders_clean WHERE source_file LIKE '%orders_2026-11-08.csv'"); const upper = G.one("SELECT COUNT(*) FROM orders_clean WHERE status <> lower(trim(status))"); const reasons = ["missing_customer", "bad_quantity", "bad_timestamp", "unknown_product", "duplicate"]; const bad = reasons.filter((r) => (got[r] || 0) !== e[r]); return [!bad.length && clean === e.clean.length && upper === 0, `quarantine ${JSON.stringify(got)} expected ${JSON.stringify(Object.fromEntries(reasons.map((r) => [r, e[r]])))}; clean ${clean}/${e.clean.length}; non-normalised statuses ${upper}`]; } },
      { req: "R7.6", name: "reprocessing the file is idempotent", pts: 2, run: async () => { const q1 = G.one("SELECT COUNT(*) FROM dq_quarantine"), c1 = G.one("SELECT COUNT(*) FROM orders_clean"); const run = await G.run("pl_ingest_with_dq", { fileName: "orders_2026-11-08.csv" }); const q2 = G.one("SELECT COUNT(*) FROM dq_quarantine"), c2 = G.one("SELECT COUNT(*) FROM orders_clean"); return [run.status === "Succeeded" && q1 === q2 && c1 === c2, `quarantine ${q1}→${q2}, clean ${c1}→${c2}`]; } },
      { req: "R7.7", name: "threshold breach fails with DQ_THRESHOLD", pts: 3, run: async () => { G.put("bronze/shopstream/dq/orders_2026-11-10.csv", csv(dqVeryBad())); const run = await G.run("pl_ingest_with_dq", { fileName: "orders_2026-11-10.csv" }); const failedFail = run.activities.some((a) => a.status === "Failed" && a.error && a.error.errorCode === "DQ_THRESHOLD"); return [run.status === "Failed" && (failedFail || run.errorCode === "DQ_THRESHOLD"), `run ${run.status}, error code ${run.errorCode || "none"}`]; } },
    ],
  });

  /* ---------- P8 ---------- */
  function p8Expected() {
    const { ok, d } = ref();
    const prod = Object.fromEntries(d.products.map((p) => [p.product_id, p]));
    const agg = {};
    ok.forEach((o) => { const k = o.order_ts.slice(0, 10) + "|" + prod[o.product_id].category; agg[k] = agg[k] || { revenue: 0, orders: 0 }; agg[k].revenue += r2(o.quantity * o.unit_price * (1 - o.discount_pct / 100)); agg[k].orders++; });
    return Object.entries(agg).map(([k, v]) => { const [date, cat] = k.split("|"); return { order_date: date, category: cat, revenue: r2(v.revenue), orders: v.orders }; });
  }
  U.push({
    id: "p8", code: "P8", title: "Mapping data flows", weeks: "Week 8", minutes: 120,
    lecture: `
<h3>1. What a data flow is</h3>
<p>A <b>mapping data flow</b> is a visual transformation graph that ADF compiles to <b>Spark</b> and runs on a managed cluster. You author streams (source → transformations → sink) without writing code, in the <b>data flow expression language</b> (not SQL): <code>==</code>, <code>&amp;&amp;</code>, <code>||</code>, <code>iif()</code>, <code>in(['a','b'], col)</code>, <code>toDate()</code>, <code>round(sum(x), 2)</code>, <code>count()</code>.</p>
<h3>2. Core transformations</h3>
<p><b>Filter</b> (row condition), <b>Derived Column</b> (add or replace columns), <b>Select</b> (keep, rename, reorder), <b>Join</b> (inner/left/right/outer/cross on stream columns), <b>Exists</b> (semi/anti-join), <b>Aggregate</b> (group by + aggregates), <b>Sort</b>, <b>Sink</b>. Each output stream has a name; joins reference columns as <code>stream@column</code>.</p>
<h3>3. When to use one</h3>
<p>Data flows shine for wide, file-based transformations without a database. They cost cluster time (General purpose, 8 cores minimum) and a cold start of several minutes. If data already sits in Azure SQL, a stored procedure is usually cheaper and faster. Choosing the engine is part of the job.</p>
<h3>4. Sinks and files</h3>
<p>Spark writes <b>part files</b> (<code>part-00000-….csv</code>), one per partition. <i>Output to single file</i> forces one partition and lets you name the file: good for small exports, slow for big data. <i>Clear the folder</i> makes reruns idempotent.</p>`,
    quiz: [
      { q: "Which filter expression keeps completed or shipped orders in a data flow?", a: ["status IN ('completed','shipped')", "in(['completed','shipped'], status)", "WHERE status = 'completed' OR 'shipped'", "status == ['completed','shipped']"], c: 1, why: "The data flow language uses in(array, value); SQL IN isn't valid there." },
      { q: "Why might a data flow take 4 minutes for 1,000 rows?", a: ["Data flows are single-threaded", "Spark cluster start-up (cold start) dominates", "CSV parsing is slow", "Sorting is mandatory"], c: 1, why: "A fresh cluster takes minutes to provision; the work itself is tiny." },
      { q: "Output to single file implies:", a: ["Parallel writes", "A single partition, so all data funnels through one task", "Gzip compression", "A temporary table"], c: 1, why: "Single-file output requires one partition." },
    ],
    spec: [
      { id: "R8.1", text: "Sink dataset <code>ds_gold_daily_category</code>: DelimitedText on <code>ls_adls</code>, container <code>gold</code>, directory <code>daily_category_revenue</code>, no file name, header row." },
      { id: "R8.2", text: "Data flow <code>df_daily_category_revenue</code>: source <code>ds_bronze_orders</code> → Filter <code>in(['completed','shipped'], status)</code> → Derived Column <code>net_revenue = round(toDouble(quantity) * toDouble(unit_price) * (1 - toDouble(discount_pct) / 100), 2)</code> and <code>order_date = toDate(substring(order_ts, 1, 10))</code> → Join products (via a dataset over <code>products.csv</code>) on <code>product_id</code> → Aggregate by <code>order_date, category</code>: <code>revenue = round(sum(net_revenue), 2)</code>, <code>orders = count()</code> → Select <code>order_date, category, revenue, orders</code> → Sort <code>order_date, category</code> → Sink, <i>output to single file</i> <code>daily_category_revenue.csv</code>, clear the folder." },
      { id: "R8.3", text: "Published pipeline <code>pl_gold_daily</code> containing an Execute Data Flow activity for it." },
      { id: "R8.4", text: "Grader runs <code>pl_gold_daily</code>; <code>gold/daily_category_revenue/daily_category_revenue.csv</code> has header <code>order_date,category,revenue,orders</code> and the correct rows." },
    ],
    hints: { "R8.2": "For products, create a DelimitedText dataset pointing at bronze/shopstream/products/products.csv (or use ds_bronze_file with parameters). Data flow sources take dataset parameters too.", "R8.4": "Open the run's data flow Output: it shows the generated SQL Nimbus executed. Compare its columns with the spec." },
    azure: () => `
<h3>Portal path</h3>${steps(["Studio → Author → <b>Data flows</b> → New data flow → <i>Add Source</i> (dataset).", "Click <b>+</b> after each node: Filter, Derived Column, Join (right stream: products source), Aggregate, Select, Sort, Sink.", "Sink → Settings: <i>File name option</i> = Output to single file, name it; <i>Clear the folder</i>. Optimize tab: Single partition.", "Turn on <b>Data flow debug</b> (starts a cluster, ~5 minutes) to preview each step.", "Pipeline <code>pl_gold_daily</code> → <b>Move and transform › Data flow</b> → select it → Publish all → Trigger now."])}
<h3>Data flow script (what ADF stores)</h3>${code("dataflow", `source(allowSchemaDrift: true, validateSchema: false) ~> orders
source(allowSchemaDrift: true, validateSchema: false) ~> products
orders filter(in(['completed','shipped'], status)) ~> CompletedOnly
CompletedOnly derive(net_revenue = round(toDouble(quantity) * toDouble(unit_price) * (1 - toDouble(discount_pct) / 100), 2),
          order_date = toDate(substring(order_ts, 1, 10))) ~> AddRevenue
AddRevenue, products join(orders@product_id == products@product_id,
     joinType:'inner', broadcast: 'auto') ~> WithCategory
WithCategory aggregate(groupBy(order_date, category),
     revenue = round(sum(net_revenue), 2),
     orders = count()) ~> DailyByCategory
DailyByCategory sort(asc(order_date, true), asc(category, true)) ~> Sorted
Sorted sink(partitionFileNames:['daily_category_revenue.csv'], partitionBy('hash', 1)) ~> GoldSink`)}
<h3>Gotchas in real Azure</h3>${gotchas(["Data flow debug sessions bill while open (default TTL 60 minutes): switch it off when done.", "Columns from CSV sources are strings unless you import a schema or cast them (toDouble, toInteger).", "Joins with the same column name on both sides produce ambiguous columns: drop or rename in a Select.", "Minimum compute is 8 cores; a 1-minute flow still bills the cluster time including start-up."])}
<h3>Cost</h3><p>General purpose data flow compute is billed per vCore-hour (8 vCores minimum); a short run including cold start is typically a few cents to tens of cents.</p>`,
    tests: [
      { req: "R8.1", name: "ds_gold_daily_category", pts: 1, run: () => { const d = G.ds("ds_gold_daily_category"); return [!!d && d.type === "DelimitedText" && d.container === "gold" && d.folderPath.replace(/^\/|\/$/g, "") === "daily_category_revenue" && d.firstRowAsHeader !== false, d ? `${d.container}/${d.folderPath}` : "missing"]; } },
      { req: "R8.2", name: "data flow shape", pts: 3, run: () => { const df = G.pub("dataflows", "df_daily_category_revenue") || G.draft("dataflows", "df_daily_category_revenue"); if (!df) return [false, "missing"]; const t = (df.transforms || []).map((x) => x.type); const need = ["filter", "derivedColumn", "join", "aggregate", "select", "sort"]; const miss = need.filter((x) => !t.includes(x)); return [!miss.length && df.sink.singleFileName === "daily_category_revenue.csv" && df.source.dataset === "ds_bronze_orders", miss.length ? "missing: " + miss.join(", ") : `sink file ${df.sink.singleFileName || "(part files)"}`]; } },
      { req: "R8.3", name: "pl_gold_daily published", pts: 1, run: () => { const p = G.pub("pipelines", "pl_gold_daily"); return [!!p && G.acts(p).some((a) => a.type === "ExecuteDataFlow" && a.dataflow === "df_daily_category_revenue"), p ? G.acts(p).map((a) => a.type).join(", ") : "not published"]; } },
      { req: "R8.4", name: "gold output correct", pts: 6, run: async () => { const run = await G.run("pl_gold_daily"); if (run.status !== "Succeeded") return [false, (run.error || "").slice(0, 400)]; const f = G.file("gold/daily_category_revenue/daily_category_revenue.csv"); if (!f) return [false, "file not found"]; const p = N.parseCSV(f.content); if (p.columns.join(",") !== "order_date,category,revenue,orders") return [false, "header is " + p.columns.join(",")]; const exp = p8Expected(); const key = (x) => String(x.order_date).slice(0, 10) + "|" + x.category; const got = Object.fromEntries(p.rows.map((x) => [key(x), x])); const bad = exp.filter((e) => !got[key(e)] || !G.approx(got[key(e)].revenue, e.revenue, 0.05) || +got[key(e)].orders !== e.orders); return [!bad.length && p.rows.length === exp.length, bad.length ? `${bad.length} wrong rows, e.g. ${JSON.stringify(bad[0])} vs ${JSON.stringify(got[key(bad[0])])}` : `${exp.length} rows correct`]; } },
    ],
  });

  /* ---------- P9 ---------- */
  function p9Expected() {
    const ev = N.sampleData().events;
    const s = {};
    ev.forEach((e) => { const x = (s[e.session_id] = s[e.session_id] || { session_id: e.session_id, customer_id: null, first: e.ts, last: e.ts, events: 0, purchased: 0 }); x.events++; if (e.ts < x.first) x.first = e.ts; if (e.ts > x.last) x.last = e.ts; if (e.customer_id != null && (x.customer_id == null || e.customer_id > x.customer_id)) x.customer_id = e.customer_id; if (e.event_type === "purchase") x.purchased = 1; });
    return Object.values(s);
  }
  U.push({
    id: "p9", code: "P9", title: "Lakehouse notebooks with Spark SQL", weeks: "Week 9", minutes: 120,
    lecture: `
<h3>1. Spark in one page</h3>
<p>A Spark <b>driver</b> plans work; <b>executors</b> process <b>partitions</b> in parallel. Transformations are <b>lazy</b>: nothing runs until an action (display, write, count). Databricks notebooks attach to a cluster and run Python, Scala, R or SQL against the same Spark session.</p>
<h3>2. Reading the lake</h3>
<p>Spark addresses ADLS Gen2 with <code>abfss://&lt;container&gt;@&lt;account&gt;.dfs.core.windows.net/&lt;path&gt;</code>. In SQL, <code>read_files(path, format =&gt; 'csv', header =&gt; true)</code> infers a schema and adds a <code>_rescued_data</code> column for values that didn't fit. Without <code>header =&gt; true</code>, CSV columns are named <code>_c0</code>, <code>_c1</code>… and the header line becomes data. JSON objects become <b>structs</b>; read fields with dot notation: <code>device.type</code>.</p>
<h3>3. Access</h3>
<p>With Unity Catalog, an <b>Access Connector for Azure Databricks</b> (a managed identity) is granted a Storage Blob Data role; a <b>storage credential</b> and <b>external location</b> govern who may use which paths. Without the role every read fails with <code>403 AuthorizationPermissionMismatch</code>.</p>
<h3>4. Sessionisation with window functions</h3>
<p>Clickstream analysis groups events into sessions and computes per-session facts: first and last event, event count, conversion. <code>count_if(event_type = 'purchase') &gt; 0</code>, <code>min(ts)</code>, <code>max(ts)</code> by <code>session_id</code>. Window functions (<code>row_number() OVER (PARTITION BY session_id ORDER BY ts)</code>) give event order inside a session.</p>
<h3>5. Writing</h3>
<p>Spark writes a <b>directory</b>: one or more <code>part-*</code> files plus a <code>_SUCCESS</code> marker. <code>INSERT OVERWRITE DIRECTORY '…' USING CSV OPTIONS ('header' = 'true') SELECT …</code> replaces the directory contents. In production you'd write <b>Delta</b> tables (ACID, time travel, MERGE); Nimbus has no Delta, so this practical uses CSV.</p>`,
    quiz: [
      { q: "read_files on a CSV without header => true gives columns named:", a: ["the header values", "_c0, _c1, …", "col1, col2, …", "Prop_0, Prop_1, …"], c: 1, why: "Spark's CSV reader defaults to header=false and names columns _c0…; ADF uses Prop_0… in the same situation." },
      { q: "What does a successful Spark write leave in the output directory?", a: ["One file named after the table", "part-* files and a _SUCCESS marker", "A .zip archive", "A SQL dump"], c: 1, why: "Each task writes a part file; _SUCCESS marks a completed job." },
      { q: "A notebook gets 403 AuthorizationPermissionMismatch reading abfss://bronze@…. Fix?", a: ["Use http:// instead", "Grant the workspace's access connector identity a Storage Blob Data role", "Make the container public", "Restart the cluster"], c: 1, why: "Data-plane RBAC for the identity Spark uses is missing." },
    ],
    spec: [
      { id: "R9.1", text: "Databricks workspace <code>dbw-de101-dev</code> in <code>rg-de101-dev</code>." },
      { id: "R9.2", text: "Least privilege for the workspace identity: <b>Storage Blob Data Reader</b> on container <code>bronze</code> and <b>Storage Blob Data Contributor</b> on container <code>silver</code>; no account-wide role." },
      { id: "R9.3", text: "A notebook named <code>nb_sessions</code> that reads the clickstream with <code>read_files(…)</code> over an <code>abfss://</code> path and writes with <code>INSERT OVERWRITE DIRECTORY</code>." },
      { id: "R9.4", text: "Output directory <code>silver/sessions/</code> containing one <code>part-*.csv</code> and <code>_SUCCESS</code>; header <code>session_id,customer_id,first_event_ts,last_event_ts,events,purchased</code>; one row per session from all files in <code>bronze/shopstream/events/</code>. <code>customer_id</code> = the largest non-null customer id seen in the session; <code>purchased</code> = 1 if any event is a purchase, else 0." },
    ],
    hints: { "R9.2": "Storage account → Access control (IAM) → scope: Container: bronze → Reader; then Container: silver → Contributor. The member is the workspace (managed identity).", "R9.4": "SELECT session_id, max(customer_id) AS customer_id, min(ts) AS first_event_ts, max(ts) AS last_event_ts, count(*) AS events, CASE WHEN count_if(event_type = 'purchase') > 0 THEN 1 ELSE 0 END AS purchased FROM … GROUP BY session_id" },
    azure: () => `
<h3>Portal path</h3>${steps(["Home → <b>Azure Databricks</b> → Create → Premium tier → Review + create → <b>Launch workspace</b>.", "Create an <b>Access Connector for Azure Databricks</b> (Home → search it) and give its managed identity the storage roles (container scope).", "Workspace → <b>Catalog</b> → External data → <b>Credentials</b> → Create (the access connector) → <b>External locations</b> → Create for <code>abfss://silver@…/</code> and <code>abfss://bronze@…/</code>.", "Workspace → New → <b>Notebook</b> → default language SQL → attach to a cluster or serverless compute → run cells."])}
<h3>Notebook SQL (Databricks)</h3>${code("sql", `CREATE OR REPLACE TEMP VIEW events AS
SELECT * FROM read_files('abfss://bronze@stde101<you>.dfs.core.windows.net/shopstream/events/', format => 'json');

INSERT OVERWRITE DIRECTORY 'abfss://silver@stde101<you>.dfs.core.windows.net/sessions'
USING CSV OPTIONS ('header' = 'true')
SELECT …;   -- your aggregation`)}
<h3>Gotchas in real Azure</h3>${gotchas(["Classic clusters bill VMs plus DBUs while running: set auto-termination (for example 20 minutes).", "<code>abfss://</code> requires hierarchical namespace; on a flat blob account use <code>wasbs://</code> (legacy) and lose directory semantics.", "Unity Catalog external locations are required for SQL warehouses; direct account keys in notebooks are an anti-pattern.", "In production, write Delta (<code>CREATE TABLE … USING DELTA</code> / <code>MERGE INTO</code>) instead of CSV."])}`,
    tests: [
      { req: "R9.1", name: "workspace dbw-de101-dev", pts: 1, run: () => [!!G.ws(), G.ws() ? "found" : "not found in " + RG] },
      { req: "R9.2", name: "Reader on bronze, Contributor on silver, nothing account-wide", pts: 2, run: () => { const w = G.ws(), a = G.acct(); if (!w || !a) return [false, "workspace or storage missing"]; const mine = S.state.roles.filter((r) => r.principal === w.name); const acctWide = mine.filter((r) => r.scope === S.armId(a)); const b = mine.find((r) => r.scope === S.containerScope(a.name, "bronze") && r.role === "Storage Blob Data Reader"); const s = mine.find((r) => r.scope === S.containerScope(a.name, "silver") && r.role === "Storage Blob Data Contributor"); return [!!b && !!s && !acctWide.length, `bronze reader ${!!b}, silver contributor ${!!s}, account-wide ${acctWide.length}`]; } },
      { req: "R9.3", name: "nb_sessions uses read_files and INSERT OVERWRITE DIRECTORY", pts: 1, run: () => { const w = G.ws(); const nb = w && (S.state.notebooks[w.name] || []).find((n) => n.name === "nb_sessions"); const src = nb ? nb.cells.map((c) => c.src).join("\n") : ""; return [!!nb && /read_files\s*\(\s*'abfss:\/\//i.test(src) && /INSERT\s+OVERWRITE\s+DIRECTORY/i.test(src), nb ? "cells checked" : "notebook not found"]; } },
      { req: "R9.4", name: "silver/sessions output correct", pts: 7, run: () => { const a = G.acct(); const c = a && S.container(a.name, "silver"); if (!c) return [false, "no silver container"]; const files = Object.keys(c.files).filter((p) => p.startsWith("sessions/")); const parts = files.filter((p) => /\/part-[^/]+\.csv$/.test(p)); if (parts.length !== 1 || !files.includes("sessions/_SUCCESS")) return [false, `found ${files.join(", ") || "nothing"}`]; const p = N.parseCSV(c.files[parts[0]].content); if (p.columns.join(",") !== "session_id,customer_id,first_event_ts,last_event_ts,events,purchased") return [false, "header " + p.columns.join(",")]; const exp = p9Expected(); const got = Object.fromEntries(p.rows.map((r) => [r.session_id, r])); const norm = (t) => String(t).replace("T", " ").replace("Z", "").slice(0, 19); const bad = exp.filter((e) => { const g = got[e.session_id]; return !g || String(g.customer_id || "") !== String(e.customer_id ?? "") || norm(g.first_event_ts) !== norm(e.first) || norm(g.last_event_ts) !== norm(e.last) || +g.events !== e.events || +g.purchased !== e.purchased; }); return [!bad.length && p.rows.length === exp.length, bad.length ? `${bad.length}/${exp.length} sessions wrong, e.g. ${bad[0].session_id}: expected ${JSON.stringify(bad[0])}, got ${JSON.stringify(got[bad[0].session_id])}` : `${exp.length} sessions correct`]; } },
    ],
  });

  /* ---------- P10 ---------- */
  const DRILLS = [
    { id: "d1", title: "Drill 1: 03:12, pl_ingest_orders failed", alert: "Sev 2 · pl_ingest_orders failed on the nightly schedule. On-call: you.", causes: ["Network: SQL firewall", "Authorization: storage RBAC", "Bad deployment", "Source data format"], answer: 1,
      break: () => { const f = G.fac(); S.state.roles = S.state.roles.filter((r) => !(r.principal === f.name && S.ROLE_DEFS[r.role].plane === "data")); S.changed("iam"); }, },
    { id: "d2", title: "Drill 2: Copy can't reach the database", alert: "Sev 2 · pl_ingest_orders failed. A change ticket mentions 'tightened SQL network settings'.", causes: ["Network: SQL firewall", "Authorization: storage RBAC", "Bad deployment", "Expired password"], answer: 0,
      break: () => { const s = G.server(); s.props.firewall = (s.props.firewall || []).filter((f) => !(f.start === "0.0.0.0" && f.end === "0.0.0.0")); S.changed("resource"); }, },
    { id: "d3", title: "Drill 3: green run, empty table", alert: "Sev 1 · Finance dashboard shows zero orders. pl_ingest_orders reports Succeeded.", causes: ["Network: SQL firewall", "Authorization: storage RBAC", "Bad deployment: published pipeline differs from the reviewed one", "Event Grid outage"], answer: 2,
      break: () => { const f = G.facObj(); const p = f.published.pipelines.find((x) => x.name === "pl_ingest_orders"); const c = p.activities.find((a) => a.type === "Copy"); c.source.wildcardFolderPath = "shopstream/order"; S.changed("pipeline"); }, },
  ];
  U.push({
    id: "p10", code: "P10", title: "Operations: incident response drills", weeks: "Week 10", minutes: 90,
    lecture: `
<h3>1. Triage by layer</h3>
<p>When a pipeline breaks, classify before you fix: <b>network</b> (firewall, private endpoint, DNS), <b>authentication</b> (who are you?), <b>authorization</b> (RBAC, database roles), <b>configuration</b> (what was deployed), <b>data</b> (format, schema drift, volume), <b>platform</b> (service incident). The error message almost always names the layer, if you read it.</p>
<h3>2. Evidence first</h3>
<p>Monitor → failed run → failed activity → <b>Error</b> (code and message) and <b>Input</b> (the resolved JSON that actually ran). Compare Input with what you <i>think</i> is deployed. Check the <b>Activity log</b> for recent changes: a role removed, a firewall rule deleted, a publish.</p>
<h3>3. Silent failures</h3>
<p>The worst incidents are green runs with wrong data. A Copy that matches zero files succeeds and, with a TRUNCATE pre-copy script, empties the table. Defend with row-count checks (Lookup + If + Fail), freshness alerts and data tests.</p>
<h3>4. Change management</h3>
<p>Production factories deploy from Git through CI/CD; nobody edits live. The published version must equal the reviewed version. If Publish all shows unexpected changes, stop and diff.</p>
<h3>5. Postmortems</h3>
<p>Blameless: timeline, impact, root cause, detection gap, follow-up actions (a test or alert that would have caught it).</p>`,
    quiz: [
      { q: "A run fails with 'Login failed for user <token-identified principal>'. Which layer?", a: ["Network", "Authentication / database user mapping", "Storage RBAC", "Data format"], c: 1, why: "The connection reached the server; the identity couldn't log in to the database." },
      { q: "A pipeline 'succeeded' but loaded 0 rows. Best first evidence?", a: ["Restart the IR", "The Copy activity's Input and Output (resolved paths, filesRead, rowsCopied)", "Re-run immediately", "Increase DIUs"], c: 1, why: "Input shows what really ran; Output shows filesRead/rowsCopied." },
      { q: "Which control prevents 'someone published an untested change'?", a: ["Larger DIUs", "Git integration with pull requests and CI/CD deployment", "More triggers", "Data flow debug"], c: 1, why: "Reviewed changes flow through Git and automated deployment, not live edits." },
    ],
    spec: [
      { id: "R10.1", text: "Prerequisite: P4 passes (pl_ingest_orders published and working)." },
      { id: "R10.2", text: "Drill 1: start it, diagnose from Monitor and the Activity log, restore service, choose the root-cause layer, then submit. The grader re-runs the pipeline." },
      { id: "R10.3", text: "Drill 2: same procedure." },
      { id: "R10.4", text: "Drill 3: same procedure. Hint: green is not the same as correct." },
    ],
    hints: { "R10.2": "Activity log (left menu) lists every change with a timestamp.", "R10.4": "Compare the failed run's Copy Input with your draft pipeline. Publish all shows what differs." },
    azure: () => `
<h3>Where these tools live in Azure</h3>${steps(["Data factory → Studio → <b>Monitor</b>: pipeline runs, activity Input/Output/Error, rerun from failed activity.", "Any resource → <b>Activity log</b>: who changed what, when (control-plane operations, kept 90 days).", "Data factory → <b>Diagnostic settings</b> → send PipelineRuns/ActivityRuns to a Log Analytics workspace; query with KQL.", "Data factory → <b>Alerts</b> → New alert rule → signal <i>Failed pipeline runs metrics</i> → action group (email, Teams, PagerDuty)."])}
<h3>KQL for failed runs</h3>${code("kusto", `ADFActivityRun
| where Status == "Failed" and TimeGenerated > ago(1d)
| project TimeGenerated, PipelineName, ActivityName, ErrorCode, ErrorMessage
| order by TimeGenerated desc`)}
<h3>Gotchas in real Azure</h3>${gotchas(["The Activity log records control-plane changes only. Data-plane access (who read a blob) needs storage diagnostic logs.", "'Rerun from failed activity' reuses the original parameters; fix the cause first.", "Alerts on 'Succeeded with 0 rows' need your own metric: log row counts from Copy output to a table and alert on it."])}`,
    drills: DRILLS,
    tests: DRILLS.map((d, i) => ({ req: `R10.${i + 2}`, name: d.title, pts: 4, drill: d.id, run: async () => {
      const st = (S.state.course.p10 || {}).drills || {};
      const x = st[d.id];
      if (!x || !x.started) return [false, "drill not started"];
      if (x.cause === undefined) return [false, "choose a root cause and submit"];
      const run = await G.run("pl_ingest_orders");
      const n = G.exists("stg_orders") ? G.one("SELECT COUNT(*) FROM stg_orders") : 0;
      const fixed = run.status === "Succeeded" && n === ref().orders.length;
      const rca = x.cause === d.answer;
      return [fixed && rca, `service ${fixed ? "restored" : "still broken: " + (run.error ? run.error.slice(0, 200) : `rows=${n}`)}; root cause ${rca ? "correct" : "incorrect"}`];
    } })),
  });

  /* ======================= state helpers ======================= */
  const st = (id) => (S.state.course[id] = S.state.course[id] || { attempts: 0, best: null, last: null, quiz: null, hints: [] });
  N.course.units = U;
  N.course.unit = (id) => U.find((u) => u.id === id);
  N.course.state = st;
  N.course.total = (u) => u.tests.reduce((s, t) => s + t.pts, 0);
  N.course.best = (id) => (S.state.course[id] || {}).best ?? null;
  N.course.active = () => { let id = null; try { id = localStorage.getItem("nimbus-active-unit"); } catch (e) {} return U.find((u) => u.id === id) || null; };
  N.course.setActive = (id) => { try { id ? localStorage.setItem("nimbus-active-unit", id) : localStorage.removeItem("nimbus-active-unit"); } catch (e) {} };
  N.course.p3Setup = P3_SETUP;
  N.course.grading = false;

  N.course.grade = async (unitId, onLog) => {
    const u = N.course.unit(unitId);
    const s = st(unitId);
    if (N.course.grading) throw new Error("A grading run is already in progress.");
    N.course.grading = true;
    const results = [];
    try {
      if (!S.realStrict()) { onLog({ type: "fatal", msg: "Realism is set to Guided. The autograder only accepts work done in Strict mode (Settings → Realism)." }); return null; }
      for (const t of u.tests) {
        onLog({ type: "start", t });
        let pass = false, msg = "";
        try { const r = await t.run(); pass = !!r[0]; msg = r[1] || ""; }
        catch (e) { pass = false; msg = "error: " + (e.message || e).toString().split("\n")[0].slice(0, 300); }
        results.push({ id: t.name, req: t.req, pts: t.pts, pass, msg });
        onLog({ type: "result", t, pass, msg });
      }
      const raw = results.reduce((x, r) => x + (r.pass ? r.pts : 0), 0);
      const penalty = (s.hints || []).length;
      const score = Math.max(0, raw - penalty);
      s.attempts++;
      s.last = { t: Date.now(), raw, penalty, score, total: N.course.total(u), results };
      s.best = Math.max(s.best ?? 0, score);
      S.log(`Autograder ${u.code}`, `${score}/${N.course.total(u)}`, score === N.course.total(u) ? "Succeeded" : "Failed");
      S.changed("course");
      return s.last;
    } finally { N.course.grading = false; }
  };
})(window.N);
