/* Nimbus Portal — Cloud Shell with a working subset of the Azure CLI (az), sqlcmd and helpers */
(function (N) {
  const S = N.store, I = N.icon;
  const hist = []; let hIdx = 0;

  N.toggleShell = (force) => {
    const el = document.getElementById("cloudshell");
    const open = force !== undefined ? force : el.hidden;
    el.hidden = !open;
    document.body.classList.toggle("shell-open", open);
    if (open && !el.innerHTML) {
      el.innerHTML = `<div class="sh-head">${I("shell")}<b>Bash</b><span class="muted">Azure Cloud Shell · type <code>help</code></span><span class="grow"></span><button class="icon-btn" id="sh-close" aria-label="Close shell">${I("close")}</button></div>
        <div class="sh-out" id="sh-out"></div><div class="sh-line"><span class="sh-ps">learner [ ~ ]$</span><input id="sh-in" autocomplete="off" spellcheck="false" aria-label="Shell command"></div>`;
      el.querySelector("#sh-close").onclick = () => N.toggleShell(false);
      const inp = el.querySelector("#sh-in");
      print("Requesting a Cloud Shell. Succeeded.\nConnecting terminal...\n\nWelcome to Azure Cloud Shell (Nimbus emulation)\nType \"az\" to use Azure CLI\nType \"help\" to learn which commands are emulated\n");
      inp.addEventListener("keydown", async (e) => {
        if (e.key === "Enter") { const c = inp.value; inp.value = ""; if (c.trim()) { hist.push(c); hIdx = hist.length; } print(`learner [ ~ ]$ ${c}`, "cmd"); await run(c); }
        if (e.key === "ArrowUp") { e.preventDefault(); if (hIdx > 0) inp.value = hist[--hIdx]; }
        if (e.key === "ArrowDown") { e.preventDefault(); hIdx = Math.min(hist.length, hIdx + 1); inp.value = hist[hIdx] || ""; }
      });
      el.addEventListener("click", (e) => { if (!e.target.closest("button") && !window.getSelection().toString()) inp.focus(); });
    }
    if (open) setTimeout(() => el.querySelector("#sh-in").focus(), 30);
  };
  function print(text, cls = "") {
    const out = document.getElementById("sh-out");
    if (!out) return;
    const d = document.createElement("pre"); d.className = cls; d.textContent = text; out.appendChild(d); out.scrollTop = out.scrollHeight;
  }

  function argv(line) {
    const out = []; let cur = "", q = null, has = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (q) { if (ch === q) q = null; else if (ch === "\\" && q === '"' && line[i + 1] === '"') { cur += '"'; i++; } else cur += ch; continue; }
      if (ch === '"' || ch === "'") { q = ch; has = true; continue; }
      if (ch === "\\" && line[i + 1] === "\n") { i++; continue; }
      if (/\s/.test(ch)) { if (cur || has) out.push(cur); cur = ""; has = false; continue; }
      cur += ch;
    }
    if (q) throw new Error("unexpected EOF while looking for matching `" + q + "'");
    if (cur || has) out.push(cur);
    return out;
  }
  function opts(a) {
    const o = { _: [] };
    for (let i = 0; i < a.length; i++) {
      if (/^--?[A-Za-z]/.test(a[i])) {
        const k = a[i].replace(/^--?/, "");
        const vals = [];
        while (i + 1 < a.length && !/^--?[A-Za-z]/.test(a[i + 1])) vals.push(a[++i]);
        o[k] = vals.length === 0 ? true : vals.length === 1 ? vals[0] : vals;
      } else o._.push(a[i]);
    }
    return o;
  }
  const pick = (o, ...k) => { for (const x of k) if (o[x] !== undefined) return o[x]; };
  const bool = (v) => v === true || /^(true|yes|1)$/i.test(String(v));
  const tagsOf = (v) => Object.fromEntries((Array.isArray(v) ? v : v ? [v] : []).map((kv) => kv.split("=")).filter((x) => x[0]).map(([k, ...r]) => [k, r.join("=")]));
  const fail = (msg) => { const e = new Error(msg); e.cli = true; throw e; };
  const rgOr = (name) => { if (!name) fail("the following arguments are required: --resource-group/-g"); if (!S.state.rgs.some((g) => g.name === name)) fail(`(ResourceGroupNotFound) Resource group '${name}' could not be found.\nCode: ResourceGroupNotFound`); return S.state.rgs.find((g) => g.name === name); };
  const region = (l, g) => { if (!l) return g ? g.region : N.REGIONS[0]; const r = N.REGIONS.find((x) => N.regionCode(x) === String(l).toLowerCase().replace(/\s/g, "")); if (!r) fail(`(LocationNotAvailableForResourceType) The provided location '${l}' is not available. Try: ${N.REGIONS.map(N.regionCode).join(", ")}`); return r; };

  /* tiny JMESPath: a.b, [].name, [0], [?name=='x'] */
  function jq(v, q) {
    if (!q) return v;
    let cur = v;
    for (const part of q.match(/\[\?[^\]]*\]|\[\d*\]|[^.[\]]+/g) || []) {
      if (cur == null) return null;
      if (part === "[]") { cur = Array.isArray(cur) ? cur : [cur]; continue; }
      if (/^\[\d+\]$/.test(part)) { cur = cur[+part.slice(1, -1)]; continue; }
      const f = /^\[\?(\w+)\s*==\s*'([^']*)'\]$/.exec(part);
      if (f) { cur = (Array.isArray(cur) ? cur : []).filter((x) => x && String(x[f[1]]) === f[2]); continue; }
      cur = Array.isArray(cur) ? cur.map((x) => (x == null ? null : x[part])) : cur[part];
    }
    return cur;
  }
  function format(v, o) {
    v = jq(v, o.query);
    const fmt = o.output || o.o || "json";
    if (fmt === "tsv") return (Array.isArray(v) ? v : [v]).map((x) => (x && typeof x === "object" ? Object.values(x).join("\t") : x ?? "")).join("\n");
    if (fmt === "table" && v && typeof v === "object") {
      const rows = Array.isArray(v) ? v : [v];
      if (!rows.length) return "";
      const cols = Object.keys(rows[0]).filter((k) => typeof rows[0][k] !== "object" || rows[0][k] === null);
      const head = cols.map((c) => c[0].toUpperCase() + c.slice(1));
      const w = cols.map((c, i) => Math.max(head[i].length, ...rows.map((r) => String(r[c] ?? "").length)));
      return [head.map((h, i) => h.padEnd(w[i])).join("  "), w.map((x) => "-".repeat(x)).join("  "), ...rows.map((r) => cols.map((c, i) => String(r[c] ?? "").padEnd(w[i])).join("  "))].join("\n");
    }
    return typeof v === "string" ? v : JSON.stringify(v, null, 2);
  }

  /* expand $(...) */
  async function expand(line) {
    let out = "", i = 0;
    while (i < line.length) {
      if (line[i] === "$" && line[i + 1] === "(") {
        let d = 1, j = i + 2;
        while (j < line.length && d) { if (line[j] === "(") d++; else if (line[j] === ")") d--; j++; }
        const inner = line.slice(i + 2, j - 1);
        out += String(await exec(inner, true)).trim();
        i = j; continue;
      }
      out += line[i++];
    }
    return out;
  }

  async function run(line) {
    try { const r = await exec(line, false); if (r !== undefined && r !== "") print(String(r)); }
    catch (e) { print(e.cli ? `ERROR: ${e.message}` : `ERROR: ${e.message}`, "err"); }
  }

  const HELP = `Emulated commands (real syntax):
  az account show
  az group create -n <name> -l <location> [--tags k=v …] | az group list [-o table] | az group delete -n <name> --yes
  az provider register -n Microsoft.EventGrid | az provider show -n <ns> --query registrationState
  az storage account create -n <name> -g <rg> -l <loc> --sku Standard_LRS --kind StorageV2 --hns true
        [--min-tls-version TLS1_2] [--allow-blob-public-access false] [--allow-shared-key-access true|false] [--tags …]
  az storage account list [-g <rg>] [-o table] | az storage account show -n <name> [--query id]
  az storage fs create -n <container> --account-name <acct> --auth-mode login|key
  az storage fs file list -f <container> --account-name <acct> [--path <dir>] --auth-mode login|key [-o table]
  az role assignment create --assignee <name|objectId> | --assignee-object-id <id> --assignee-principal-type ServicePrincipal
        --role "Storage Blob Data Contributor" --scope <resourceId>
  az role assignment list [--assignee <x>] [--scope <id>] [-o table]
  az sql server create -n <name> -g <rg> -l <loc> --enable-ad-only-auth --external-admin-principal-type User
        --external-admin-name learner@nimbuslearn.onmicrosoft.com --external-admin-sid <guid>
  az sql server update -n <name> -g <rg> --enable-public-network true|false
  az sql server firewall-rule create -g <rg> -s <server> -n <rule> --start-ip-address <ip> --end-ip-address <ip>
  az sql db create -g <rg> -s <server> -n <db> -e GeneralPurpose -f Gen5 -c 1 --compute-model Serverless --auto-pause-delay 60
  az datafactory create -n <name> -g <rg> -l <loc> | az datafactory show -n <name> -g <rg> --query identity.principalId -o tsv
  az datafactory pipeline create-run --factory-name <f> -g <rg> -n <pipeline> [--parameters '{"k":"v"}']
  az datafactory pipeline-run show --factory-name <f> -g <rg> --run-id <id>
  az databricks workspace create -n <name> -g <rg> -l <loc> --sku premium
  az resource list [-g <rg>] [-o table]
  sqlcmd -S <server>.database.windows.net -d <db> --authentication-method ActiveDirectoryDefault -Q "<T-SQL>"
  ls / cat <abfss-or-lake path>, clear, history
Output: -o json|table|tsv, --query <jmespath subset>. $(…) substitution works.`;

  async function exec(line, capture) {
    line = line.trim();
    if (!line) return "";
    if (/\$\(/.test(line)) line = await expand(line);
    if (line.includes(" | ")) fail("pipes are not emulated; use --query and -o instead.");
    const a = argv(line);
    const [cmd, ...rest] = a;
    if (cmd === "help") return HELP;
    if (cmd === "clear") { document.getElementById("sh-out").innerHTML = ""; return ""; }
    if (cmd === "history") return hist.map((h, i) => `${String(i + 1).padStart(4)}  ${h}`).join("\n");
    if (cmd === "echo") return rest.join(" ");
    if (cmd === "ls" || cmd === "cat") return files(cmd, rest);
    if (cmd === "sqlcmd") return sqlcmd(opts(rest));
    if (cmd === "sql") { const [db, ...q] = rest; S.flag("shell-sql"); const r = S.runTsql(db, q.join(" ")); const last = r.results[r.results.length - 1]; return last ? table(last.columns, last.values) : r.messages.join("\n"); }
    if (cmd !== "az") fail(`${cmd}: command not found`);
    S.flag("shell-az");
    const o = opts(rest);
    const [g1, g2, g3, g4] = o._;
    const key = [g1, g2, g3, g4].filter(Boolean).join(" ");
    const out = (v) => format(v, { query: o.query, output: pick(o, "output", "o") });
    switch (true) {
      case key === "account show": return out({ environmentName: "AzureCloud", id: S.state.subscriptionId, isDefault: true, name: "Free learning subscription", state: "Enabled", tenantId: "nimbus-tenant", user: { name: "learner@nimbuslearn.onmicrosoft.com", type: "user" } });
      case key === "group create": { const n = pick(o, "name", "n"); if (!n) fail("the following arguments are required: --name/-n/--resource-group/-g"); const l = region(pick(o, "location", "l")); if (!S.state.rgs.some((x) => x.name === n)) S.createRG(n, l); const gg = S.state.rgs.find((x) => x.name === n); gg.tags = Object.assign(gg.tags || {}, tagsOf(o.tags)); S.changed("resource"); return out({ id: `/subscriptions/${S.state.subscriptionId}/resourceGroups/${n}`, location: N.regionCode(l), name: n, properties: { provisioningState: "Succeeded" }, tags: gg.tags, type: "Microsoft.Resources/resourceGroups" }); }
      case key === "group list": return out(S.state.rgs.map((x) => ({ name: x.name, location: N.regionCode(x.region), provisioningState: "Succeeded" })));
      case key === "group delete": { const n = pick(o, "name", "n"); rgOr(n); if (!o.yes && !o.y) fail("Are you sure you want to perform this operation? Re-run with --yes (prompts are not emulated)."); await S.deleteRG(n); return ""; }
      case key === "provider register": { const ns = pick(o, "namespace", "n"); if (!(ns in S.state.providers)) fail(`The resource namespace '${ns}' is invalid.`); S.state.providers[ns] = "Registering"; S.changed("providers"); setTimeout(() => { S.state.providers[ns] = "Registered"; S.changed("providers"); }, 4000); return `Registering is still on-going. You can monitor using 'az provider show -n ${ns}'`; }
      case key === "provider show": { const ns = pick(o, "namespace", "n"); if (!(ns in S.state.providers)) fail(`The resource namespace '${ns}' is invalid.`); return out({ namespace: ns, registrationState: S.state.providers[ns] }); }
      case key === "storage account create": {
        const n = pick(o, "name", "n"), gg = rgOr(pick(o, "resource-group", "g"));
        if (!/^[a-z0-9]{3,24}$/.test(n || "")) fail(`(AccountNameInvalid) ${n} is not a valid storage account name. Storage account name must be between 3 and 24 characters in length and use numbers and lower-case letters only.`);
        if (S.GLOBAL_TAKEN.includes(n) || S.res("storage", n)) fail(`(StorageAccountAlreadyTaken) The storage account named ${n} is already taken.`);
        const r = S.createResource("storage", n, gg.name, region(pick(o, "location", "l"), gg), { hns: bool(o.hns || o["enable-hierarchical-namespace"]), redundancy: o.sku || "Standard_RAGRS", performance: String(o.sku || "Standard").startsWith("Premium") ? "Premium" : "Standard", minTls: o["min-tls-version"] || "TLS1_2", allowBlobPublic: o["allow-blob-public-access"] !== undefined ? bool(o["allow-blob-public-access"]) : false, allowSharedKey: o["allow-shared-key-access"] !== undefined ? bool(o["allow-shared-key-access"]) : true, accessTier: o["access-tier"] || "Hot", tags: tagsOf(o.tags), kind: "StorageV2" });
        return out(N.armJson(r));
      }
      case key === "storage account list": return out(S.resOfType("storage").filter((x) => !pick(o, "resource-group", "g") || x.rg === pick(o, "resource-group", "g")).map((x) => ({ name: x.name, resourceGroup: x.rg, location: N.regionCode(x.region), kind: "StorageV2", isHnsEnabled: !!x.props.hns })));
      case key === "storage account show": { const r = S.res("storage", pick(o, "name", "n")); if (!r) fail(`(ResourceNotFound) The Resource 'Microsoft.Storage/storageAccounts/${pick(o, "name", "n")}' was not found.`); return out(N.armJson(r)); }
      case key === "storage fs create": case key === "storage container create": {
        const acct = o["account-name"], c = pick(o, "name", "n");
        authStorage(acct, c, "write", o["auth-mode"]);
        if (!/^[a-z0-9](?!.*--)[a-z0-9-]{1,61}[a-z0-9]$/.test(c || "")) fail("The specifed resource name contains invalid characters.");
        S.createContainer(acct, c); return out({ created: true });
      }
      case key === "storage fs file list": case key === "storage fs list": {
        const acct = o["account-name"], c = pick(o, "file-system", "f");
        if (key === "storage fs list") { authStorage(acct, null, "read", o["auth-mode"]); return out(Object.keys(S.state.lake[acct].containers).map((n) => ({ name: n }))); }
        authStorage(acct, c, "read", o["auth-mode"]);
        const pre = (o.path || "").replace(/^\/+|\/+$/g, "");
        S.flag("shell-ls");
        return out(Object.entries(S.container(acct, c).files).filter(([p]) => !pre || p.startsWith(pre + "/")).map(([p, f]) => ({ name: p, isDirectory: false, contentLength: f.size, lastModified: new Date(f.modified).toISOString() })));
      }
      case key === "role assignment create": {
        const role = o.role, scope = o.scope;
        if (!role || !scope) fail("--role and --scope are required.");
        if (!S.ROLE_DEFS[role]) fail(`Role '${role}' doesn't exist.`);
        const who = o["assignee-object-id"] || o.assignee;
        const princ = [...S.resOfType("factory"), ...S.resOfType("workspace")].find((x) => x.name === who || (x.props.identity && x.props.identity.principalId === who));
        const name = princ ? princ.name : who === "learner@nimbuslearn.onmicrosoft.com" ? who : null;
        if (!name) fail(`Cannot find user or service principal in graph database for '${who}'. If the assignee is an appId, make sure the corresponding service principal is created with 'az ad sp create --id ${who}'.`);
        const acct = S.resOfType("storage").find((x) => scope.startsWith(S.armId(x)));
        if (!acct) fail(`(InvalidResourceNamespace) The scope '${scope}' is not a storage account or container in this subscription. (Nimbus emulates role assignments on storage only.)`);
        S.assignRole(name, princ ? "ManagedIdentity" : "User", role, scope.replace(/\/+$/, ""));
        return out({ principalId: princ ? princ.props.identity.principalId : "learner", principalType: princ ? "ServicePrincipal" : "User", roleDefinitionId: `/subscriptions/${S.state.subscriptionId}/providers/Microsoft.Authorization/roleDefinitions/${S.ROLE_DEFS[role].id}`, scope });
      }
      case key === "role assignment list": return out(S.state.roles.filter((x) => (!o.assignee || x.principal === o.assignee || ([...S.resOfType("factory"), ...S.resOfType("workspace")].find((r) => r.name === x.principal) || { props: {} }).props.identity?.principalId === o.assignee) && (!o.scope || x.scope.startsWith(o.scope))).map((x) => ({ principalName: x.principal, roleDefinitionName: x.role, scope: x.scope })));
      case key === "sql server create": {
        const n = pick(o, "name", "n"), gg = rgOr(pick(o, "resource-group", "g"));
        if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(n || "")) fail(`(InvalidServerName) Invalid value given for parameter ServerName. Specify a valid parameter value.`);
        if (S.GLOBAL_TAKEN.includes(n) || S.res("sqlserver", n)) fail(`(ServerNameAlreadyExists) The name '${n}.database.windows.net' already exists. Choose a different name.`);
        const adOnly = bool(o["enable-ad-only-auth"]);
        if (!adOnly && !(o["admin-user"] && o["admin-password"])) fail("Specify --admin-user and --admin-password, or --enable-ad-only-auth with --external-admin-name.");
        const r = S.createResource("sqlserver", n, gg.name, region(pick(o, "location", "l"), gg), { auth: adOnly ? "entra" : o["external-admin-name"] ? "both" : "sql", admin: o["admin-user"], entraAdmin: o["external-admin-name"] || null, publicAccess: "selected", firewall: [], tags: tagsOf(o.tags) });
        return out(N.armJson(r));
      }
      case key === "sql server update": { const r = S.res("sqlserver", pick(o, "name", "n")); if (!r) fail("(ResourceNotFound) server not found"); if (o["enable-public-network"] !== undefined) r.props.publicAccess = bool(o["enable-public-network"]) ? "selected" : "disabled"; S.changed("resource"); return out(N.armJson(r)); }
      case key === "sql server firewall-rule create": {
        const srv = S.res("sqlserver", pick(o, "server", "s")); if (!srv) fail("(ResourceNotFound) The Resource 'Microsoft.Sql/servers' was not found.");
        const n = pick(o, "name", "n"), a1 = o["start-ip-address"], a2 = o["end-ip-address"];
        if (!n || !a1 || !a2) fail("--name, --start-ip-address and --end-ip-address are required.");
        if (n === "AllowAllWindowsAzureIps" && (a1 !== "0.0.0.0" || a2 !== "0.0.0.0")) fail("AllowAllWindowsAzureIps must use 0.0.0.0 - 0.0.0.0.");
        srv.props.firewall = (srv.props.firewall || []).filter((f) => f.name !== n).concat([{ name: n, start: a1, end: a2 }]);
        S.changed("resource"); return out({ name: n, startIpAddress: a1, endIpAddress: a2, type: "Microsoft.Sql/servers/firewallRules" });
      }
      case key === "sql db create": {
        const srv = S.res("sqlserver", pick(o, "server", "s")); if (!srv) fail("(ParentResourceNotFound) Can not perform requested operation on nested resource. Parent resource was not found.");
        const n = pick(o, "name", "n"); if (S.state.resources.some((d) => d.type === "sqldb" && d.props.server === srv.name && d.name === n)) fail(`(DatabaseAlreadyExists) The database '${n}' already exists.`);
        const r = S.createResource("sqldb", n, srv.rg, srv.region, { server: srv.name, compute: o["compute-model"] === "Serverless" ? "GP_S_Gen5_1" : "GP_Gen5_2", backup: o["backup-storage-redundancy"] || "Geo", users: {} });
        return out(N.armJson(r));
      }
      case key === "datafactory create": { const n = pick(o, "name", "factory-name", "n"), gg = rgOr(pick(o, "resource-group", "g")); if (S.res("factory", n) || S.GLOBAL_TAKEN.includes(n.toLowerCase())) fail(`(DataFactoryNameInUse) The specified resource name '${n}' is already in use.`); return out(N.armJson(S.createResource("factory", n, gg.name, region(pick(o, "location", "l"), gg), { tags: tagsOf(o.tags) }))); }
      case key === "datafactory show": { const r = S.res("factory", pick(o, "name", "factory-name", "n")); if (!r) fail("(ResourceNotFound) factory not found"); return out(N.armJson(r)); }
      case key === "datafactory pipeline create-run": {
        const f = o["factory-name"]; const pl = pick(o, "name", "n");
        let params = {}; if (o.parameters) { try { params = JSON.parse(o.parameters); } catch (e) { fail("--parameters must be JSON, e.g. '{\"fileName\":\"orders.csv\"}'"); } }
        const p = N.engine.runPipeline(f, pl, params, { type: "Manual", name: "Azure CLI" }, {});
        const run = await Promise.race([p.then((r) => r), N.sleep(400).then(() => S.state.runs.find((x) => x.factory === f && x.pipeline === pl))]).catch((e) => fail(e.message));
        return out({ runId: run ? run.id : "" });
      }
      case key === "datafactory pipeline-run show": { const r = S.state.runs.find((x) => x.id === o["run-id"]); if (!r) fail("(PipelineRunNotFound) run not found"); return out({ runId: r.id, pipelineName: r.pipeline, status: r.status, runStart: new Date(r.start).toISOString(), runEnd: r.end ? new Date(r.end).toISOString() : null, durationInMs: r.end ? r.end - r.start : null, message: r.error || "", parameters: r.params }); }
      case key === "databricks workspace create": { const n = pick(o, "name", "n"), gg = rgOr(pick(o, "resource-group", "g")); return out(N.armJson(S.createResource("workspace", n, gg.name, region(pick(o, "location", "l"), gg), { tier: o.sku || "premium" }))); }
      case key === "resource list": return out(S.state.resources.filter((x) => !pick(o, "resource-group", "g") || x.rg === pick(o, "resource-group", "g")).map((x) => ({ name: x.name, resourceGroup: x.rg, location: N.regionCode(x.region), type: N.armJson(x).type })));
    }
    fail(`'${o._.join(" ")}' is not emulated in Nimbus Cloud Shell. Type 'help' for the supported az commands.`);
  }

  function authStorage(acct, cont, op, mode) {
    const r = S.res("storage", acct);
    if (!r) fail(`The specified account '${acct}' does not exist.`);
    if (!mode) mode = "key";
    if (mode === "key") { if (r.props.allowSharedKey === false && S.realStrict()) fail("Key based authentication is not permitted on this storage account. ErrorCode: KeyBasedAuthenticationNotPermitted. Use --auth-mode login."); return; }
    if (!S.realStrict()) return;
    const rights = cont ? S.lakeRights("learner@nimbuslearn.onmicrosoft.com", acct, cont) : { read: S.state.roles.some((x) => x.principal === "learner@nimbuslearn.onmicrosoft.com" && S.ROLE_DEFS[x.role].plane === "data" && x.scope.startsWith(S.armId(r))), write: S.state.roles.some((x) => x.principal === "learner@nimbuslearn.onmicrosoft.com" && S.ROLE_DEFS[x.role].plane === "data" && S.ROLE_DEFS[x.role].write && x.scope.startsWith(S.armId(r))) };
    if (!(op === "read" ? rights.read : rights.write)) fail(`You do not have the required permissions needed to perform this operation.\nDepending on your operation, you may need to be assigned one of the following roles:\n    "Storage Blob Data Owner"\n    "Storage Blob Data Contributor"\n    "Storage Blob Data Reader"\n    "Storage Queue Data Contributor"\n    "Storage Queue Data Reader"\n    "Storage Table Data Contributor"\n    "Storage Table Data Reader"\n\nIf you want to use the old authentication method and allow querying for the right account key, please use the "--auth-mode" parameter and "key" value.`);
  }
  function files(cmd, rest) {
    S.flag("shell-ls");
    if (!rest[0]) return Object.keys(S.state.lake).map((x) => `abfss://<container>@${x}.dfs.core.windows.net/`).join("\n") || "(no storage accounts)";
    let m = /^abfss:\/\/([^@]+)@([^.]+)\.dfs\.core\.windows\.net\/?(.*)$/.exec(rest[0]) || /^lake:\/\/([^/]+)\/([^/]+)\/?(.*)$/.exec(rest[0]);
    if (!m) fail("use abfss://container@account.dfs.core.windows.net/path");
    const [acct, cont, path] = rest[0].startsWith("abfss") ? [m[2], m[1], m[3]] : [m[1], m[2], m[3]];
    const c = S.container(acct, cont); if (!c) fail("container not found");
    if (cmd === "cat") { const f = c.files[path]; if (!f) fail("No such file"); const l = f.content.split("\n"); return l.slice(0, 40).join("\n") + (l.length > 41 ? `\n… ${l.length - 40} more lines` : ""); }
    const pre = path ? path.replace(/\/+$/, "") + "/" : "";
    const items = new Set();
    Object.keys(c.files).forEach((p) => { if (!p.startsWith(pre)) return; const r = p.slice(pre.length); const i = r.indexOf("/"); items.add(i >= 0 ? r.slice(0, i + 1) : r); });
    return [...items].sort().join("\n") || "(empty)";
  }
  function sqlcmd(o) {
    const host = pick(o, "S"), db = pick(o, "d"), q = pick(o, "Q", "q");
    if (!host || !db || !q) fail("usage: sqlcmd -S <server>.database.windows.net -d <database> --authentication-method ActiveDirectoryDefault -Q \"<query>\"");
    const srvName = String(host).replace(/^tcp:/, "").replace(/,1433$/, "").replace(/\.database\.windows\.net$/, "");
    const d = S.state.resources.find((x) => x.type === "sqldb" && x.name === db && x.props.server === srvName);
    if (!d) fail(`Sqlcmd: Error: Microsoft ODBC Driver 18 for SQL Server : Cannot open database "${db}" requested by the login. The login failed..`);
    try { S.checkSqlNetwork(db, "client"); } catch (e) { fail(`Sqlcmd: Error: Microsoft ODBC Driver 18 for SQL Server : ${e.message.split("\n")[0]}.`); }
    const r = S.runTsql(db, q);
    S.flag("shell-sql");
    const last = r.results[r.results.length - 1];
    return (last ? table(last.columns, last.values) + `\n\n(${last.values.length} rows affected)` : r.messages.join("\n"));
  }
  function table(cols, rows) {
    const w = cols.map((c, i) => Math.min(40, Math.max(String(c).length, ...rows.slice(0, 50).map((r) => String(r[i] ?? "NULL").length))));
    const line = (r) => r.map((v, i) => String(v ?? "NULL").slice(0, 40).padEnd(w[i])).join(" ");
    return [line(cols), w.map((x) => "-".repeat(x)).join(" "), ...rows.slice(0, 50).map(line)].join("\n") + (rows.length > 50 ? `\n… ${rows.length - 50} more rows` : "");
  }
  N.shellExec = exec;
})(window.N);
