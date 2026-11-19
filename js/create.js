/* Nimbus Portal — "Create a resource" with the same tabs, defaults and naming rules as the Azure portal */
(function (N) {
  const S = N.store, esc = N.esc, I = N.icon;
  const J = (o) => esc(JSON.stringify(o));

  const INFO = {
    rg: "A container that holds related resources for an Azure solution.",
    storage: "Durable, scalable cloud storage. With hierarchical namespace on, it is Azure Data Lake Storage Gen2.",
    sqldb: "Managed relational database on a logical SQL server. T-SQL, firewall rules and Microsoft Entra users.",
    factory: "Serverless data integration: pipelines, data flows, triggers and monitoring in ADF Studio.",
    workspace: "Notebooks with Spark SQL over your lake (Databricks-style).",
  };
  const TABS = {
    rg: ["basics", "tags", "review"],
    storage: ["basics", "advanced", "networking", "dataprotection", "encryption", "tags", "review"],
    sqldb: ["basics", "networking", "security", "additional", "tags", "review"],
    factory: ["basics", "git", "networking", "advanced", "tags", "review"],
    workspace: ["basics", "networking", "tags", "review"],
  };
  const TAB_LABEL = { basics: "Basics", advanced: "Advanced", networking: "Networking", dataprotection: "Data protection", encryption: "Encryption", tags: "Tags", review: "Review + create", security: "Security", additional: "Additional settings", git: "Git configuration" };

  N.views.create = (r) => {
    if (r.type) return form(r);
    return {
      crumbs: [{ label: "Create a resource", route: { view: "create" } }],
      html: `<div class="blade"><div class="blade-head"><h1>Create a resource</h1><p class="muted">Marketplace. Forms, defaults and name rules follow the Azure portal, so what you practise here is what you will click there.</p></div>
        <div class="market">${["rg", "storage", "sqldb", "factory", "workspace"].map((t) => `<button class="mk-card" data-go='${J({ view: "create", type: t })}'>${N.tile(t, "tile-lg")}<div><b>${esc(t === "storage" ? "Storage account" : t === "sqldb" ? "SQL Database" : N.typeMeta[t].label)}</b><p>${esc(INFO[t])}</p><small>Microsoft · Azure Service</small><span class="mk-cta">Create</span></div></button>`).join("")}</div></div>`,
    };
  };

  const defaults = () => ({
    rg: (S.state.rgs[0] || {}).name || "", newRg: "", name: "", region: "South Africa North", tags: [{ k: "", v: "" }],
    performance: "Standard", redundancy: "Standard_RAGRS", hns: false, secureTransfer: true, allowBlobPublic: false, allowSharedKey: true, minTls: "TLS1_2", accessTier: "Hot", network: "all", blobSoftDelete: true, containerSoftDelete: true, versioning: false,
    server: "", srvName: "", srvAuth: "entra", srvAdmin: "", srvPassword: "", workload: "Development", compute: "GP_S_Gen5_1", backup: "Geo", connectivity: "none", allowAzure: false, clientIp: false, collation: "SQL_Latin1_General_CP1_CI_AS", sample: "none", defender: "later",
    git: "later", adfPublic: true, wsTier: "premium", noPublicIp: true,
  });

  const RESERVED_LOGINS = ["admin", "administrator", "sa", "root", "dbmanager", "loginmanager", "dbo", "guest", "public"];
  function validate(t, f) {
    const e = {};
    const name = f.name || "";
    if (t === "rg") {
      if (!/^[-\w.()]{1,90}$/.test(name) || /\.$/.test(name)) e.name = "Resource group names: 1–90 letters, digits, underscores, hyphens, periods and parentheses; can't end with a period.";
      else if (S.state.rgs.some((g) => g.name.toLowerCase() === name.toLowerCase())) e.name = `A resource group with the same name already exists in the selected subscription.`;
    }
    if (t === "storage") {
      if (!/^[a-z0-9]{3,24}$/.test(name)) e.name = "The name must be between 3 and 24 characters, and can only contain lowercase letters and numbers.";
      else if (S.GLOBAL_TAKEN.includes(name) || S.nameTaken("storage", name)) e.name = `The storage account named ${name} is already taken.`;
    }
    if (t === "sqldb") {
      if (!name || name.length > 128 || /[<>*%&:\\/?]/.test(name) || /[. ]$/.test(name)) e.name = "Database names cannot be empty, longer than 128 characters, end with '.' or a space, or contain <>*%&:\\/?";
      else if (f.server && f.server !== "__new" && S.state.resources.some((r) => r.type === "sqldb" && r.props.server === f.server && r.name.toLowerCase() === name.toLowerCase())) e.name = "A database with this name already exists on the server.";
      if (!f.server) e.server = "Select a server or create a new one.";
      if (f.server === "__new") {
        if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(f.srvName || "")) e.srvName = "Server names: lowercase letters, numbers and '-', 1–63 characters, can't start or end with '-'.";
        else if (S.GLOBAL_TAKEN.includes(f.srvName) || S.nameTaken("sqlserver", f.srvName)) e.srvName = "This server name is already taken (server names form the DNS name <name>.database.windows.net).";
        if (f.srvAuth !== "entra") {
          if (!/^[A-Za-z][\w]{0,127}$/.test(f.srvAdmin || "") || RESERVED_LOGINS.includes((f.srvAdmin || "").toLowerCase())) e.srvAdmin = "Login can't be a reserved name (admin, administrator, sa, root, dbo…), must start with a letter, and use letters, digits or underscores.";
          const pw = f.srvPassword || "", cats = [/[a-z]/, /[A-Z]/, /\d/, /[^\w\s]/].filter((r) => r.test(pw)).length;
          if (pw.length < 8 || pw.length > 128 || cats < 3) e.srvPassword = "Passwords need 8–128 characters from three of: uppercase, lowercase, digits, symbols.";
          else if (f.srvAdmin && pw.toLowerCase().includes(f.srvAdmin.toLowerCase())) e.srvPassword = "The password can't contain the login name.";
        }
      }
    }
    if (t === "factory") {
      if (!/^[A-Za-z0-9](?:[A-Za-z0-9]|-(?!-)){1,61}[A-Za-z0-9]$/.test(name)) e.name = "Data factory names: 3–63 letters, numbers and hyphens; start and end with a letter or number; no consecutive hyphens.";
      else if (S.GLOBAL_TAKEN.includes(name.toLowerCase()) || S.nameTaken("factory", name)) e.name = `Data factory name "${name}" is not available. Names are globally unique.`;
    }
    if (t === "workspace") {
      if (!/^[A-Za-z0-9_-]{3,64}$/.test(name)) e.name = "Workspace names: 3–64 letters, digits, hyphens and underscores.";
      else if (S.nameTaken("workspace", name)) e.name = "That workspace name is already used in this subscription.";
    }
    if (t !== "rg") {
      if (!f.rg) e.rg = "A resource group is required.";
      if (f.rg === "__new" && !/^[-\w.()]{1,90}$/.test(f.newRg || "")) e.rg = "Enter a valid name for the new resource group.";
    }
    const tagKeys = (f.tags || []).filter((x) => x.k);
    if (tagKeys.some((x) => /[<>%&\\?/]/.test(x.k))) e.tags = "Tag names can't contain <, >, %, &, \\, ? or /.";
    return e;
  }
  const tabOfField = { name: "basics", rg: "basics", server: "basics", srvName: "basics", srvAdmin: "basics", srvPassword: "basics", tags: "tags" };

  function form(r) {
    const t = r.type;
    const f = r.form || (r.form = defaults());
    const tabs = TABS[t];
    const tab = tabs.includes(r.tab) ? r.tab : "basics";
    if (r.step === "deploy") return deployView(r);
    const errs = validate(t, f);
    const shown = (k) => (r.touched || f[k]) && errs[k] ? `<small class="err">${esc(errs[k])}</small>` : "";
    const rgField = t === "rg" ? "" : `<div class="field"><label for="f-rg">Resource group <span class="req">*</span></label><select id="f-rg" data-f="rg" data-re="1"><option value="">Select a resource group</option>${S.state.rgs.map((g) => `<option ${f.rg === g.name ? "selected" : ""}>${esc(g.name)}</option>`).join("")}<option value="__new" ${f.rg === "__new" ? "selected" : ""}>Create new</option></select>${f.rg === "__new" ? `<input data-f="newRg" value="${esc(f.newRg)}" placeholder="New resource group name" aria-label="New resource group name">` : ""}${shown("rg")}</div>`;
    const region = (label = "Region") => `<div class="field"><label for="f-region">${label}</label><select id="f-region" data-f="region">${N.REGIONS.map((x) => `<option ${f.region === x ? "selected" : ""}>${x}</option>`).join("")}</select><small class="muted">CLI value: <code>${esc(N.regionCode(f.region))}</code></small></div>`;
    const project = `<h3 class="form-sec">Project details</h3><p class="muted">Select the subscription to manage deployed resources and costs. Use resource groups like folders to organise and manage all your resources.</p><div class="field"><label>Subscription <span class="req">*</span></label><select disabled><option>Free learning subscription</option></select></div>${rgField}`;
    let body = "";
    if (tab === "tags") body = `<p class="muted">Tags are name/value pairs that categorise resources and consolidate billing. Teams typically require <code>env</code>, <code>owner</code> and <code>costCenter</code>.</p><table class="list params"><thead><tr><th>Name</th><th>Value</th><th></th></tr></thead><tbody>${f.tags.map((x, i) => `<tr><td><input data-tag="${i}:k" value="${esc(x.k)}" placeholder="env" aria-label="Tag name"></td><td><input data-tag="${i}:v" value="${esc(x.v)}" placeholder="dev" aria-label="Tag value"></td><td><button class="icon-btn" data-deltag="${i}" aria-label="Remove tag">${I("trash")}</button></td></tr>`).join("")}</tbody></table><button class="btn btn-sm" id="addtag">${I("plus")} Add tag</button>${shown("tags")}`;
    if (tab === "review") {
      const errList = Object.entries(errs);
      body = errList.length ? `<div class="callout callout-error">${I("x")} <b>Validation failed.</b> Required information is missing or not valid.<ul>${errList.map(([k, v]) => `<li><button class="link" data-gotab="${tabOfField[k] || "basics"}">${esc(TAB_LABEL[tabOfField[k] || "basics"])}</button>: ${esc(v)}</li>`).join("")}</ul></div>`
        : `<div class="callout callout-ok">${I("check")} Validation passed</div>${t === "sqldb" ? `<div class="callout callout-warn">${I("info")} <b>Cost summary.</b> General Purpose serverless bills per vCore-second while active plus storage; it auto-pauses after 1 hour idle. Azure offers a free monthly allowance for one serverless database per subscription. This sandbox costs nothing.</div>` : ""}${summary(t, f)}`;
    }
    if (t === "rg" && tab === "basics") body = `${project}<h3 class="form-sec">Resource details</h3><div class="field"><label for="f-name">Resource group <span class="req">*</span></label><input id="f-name" data-f="name" value="${esc(f.name)}" placeholder="rg-de101-dev" autocomplete="off">${shown("name")}</div>${region()}<p class="muted">The region stores the group's metadata. Resources inside can live in other regions.</p>`;
    if (t === "storage") {
      if (tab === "basics") body = `${project}<h3 class="form-sec">Instance details</h3><div class="field"><label for="f-name">Storage account name <span class="req">*</span></label><input id="f-name" data-f="name" value="${esc(f.name)}" placeholder="stde101dev" autocomplete="off">${shown("name") || `<small class="muted">Globally unique: it becomes ${esc(f.name || "<name>")}.blob.core.windows.net and .dfs.core.windows.net.</small>`}</div>${region()}
        <div class="field"><label>Primary service</label><select disabled><option>Azure Blob Storage or Azure Data Lake Storage Gen 2</option></select></div>
        <div class="field"><label>Performance</label><div class="radios"><label><input type="radio" name="perf" value="Standard" ${f.performance === "Standard" ? "checked" : ""}> Standard: recommended for most scenarios (general-purpose v2 account)</label><label><input type="radio" name="perf" value="Premium" ${f.performance === "Premium" ? "checked" : ""}> Premium: for low-latency scenarios</label></div></div>
        <div class="field"><label for="f-red">Redundancy</label><select id="f-red" data-f="redundancy">${[["Standard_LRS", "Locally-redundant storage (LRS)"], ["Standard_GRS", "Geo-redundant storage (GRS)"], ["Standard_RAGRS", "Read-access geo-redundant storage (RA-GRS)"], ["Standard_ZRS", "Zone-redundant storage (ZRS)"]].map(([v, l]) => `<option value="${v}" ${f.redundancy === v ? "selected" : ""}>${l}</option>`).join("")}</select><small class="muted">The portal defaults to RA-GRS (six copies across two regions). Dev/test lakes usually pick LRS (three copies in one datacenter), the cheapest.</small></div>`;
      if (tab === "advanced") body = `<h3 class="form-sec">Security</h3>
        <div class="field"><label class="check"><input type="checkbox" data-f="secureTransfer" ${f.secureTransfer ? "checked" : ""}> Require secure transfer for REST API operations</label></div>
        <div class="field"><label class="check"><input type="checkbox" data-f="allowBlobPublic" ${f.allowBlobPublic ? "checked" : ""}> Allow enabling anonymous access on individual containers</label><small class="muted">Off by default. Leave it off: anonymous blob access is a common source of data leaks.</small></div>
        <div class="field"><label class="check"><input type="checkbox" data-f="allowSharedKey" ${f.allowSharedKey ? "checked" : ""}> Enable storage account key access</label><small class="muted">Turning this off forces Microsoft Entra ID (RBAC) for every caller.</small></div>
        <div class="field"><label for="f-tls">Minimum TLS version</label><select id="f-tls" data-f="minTls">${["TLS1_0", "TLS1_1", "TLS1_2"].map((v) => `<option value="${v}" ${f.minTls === v ? "selected" : ""}>Version ${v.slice(3).replace("_", ".")}</option>`).join("")}</select></div>
        <h3 class="form-sec">Hierarchical Namespace</h3><p class="muted">Hierarchical namespace, complemented by Data Lake Storage Gen2 endpoint, enables file and directory semantics, accelerates big data analytics workloads, and enables access control lists (ACLs).</p>
        <div class="field"><label class="check"><input type="checkbox" data-f="hns" ${f.hns ? "checked" : ""}> Enable hierarchical namespace</label><small class="muted">Off by default, and easy to miss. You need it for a data lake.</small></div>
        <h3 class="form-sec">Blob storage</h3><div class="field"><label>Access tier</label><div class="radios"><label><input type="radio" name="tier" value="Hot" ${f.accessTier === "Hot" ? "checked" : ""}> Hot: frequently accessed data</label><label><input type="radio" name="tier" value="Cool" ${f.accessTier === "Cool" ? "checked" : ""}> Cool: infrequently accessed data</label></div></div>`;
      if (tab === "networking") body = `<h3 class="form-sec">Network connectivity</h3><div class="field"><label>Network access</label><div class="radios col"><label><input type="radio" name="net" value="all" ${f.network === "all" ? "checked" : ""}> Enable public access from all networks</label><label><input type="radio" name="net" value="selected" ${f.network === "selected" ? "checked" : ""}> Enable public access from selected virtual networks and IP addresses</label><label><input type="radio" name="net" value="disabled" ${f.network === "disabled" ? "checked" : ""}> Disable public access and use private access</label></div><small class="muted">Nimbus doesn't simulate virtual networks; only the first option is modelled. Production lakes usually use private endpoints.</small></div><div class="field"><label>Routing preference</label><select disabled><option>Microsoft network routing</option></select></div>`;
      if (tab === "dataprotection") body = `<h3 class="form-sec">Recovery</h3><div class="field"><label class="check"><input type="checkbox" data-f="blobSoftDelete" ${f.blobSoftDelete ? "checked" : ""}> Enable soft delete for blobs (7 days)</label></div><div class="field"><label class="check"><input type="checkbox" data-f="containerSoftDelete" ${f.containerSoftDelete ? "checked" : ""}> Enable soft delete for containers (7 days)</label></div><h3 class="form-sec">Tracking</h3><div class="field"><label class="check"><input type="checkbox" data-f="versioning" ${f.versioning ? "checked" : ""} disabled> Enable versioning for blobs</label><small class="muted">Blob versioning isn't supported on accounts with hierarchical namespace.</small></div>`;
      if (tab === "encryption") body = `<div class="field"><label>Encryption type</label><div class="radios col"><label><input type="radio" checked disabled> Microsoft-managed keys (MMK)</label><label><input type="radio" disabled> Customer-managed keys (CMK)</label></div><small class="muted">Data at rest is always encrypted (AES-256).</small></div>`;
    }
    if (t === "sqldb") {
      const servers = S.resOfType("sqlserver");
      if (tab === "basics") body = `${project}<h3 class="form-sec">Database details</h3>
        <div class="field"><label for="f-name">Database name <span class="req">*</span></label><input id="f-name" data-f="name" value="${esc(f.name)}" placeholder="sqldb-de101" autocomplete="off">${shown("name")}</div>
        <div class="field"><label for="f-srv">Server <span class="req">*</span></label><select id="f-srv" data-f="server" data-re="1"><option value="">Select a server</option>${servers.map((x) => `<option value="${esc(x.name)}" ${f.server === x.name ? "selected" : ""}>${esc(x.name)} (${esc(x.region)})</option>`).join("")}<option value="__new" ${f.server === "__new" ? "selected" : ""}>Create new</option></select>${shown("server")}<small class="muted">A database lives on a logical server. The server holds logins, firewall rules and the Microsoft Entra admin.</small></div>
        ${f.server === "__new" ? `<div class="subform"><b>New server</b>
          <div class="field"><label>Server name <span class="req">*</span></label><input data-f="srvName" value="${esc(f.srvName)}" placeholder="sql-de101-dev-yourname" autocomplete="off"><small class="muted">.database.windows.net</small>${shown("srvName")}</div>
          ${region("Location")}
          <div class="field"><label>Authentication method</label><div class="radios col">${[["entra", "Use Microsoft Entra-only authentication"], ["both", "Use both SQL and Microsoft Entra authentication"], ["sql", "Use SQL authentication"]].map(([v, l]) => `<label><input type="radio" name="sauth" value="${v}" ${f.srvAuth === v ? "checked" : ""}> ${l}</label>`).join("")}</div></div>
          ${f.srvAuth !== "sql" ? `<div class="field"><label>Set Microsoft Entra admin</label><input value="learner@nimbuslearn.onmicrosoft.com" disabled><small class="muted">You. Only an Entra admin can create users for managed identities.</small></div>` : ""}
          ${f.srvAuth !== "entra" ? `<div class="field"><label>Server admin login <span class="req">*</span></label><input data-f="srvAdmin" value="${esc(f.srvAdmin)}" autocomplete="off">${shown("srvAdmin")}</div><div class="field"><label>Password <span class="req">*</span></label><input type="password" data-f="srvPassword" value="${esc(f.srvPassword)}" autocomplete="new-password">${shown("srvPassword")}</div>` : ""}
        </div>` : ""}
        <div class="field"><label>Want to use SQL elastic pool?</label><div class="radios"><label><input type="radio" checked disabled> No</label><label><input type="radio" disabled> Yes</label></div></div>
        <div class="field"><label>Workload environment</label><div class="radios"><label><input type="radio" name="wl" value="Development" ${f.workload === "Development" ? "checked" : ""}> Development</label><label><input type="radio" name="wl" value="Production" ${f.workload === "Production" ? "checked" : ""}> Production</label></div></div>
        <div class="field"><label for="f-cmp">Compute + storage</label><select id="f-cmp" data-f="compute">${[["GP_S_Gen5_1", "General Purpose - Serverless: Standard-series (Gen5), 1 vCore, 32 GB storage, auto-pause 1 hour"], ["GP_Gen5_2", "General Purpose - Provisioned: Standard-series (Gen5), 2 vCores, 32 GB"], ["Basic", "Basic (DTU): 5 DTUs, 2 GB"]].map(([v, l]) => `<option value="${v}" ${f.compute === v ? "selected" : ""}>${esc(l)}</option>`).join("")}</select></div>
        <div class="field"><label>Backup storage redundancy</label><div class="radios col">${[["Local", "Locally-redundant backup storage"], ["Zone", "Zone-redundant backup storage"], ["Geo", "Geo-redundant backup storage"]].map(([v, l]) => `<label><input type="radio" name="bk" value="${v}" ${f.backup === v ? "checked" : ""}> ${l}</label>`).join("")}</div></div>`;
      if (tab === "networking") body = `<h3 class="form-sec">Network connectivity</h3><p class="muted">Choose an option for configuring connectivity to your server via public endpoint or private endpoint. Choosing no access creates with defaults and you can configure connection method after server creation.</p>
        ${f.server && f.server !== "__new" ? `<div class="callout callout-warn">${I("info")} You picked an existing server; its networking is configured on the server. These settings are ignored.</div>` : ""}
        <div class="field"><label>Connectivity method</label><div class="radios col">${[["none", "No access"], ["public", "Public endpoint"], ["private", "Private endpoint"]].map(([v, l]) => `<label><input type="radio" name="conn" value="${v}" ${f.connectivity === v ? "checked" : ""} ${v === "private" ? "disabled" : ""}> ${l}</label>`).join("")}</div><small class="muted">"No access" is the default, and it blocks everything, including you, until you change it.</small></div>
        ${f.connectivity === "public" ? `<h3 class="form-sec">Firewall rules</h3><div class="field"><label>Allow Azure services and resources to access this server</label><div class="radios"><label><input type="radio" name="aas" value="no" ${!f.allowAzure ? "checked" : ""}> No</label><label><input type="radio" name="aas" value="yes" ${f.allowAzure ? "checked" : ""}> Yes</label></div><small class="muted">Creates rule <code>AllowAllWindowsAzureIps</code> (0.0.0.0 – 0.0.0.0). Data Factory's Azure IR needs it unless you use private endpoints.</small></div>
          <div class="field"><label>Add current client IP address</label><div class="radios"><label><input type="radio" name="cip" value="no" ${!f.clientIp ? "checked" : ""}> No</label><label><input type="radio" name="cip" value="yes" ${f.clientIp ? "checked" : ""}> Yes</label></div><small class="muted">Your IP: <code>${esc(N.CLIENT_IP)}</code>. Needed for the portal query editor.</small></div>` : ""}
        <h3 class="form-sec">Connection policy</h3><div class="field"><select disabled><option>Default: uses Redirect inside Azure and Proxy outside</option></select></div><div class="field"><label>Minimum TLS version</label><select disabled><option>TLS 1.2</option></select></div>`;
      if (tab === "security") body = `<div class="field"><label>Enable Microsoft Defender for SQL</label><div class="radios"><label><input type="radio" checked> Not now</label><label><input type="radio" disabled> Start free trial</label></div></div><div class="field"><label>Ledger</label><input value="Not configured" disabled></div><div class="field"><label>Server identity</label><input value="Not configured" disabled></div><div class="field"><label>Transparent data encryption</label><input value="Service-managed key" disabled></div>`;
      if (tab === "additional") body = `<div class="field"><label>Use existing data</label><div class="radios"><label><input type="radio" name="smp" value="none" ${f.sample === "none" ? "checked" : ""}> None</label><label><input type="radio" disabled> Backup</label><label><input type="radio" disabled> Sample (AdventureWorksLT)</label></div></div><div class="field"><label>Collation</label><input value="${esc(f.collation)}" disabled><small class="muted">Case-insensitive, accent-sensitive: <code>'abc' = 'ABC'</code> is true in Azure SQL. (SQLite under Nimbus compares text case-sensitively; keep this in mind.)</small></div><div class="field"><label>Maintenance window</label><select disabled><option>System default (5pm to 8am)</option></select></div>`;
    }
    if (t === "factory") {
      if (tab === "basics") body = `${project}<h3 class="form-sec">Instance details</h3><div class="field"><label for="f-name">Name <span class="req">*</span></label><input id="f-name" data-f="name" value="${esc(f.name)}" placeholder="adf-de101-dev-yourname" autocomplete="off">${shown("name") || `<small class="muted">Globally unique.</small>`}</div>${region()}<div class="field"><label>Version</label><select disabled><option>V2</option></select></div>`;
      if (tab === "git") body = `<div class="field"><label class="check"><input type="checkbox" checked disabled> Configure Git later</label></div><p class="muted">Git integration (Azure DevOps or GitHub) gives you branches, pull requests and CI/CD. Without it the factory runs in <b>live mode</b>: Publish all saves straight to the service.</p>`;
      if (tab === "networking") body = `<div class="field"><label class="check"><input type="checkbox" disabled> Enable managed virtual network on the default AutoResolveIntegrationRuntime</label></div><div class="field"><label>Connectivity method</label><div class="radios"><label><input type="radio" checked disabled> Public endpoint</label><label><input type="radio" disabled> Private endpoint</label></div></div>`;
      if (tab === "advanced") body = `<div class="field"><label class="check"><input type="checkbox" disabled> Enable encryption using a customer managed key</label></div><p class="muted">A system-assigned managed identity is created with the factory automatically.</p>`;
    }
    if (t === "workspace") {
      if (tab === "basics") body = `${project}<h3 class="form-sec">Instance details</h3><div class="field"><label for="f-name">Workspace name <span class="req">*</span></label><input id="f-name" data-f="name" value="${esc(f.name)}" placeholder="dbw-de101-dev" autocomplete="off">${shown("name")}</div>${region()}<div class="field"><label>Pricing tier</label><select data-f="wsTier">${[["premium", "Premium (+ Role-based access controls)"], ["standard", "Standard (Apache Spark, Secure with Microsoft Entra ID)"], ["trial", "Trial (Premium - 14-Days Free DBUs)"]].map(([v, l]) => `<option value="${v}" ${f.wsTier === v ? "selected" : ""}>${l}</option>`).join("")}</select><small class="muted">Unity Catalog needs Premium.</small></div><div class="field"><label>Managed Resource Group name</label><input value="(generated) databricks-rg-${esc(f.name || "workspace")}" disabled><small class="muted">Azure Databricks creates a second, locked resource group for the cluster VMs.</small></div>`;
      if (tab === "networking") body = `<div class="field"><label>Deploy with Secure Cluster Connectivity (No Public IP)</label><div class="radios"><label><input type="radio" checked disabled> Yes</label><label><input type="radio" disabled> No</label></div></div><div class="field"><label>Deploy in your own Virtual Network (VNet)</label><div class="radios"><label><input type="radio" checked disabled> No</label><label><input type="radio" disabled> Yes</label></div></div>`;
    }
    return {
      crumbs: [{ label: "Create a resource", route: { view: "create" } }, { label: t === "storage" ? "Storage account" : N.typeMeta[t].label, route: r }],
      html: `<div class="blade"><div class="blade-head"><h1>${t === "rg" ? "Create a resource group" : t === "storage" ? "Create a storage account" : t === "sqldb" ? "Create SQL Database" : t === "factory" ? "Create Data Factory" : "Create an Azure Databricks workspace"}</h1></div>
        <div class="tabs">${tabs.map((x) => `<button class="tab ${x === tab ? "active" : ""}" data-tab="${x}">${TAB_LABEL[x]}</button>`).join("")}</div>
        <div class="form">${body}</div>
        <div class="form-foot">${tab === "review" ? `<button class="btn btn-primary" id="do-create" ${Object.keys(errs).length ? "disabled" : ""}>Create</button>` : `<button class="btn btn-primary" id="to-review">Review + create</button>`}<button class="btn" id="prev" ${tabs.indexOf(tab) === 0 ? "disabled" : ""}>&lt; Previous</button><button class="btn" id="next" ${tab === "review" ? "disabled" : ""}>Next: ${esc(TAB_LABEL[tabs[Math.min(tabs.length - 1, tabs.indexOf(tab) + 1)]])} &gt;</button></div></div>`,
      mount(root) {
        const go = (x) => { r.tab = x; N.rerender(); };
        root.querySelectorAll("[data-tab]").forEach((b) => (b.onclick = () => { if (b.dataset.tab === "review") r.touched = true; go(b.dataset.tab); }));
        root.querySelectorAll("[data-gotab]").forEach((b) => (b.onclick = () => go(b.dataset.gotab)));
        root.querySelector("#to-review") && (root.querySelector("#to-review").onclick = () => { r.touched = true; go("review"); });
        root.querySelector("#prev").onclick = () => go(tabs[Math.max(0, tabs.indexOf(tab) - 1)]);
        root.querySelector("#next").onclick = () => go(tabs[Math.min(tabs.length - 1, tabs.indexOf(tab) + 1)]);
        root.querySelectorAll("[data-f]").forEach((el) => el.addEventListener(el.tagName === "SELECT" || el.type === "checkbox" ? "change" : "input", () => { f[el.dataset.f] = el.type === "checkbox" ? el.checked : el.value; if (el.dataset.re) N.rerender(); }));
        const radio = (name, key, map = (v) => v) => root.querySelectorAll(`input[name=${name}]`).forEach((el) => el.addEventListener("change", () => { f[key] = map(el.value); N.rerender(); }));
        radio("perf", "performance"); radio("tier", "accessTier"); radio("net", "network"); radio("sauth", "srvAuth"); radio("wl", "workload"); radio("bk", "backup"); radio("conn", "connectivity"); radio("aas", "allowAzure", (v) => v === "yes"); radio("cip", "clientIp", (v) => v === "yes");
        root.querySelectorAll("[data-tag]").forEach((el) => el.addEventListener("input", () => { const [i, k] = el.dataset.tag.split(":"); f.tags[+i][k] = el.value; }));
        root.querySelectorAll("[data-deltag]").forEach((b) => (b.onclick = () => { f.tags.splice(+b.dataset.deltag, 1); if (!f.tags.length) f.tags.push({ k: "", v: "" }); N.rerender(); }));
        const at = root.querySelector("#addtag"); if (at) at.onclick = () => { f.tags.push({ k: "", v: "" }); N.rerender(); };
        const dc = root.querySelector("#do-create"); if (dc) dc.onclick = () => { r.step = "deploy"; r.deployStart = Date.now(); N.rerender(); deploy(r); };
      },
    };
  }

  function summary(t, f) {
    const tags = f.tags.filter((x) => x.k).map((x) => `${x.k} : ${x.v}`).join(", ") || "None";
    const rows = [["Subscription", "Free learning subscription"], t !== "rg" ? ["Resource group", f.rg === "__new" ? `(new) ${f.newRg}` : f.rg] : null, ["Region", f.region]];
    if (t === "rg") rows.push(["Name", f.name]);
    if (t === "storage") rows.push(["Storage account name", f.name], ["Performance", f.performance], ["Replication", f.redundancy.replace("Standard_", "")], ["Hierarchical namespace", f.hns ? "Enabled" : "Disabled"], ["Minimum TLS version", f.minTls.replace("TLS", "Version ").replace("_", ".")], ["Allow anonymous access", f.allowBlobPublic ? "Enabled" : "Disabled"], ["Storage account key access", f.allowSharedKey ? "Enabled" : "Disabled"], ["Access tier", f.accessTier]);
    if (t === "sqldb") rows.push(["Database name", f.name], ["Server", f.server === "__new" ? `(new) ${f.srvName}` : f.server], f.server === "__new" ? ["Authentication", { entra: "Microsoft Entra-only", both: "SQL and Microsoft Entra", sql: "SQL authentication" }[f.srvAuth]] : null, ["Compute + storage", f.compute], ["Backup storage redundancy", f.backup], f.server === "__new" ? ["Connectivity method", f.connectivity === "none" ? "No access" : "Public endpoint"] : null, f.server === "__new" && f.connectivity === "public" ? ["Allow Azure services", f.allowAzure ? "Yes" : "No"] : null, f.server === "__new" && f.connectivity === "public" ? ["Add client IP", f.clientIp ? "Yes" : "No"] : null);
    if (t === "factory") rows.push(["Name", f.name], ["Version", "V2"], ["Git configuration", "Configure later"]);
    if (t === "workspace") rows.push(["Workspace name", f.name], ["Pricing tier", f.wsTier]);
    rows.push(["Tags", tags]);
    return `<table class="kv">${rows.filter(Boolean).map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join("")}</table>`;
  }

  function deploy(r) {
    const f = r.form, t = r.type;
    const tags = Object.fromEntries(f.tags.filter((x) => x.k).map((x) => [x.k, x.v]));
    r.ops = [];
    setTimeout(() => {
      let rg = f.rg;
      if (t === "rg") { S.createRG(f.name, f.region); S.state.rgs.find((g) => g.name === f.name).tags = tags; r.ops.push(["Microsoft.Resources/resourceGroups", f.name]); }
      else {
        if (rg === "__new") { rg = f.newRg; S.createRG(rg, f.region); r.ops.push(["Microsoft.Resources/resourceGroups", rg]); }
        if (t === "storage") r.created = S.createResource("storage", f.name, rg, f.region, { tags, hns: f.hns, redundancy: f.redundancy, performance: f.performance, minTls: f.minTls, allowBlobPublic: f.allowBlobPublic, allowSharedKey: f.allowSharedKey, secureTransfer: f.secureTransfer, accessTier: f.accessTier, kind: "StorageV2" });
        if (t === "sqldb") {
          let server = f.server;
          if (server === "__new") {
            server = f.srvName;
            const fw = [];
            if (f.connectivity === "public" && f.allowAzure) fw.push({ name: "AllowAllWindowsAzureIps", start: "0.0.0.0", end: "0.0.0.0" });
            if (f.connectivity === "public" && f.clientIp) fw.push({ name: "ClientIPAddress_" + new Date().toISOString().slice(0, 10), start: N.CLIENT_IP, end: N.CLIENT_IP });
            S.createResource("sqlserver", server, rg, f.region, { tags, auth: f.srvAuth, admin: f.srvAdmin, entraAdmin: f.srvAuth === "sql" ? null : "learner@nimbuslearn.onmicrosoft.com", publicAccess: f.connectivity === "public" ? "selected" : "disabled", firewall: fw, minTls: "1.2" });
            r.ops.push(["Microsoft.Sql/servers", server]);
            if (fw.length) r.ops.push(["Microsoft.Sql/servers/firewallRules", fw.map((x) => x.name).join(", ")]);
          }
          r.created = S.createResource("sqldb", f.name, S.res("sqlserver", server).rg, S.res("sqlserver", server).region, { tags, server, compute: f.compute, backup: f.backup, collation: f.collation, users: {} });
        }
        if (t === "factory") r.created = S.createResource("factory", f.name, rg, f.region, { tags });
        if (t === "workspace") r.created = S.createResource("workspace", f.name, rg, f.region, { tags, tier: f.wsTier });
        r.ops.push([{ storage: "Microsoft.Storage/storageAccounts", sqldb: "Microsoft.Sql/servers/databases", factory: "Microsoft.DataFactory/factories", workspace: "Microsoft.Databricks/workspaces" }[t], f.name]);
      }
      r.done = true;
      S.notify("Deployment succeeded", `Deployment '${depName(r)}' to resource group '${t === "rg" ? f.name : rg}' was successful.`, "success");
      S.changed("resource");
      if (N.route() === r) N.rerender();
    }, t === "sqldb" ? 2600 : 1500);
  }
  const depName = (r) => ({ rg: "Microsoft.ResourceGroup", storage: "Microsoft.StorageAccount", sqldb: "Microsoft.SQLDatabase.newDatabaseNewServer", factory: "Microsoft.DataFactory", workspace: "Microsoft.Databricks" }[r.type] + "-" + new Date(r.deployStart).toISOString().replace(/\D/g, "").slice(0, 14));
  function deployView(r) {
    const f = r.form;
    return {
      crumbs: [{ label: "Create a resource", route: { view: "create" } }, { label: depName(r), route: r }],
      html: `<div class="blade"><div class="deploy">
        <div class="deploy-ic ${r.done ? "ok" : ""}">${r.done ? I("check") : `<span class="spin spin-lg"></span>`}</div>
        <div><h1>${r.done ? "Your deployment is complete" : "Deployment is in progress"}</h1>
        <table class="kv"><tr><th>Deployment name</th><td>${esc(depName(r))}</td></tr><tr><th>Subscription</th><td>Free learning subscription</td></tr><tr><th>Resource group</th><td>${esc(r.type === "rg" ? f.name : f.rg === "__new" ? f.newRg : f.rg)}</td></tr><tr><th>Start time</th><td>${N.fmtTime(r.deployStart)}</td></tr></table>
        ${r.done ? `<h3 class="form-sec">Deployment details</h3><table class="list"><thead><tr><th>Resource</th><th>Type</th><th>Status</th></tr></thead><tbody>${(r.ops || []).map(([ty, n]) => `<tr><td>${esc(n)}</td><td><code>${esc(ty)}</code></td><td>${N.statusPill("Succeeded")}</td></tr>`).join("")}</tbody></table>
          <div class="btn-row"><button class="btn btn-primary" data-go='${J(r.type === "rg" ? { view: "rg", name: f.name } : { view: "resource", id: r.created.id })}'>Go to resource</button><button class="btn" data-go='{"view":"create"}'>Create another resource</button></div>` : `<p class="muted">Azure Resource Manager turns your form into a template and deploys it.${r.type === "sqldb" ? " A new SQL server plus database usually takes 2–5 minutes in Azure." : ""}</p>`}</div>
      </div></div>`,
    };
  }

  /* ================= ARM JSON for any resource ================= */
  N.armJson = (res) => {
    const p = res.props, base = { id: S.armId(res), name: res.name, location: N.regionCode(res.region), tags: p.tags || {} };
    if (res.type === "storage") return { ...base, type: "Microsoft.Storage/storageAccounts", kind: "StorageV2", sku: { name: p.redundancy || "Standard_LRS", tier: p.performance || "Standard" }, properties: { isHnsEnabled: !!p.hns, minimumTlsVersion: p.minTls || "TLS1_2", allowBlobPublicAccess: !!p.allowBlobPublic, allowSharedKeyAccess: p.allowSharedKey !== false, supportsHttpsTrafficOnly: p.secureTransfer !== false, accessTier: p.accessTier || "Hot", primaryEndpoints: { blob: `https://${res.name}.blob.core.windows.net/`, dfs: `https://${res.name}.dfs.core.windows.net/` }, provisioningState: "Succeeded" } };
    if (res.type === "sqlserver") return { ...base, type: "Microsoft.Sql/servers", kind: "v12.0", properties: { fullyQualifiedDomainName: S.fqdn(res.name), version: "12.0", administratorLogin: p.auth === "entra" ? undefined : p.admin, administrators: p.entraAdmin ? { administratorType: "ActiveDirectory", principalType: "User", login: p.entraAdmin, azureADOnlyAuthentication: p.auth === "entra" } : undefined, publicNetworkAccess: p.publicAccess === "disabled" ? "Disabled" : "Enabled", minimalTlsVersion: "1.2", state: "Ready" }, firewallRules: (p.firewall || []).map((r) => ({ name: r.name, startIpAddress: r.start, endIpAddress: r.end })) };
    if (res.type === "sqldb") return { ...base, type: "Microsoft.Sql/servers/databases", kind: "v12.0,user,vcore,serverless", sku: { name: p.compute || "GP_S_Gen5_1", tier: (p.compute || "").startsWith("GP") ? "GeneralPurpose" : "Basic", family: "Gen5", capacity: 1 }, properties: { collation: p.collation || "SQL_Latin1_General_CP1_CI_AS", maxSizeBytes: 34359738368, status: "Online", autoPauseDelay: 60, requestedBackupStorageRedundancy: p.backup || "Geo", minCapacity: 0.5 } };
    if (res.type === "factory") return { ...base, type: "Microsoft.DataFactory/factories", identity: { type: "SystemAssigned", principalId: p.identity.principalId, tenantId: S.state.tenant }, properties: { provisioningState: "Succeeded", version: "2018-06-01", publicNetworkAccess: "Enabled" } };
    if (res.type === "workspace") return { ...base, type: "Microsoft.Databricks/workspaces", sku: { name: p.tier || "premium" }, properties: { managedResourceGroupId: `/subscriptions/${S.state.subscriptionId}/resourceGroups/databricks-rg-${res.name}`, workspaceUrl: `adb-${Math.abs(hash(res.name))}.${(hash(res.name) % 9) + 1}.azuredatabricks.net`, provisioningState: "Succeeded" } };
    return base;
  };
  const hash = (s) => [...String(s)].reduce((a, c) => (a * 31 + c.charCodeAt(0)) | 0, 7);

  /* ================= Bicep export ================= */
  N.bicep = (rgName) => {
    const rs = S.state.resources.filter((x) => x.rg === rgName);
    const sym = (n) => n.replace(/[^A-Za-z0-9]/g, "_").replace(/^(\d)/, "_$1");
    const tags = (t) => (Object.keys(t || {}).length ? `\n  tags: {\n${Object.entries(t).map(([k, v]) => `    ${/^\w+$/.test(k) ? k : `'${k}'`}: '${v}'`).join("\n")}\n  }` : "");
    const out = ["// Generated by Nimbus Portal from resource group " + rgName, "param location string = resourceGroup().location", ""];
    for (const r of rs.filter((x) => x.type === "storage")) {
      const p = r.props, s = sym(r.name);
      out.push(`resource ${s} 'Microsoft.Storage/storageAccounts@2023-01-01' = {\n  name: '${r.name}'\n  location: location\n  kind: 'StorageV2'\n  sku: {\n    name: '${p.redundancy || "Standard_LRS"}'\n  }${tags(p.tags)}\n  properties: {\n    isHnsEnabled: ${!!p.hns}\n    minimumTlsVersion: '${p.minTls || "TLS1_2"}'\n    allowBlobPublicAccess: ${!!p.allowBlobPublic}\n    allowSharedKeyAccess: ${p.allowSharedKey !== false}\n    supportsHttpsTrafficOnly: true\n    accessTier: '${p.accessTier || "Hot"}'\n  }\n}\n`);
      out.push(`resource ${s}_blob 'Microsoft.Storage/storageAccounts/blobServices@2023-01-01' = {\n  parent: ${s}\n  name: 'default'\n}\n`);
      Object.keys((S.state.lake[r.name] || { containers: {} }).containers).forEach((c) => out.push(`resource ${s}_${sym(c)} 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-01-01' = {\n  parent: ${s}_blob\n  name: '${c}'\n  properties: {\n    publicAccess: 'None'\n  }\n}\n`));
    }
    for (const r of rs.filter((x) => x.type === "sqlserver")) {
      const p = r.props, s = sym(r.name);
      out.push(`resource ${s} 'Microsoft.Sql/servers@2021-11-01' = {\n  name: '${r.name}'\n  location: location${tags(p.tags)}\n  properties: {\n    publicNetworkAccess: '${p.publicAccess === "disabled" ? "Disabled" : "Enabled"}'\n    minimalTlsVersion: '1.2'\n    administrators: {\n      administratorType: 'ActiveDirectory'\n      azureADOnlyAuthentication: ${p.auth === "entra"}\n      login: '${p.entraAdmin || "learner@nimbuslearn.onmicrosoft.com"}'\n      sid: '<object-id-of-your-user>'\n      tenantId: tenant().tenantId\n      principalType: 'User'\n    }\n  }\n}\n`);
      (p.firewall || []).forEach((fw) => out.push(`resource ${s}_${sym(fw.name)} 'Microsoft.Sql/servers/firewallRules@2021-11-01' = {\n  parent: ${s}\n  name: '${fw.name}'\n  properties: {\n    startIpAddress: '${fw.start}'\n    endIpAddress: '${fw.end}'\n  }\n}\n`));
    }
    for (const r of rs.filter((x) => x.type === "sqldb")) out.push(`resource ${sym(r.name)} 'Microsoft.Sql/servers/databases@2021-11-01' = {\n  parent: ${sym(r.props.server)}\n  name: '${r.name}'\n  location: location\n  sku: {\n    name: '${r.props.compute || "GP_S_Gen5_1"}'\n  }\n  properties: {\n    autoPauseDelay: 60\n    requestedBackupStorageRedundancy: '${r.props.backup || "Geo"}'\n  }\n}\n`);
    for (const r of rs.filter((x) => x.type === "factory")) out.push(`resource ${sym(r.name)} 'Microsoft.DataFactory/factories@2018-06-01' = {\n  name: '${r.name}'\n  location: location${tags(r.props.tags)}\n  identity: {\n    type: 'SystemAssigned'\n  }\n}\n`);
    for (const r of rs.filter((x) => x.type === "workspace")) out.push(`resource ${sym(r.name)} 'Microsoft.Databricks/workspaces@2023-02-01' = {\n  name: '${r.name}'\n  location: location\n  sku: {\n    name: '${r.props.tier || "premium"}'\n  }\n  properties: {\n    managedResourceGroupId: subscriptionResourceId('Microsoft.Resources/resourceGroups', 'databricks-rg-${r.name}')\n  }\n}\n`);
    const roles = S.state.roles.filter((a) => rs.some((r) => a.scope.includes(`/${r.name}`)));
    roles.forEach((a, i) => {
      const acct = rs.find((r) => r.type === "storage" && a.scope.includes(`/storageAccounts/${r.name}`));
      const prin = rs.find((r) => r.name === a.principal);
      if (!acct || !prin) return;
      const def = S.ROLE_DEFS[a.role];
      out.push(`// ${a.role} for ${a.principal}\nresource ra${i} 'Microsoft.Authorization/roleAssignments@2022-04-01' = {\n  scope: ${sym(acct.name)}\n  name: guid(${sym(acct.name)}.id, ${sym(prin.name)}.id, '${def.id}')\n  properties: {\n    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '${def.id}')\n    principalId: ${sym(prin.name)}.identity.principalId\n    principalType: 'ServicePrincipal'\n  }\n}\n`);
    });
    return out.join("\n");
  };

  /* ================= Subscription blade ================= */
  N.views.subscription = (r) => {
    const tab = r.tab || "overview";
    const prov = S.state.providers;
    let body;
    if (tab === "providers") body = `<p class="muted">A resource provider is the Azure service behind a resource type. A subscription must register a provider before using it. Common ones register automatically when you first create a resource; event-driven features (Event Grid) often do not.</p>
      <div class="table-wrap"><table class="list"><thead><tr><th>Provider</th><th>Status</th><th></th></tr></thead><tbody>${Object.entries(prov).map(([k, v]) => `<tr><td><code>${esc(k)}</code></td><td>${N.statusPill(v)}</td><td class="right">${v === "NotRegistered" ? `<button class="btn btn-sm" data-reg="${esc(k)}">Register</button>` : v === "Registered" ? `<button class="btn btn-sm" data-unreg="${esc(k)}">Unregister</button>` : ""}</td></tr>`).join("")}</tbody></table></div>
      <div class="snippet"><b>CLI</b><pre>az provider register --namespace Microsoft.EventGrid\naz provider show --namespace Microsoft.EventGrid --query registrationState</pre></div>`;
    else if (tab === "iam") body = `<div class="table-wrap"><table class="list"><thead><tr><th>Name</th><th>Type</th><th>Role</th><th>Scope</th></tr></thead><tbody><tr><td>learner@nimbuslearn.onmicrosoft.com</td><td>User</td><td>Owner</td><td>This resource</td></tr></tbody></table></div><p class="muted">Owner at subscription scope lets you manage everything, but grants <b>no data-plane access</b> to storage through Entra ID. That's why even you need a Storage Blob Data role to use <code>--auth-mode login</code>.</p>`;
    else body = `<table class="kv"><tr><th>Subscription ID</th><td><code>${esc(S.state.subscriptionId)}</code></td></tr><tr><th>Subscription name</th><td>Free learning subscription</td></tr><tr><th>Directory</th><td>${esc(S.state.tenant)}</td></tr><tr><th>My role</th><td>Owner</td></tr><tr><th>Offer</th><td>Nimbus sandbox (no charges)</td></tr><tr><th>Resource groups</th><td>${S.state.rgs.length}</td></tr></table>
      <div class="learn-card">${I("info")}<div><b>The Azure resource hierarchy</b><p>Microsoft Entra tenant → management groups → <b>subscriptions</b> (billing and policy boundary) → <b>resource groups</b> (lifecycle) → <b>resources</b>. Role assignments and policies inherit downward.</p></div></div>`;
    return {
      live: ["providers"],
      crumbs: [{ label: "Subscriptions", route: { view: "subscription" } }, { label: "Free learning subscription", route: r }],
      html: `<div class="res-blade"><aside class="res-menu"><div class="res-title"><span class="tile tile-lg tile-plain">${I("key")}</span><div><b>Free learning subscription</b><small>Subscription</small></div></div>
        ${[["overview", "Overview", "info"], ["iam", "Access control (IAM)", "key"], ["providers", "Resource providers", "grid"]].map(([k, l, ic]) => `<button class="rm-item ${tab === k ? "active" : ""}" data-go='${J({ view: "subscription", tab: k })}'>${I(ic)}<span>${l}</span></button>`).join("")}</aside>
        <div class="res-content"><div class="blade"><div class="blade-head"><h1>${tab === "providers" ? "Resource providers" : tab === "iam" ? "Access control (IAM)" : "Overview"}</h1></div>${body}</div></div></div>`,
      mount(root) {
        root.querySelectorAll("[data-reg]").forEach((b) => (b.onclick = () => {
          const k = b.dataset.reg; prov[k] = "Registering"; S.log("Register resource provider", k); S.changed("providers"); N.rerender();
          setTimeout(() => { prov[k] = "Registered"; S.notify("Resource provider registered", `${k} is registered on this subscription.`, "success"); S.changed("providers"); }, 4000);
        }));
        root.querySelectorAll("[data-unreg]").forEach((b) => (b.onclick = () => { prov[b.dataset.unreg] = "NotRegistered"; S.changed("providers"); N.rerender(); }));
      },
    };
  };
})(window.N);
