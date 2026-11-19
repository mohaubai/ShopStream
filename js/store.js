/* Nimbus Portal — state, persistence, lake storage and SQL engine */
(function (N) {
  const IDB = "nimbus-portal", STORE = "kv";
  let idb = null;

  function openIDB() {
    return new Promise((resolve) => {
      try {
        const req = indexedDB.open(IDB, 1);
        req.onupgradeneeded = () => req.result.createObjectStore(STORE);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
      } catch (e) { resolve(null); }
    });
  }
  function idbGet(key) {
    return new Promise((resolve) => {
      if (!idb) return resolve(undefined);
      try {
        const r = idb.transaction(STORE).objectStore(STORE).get(key);
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => resolve(undefined);
      } catch (e) { resolve(undefined); }
    });
  }
  function idbSet(key, val) {
    return new Promise((resolve) => {
      if (!idb) return resolve(false);
      try {
        const tx = idb.transaction(STORE, "readwrite");
        if (val === undefined) tx.objectStore(STORE).delete(key); else tx.objectStore(STORE).put(val, key);
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
      } catch (e) { resolve(false); }
    });
  }
  function idbKeys() {
    return new Promise((resolve) => {
      if (!idb) return resolve([]);
      try {
        const r = idb.transaction(STORE).objectStore(STORE).getAllKeys();
        r.onsuccess = () => resolve(r.result || []);
        r.onerror = () => resolve([]);
      } catch (e) { resolve([]); }
    });
  }

  const fresh = () => ({
    v: 1, rgs: [], resources: [], lake: {}, factories: {}, runs: [], notebooks: {}, log: [], notifications: [], flags: {}, labs: {}, created: Date.now(),
    subscriptionId: (crypto.randomUUID ? crypto.randomUUID() : "8f2c1d4e-0000-4000-8000-" + Date.now().toString(16).padStart(12, "0")),
    tenant: "nimbuslearn.onmicrosoft.com",
    providers: { "Microsoft.Storage": "Registered", "Microsoft.Sql": "Registered", "Microsoft.DataFactory": "Registered", "Microsoft.Databricks": "Registered", "Microsoft.EventGrid": "NotRegistered", "Microsoft.KeyVault": "NotRegistered", "Microsoft.Insights": "Registered" },
    roles: [], settings: { realism: "strict" }, course: {},
  });

  const S = { state: fresh(), SQL: null, dbs: {}, persistent: false, listeners: [] };
  N.store = S;

  let saveTimer = null;
  const dirtyDbs = new Set();
  S.save = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      await idbSet("state", JSON.parse(JSON.stringify(S.state)));
      for (const name of dirtyDbs) if (S.dbs[name]) await idbSet("db:" + name, S.exportDb(name));
      dirtyDbs.clear();
    }, 400);
  };
  /* export() reopens the sql.js connection: restore our functions and catalog views afterwards */
  S.exportDb = (name) => { const db = S.dbs[name]; const bytes = db.export(); N.registerSqlFunctions(db); return bytes; };
  S.changed = (what) => { S.save(); S.listeners.forEach((fn) => fn(what)); };
  S.on = (fn) => S.listeners.push(fn);

  S.init = async () => {
    S.SQL = await window.initSqlJs();
    idb = await openIDB();
    S.persistent = !!idb;
    const saved = await idbGet("state");
    if (saved && saved.v === 1) {
      const f = fresh();
      S.state = Object.assign(f, saved);
      S.state.providers = Object.assign(f.providers, saved.providers || {});
      S.state.settings = Object.assign(f.settings, saved.settings || {});
    }
    for (const fac of Object.values(S.state.factories)) { fac.datasets = fac.datasets || []; fac.dataflows = fac.dataflows || []; fac.linked = fac.linked || []; fac.triggers = fac.triggers || []; }
    for (const r of S.state.resources.filter((x) => x.type === "sqldb")) {
      const bytes = await idbGet("db:" + r.name);
      try { S.dbs[r.name] = bytes ? new S.SQL.Database(new Uint8Array(bytes)) : new S.SQL.Database(); }
      catch (e) { S.dbs[r.name] = new S.SQL.Database(); }
      N.registerSqlFunctions(S.dbs[r.name]);
      r.props.users = r.props.users || {};
    }
  };

  S.resetAll = async () => {
    const keys = await idbKeys();
    for (const k of keys) await idbSet(k, undefined);
    Object.values(S.dbs).forEach((d) => { try { d.close(); } catch (e) {} });
    S.dbs = {};
    S.state = fresh();
    S.changed("reset");
  };

  /* ---------- activity log & notifications ---------- */
  S.log = (op, target, status = "Succeeded") => {
    S.state.log.unshift({ t: Date.now(), op, target, status });
    S.state.log.length = Math.min(S.state.log.length, 300);
  };
  S.notify = (title, text, kind = "info") => {
    S.state.notifications.unshift({ id: N.uid("n"), t: Date.now(), title, text, kind, read: false });
    S.state.notifications.length = Math.min(S.state.notifications.length, 50);
    S.changed("notify");
  };
  S.flag = (key) => { if (!S.state.flags[key]) { S.state.flags[key] = Date.now(); S.changed("flag"); } };

  /* ---------- resources ---------- */
  S.res = (type, name) => S.state.resources.find((r) => r.type === type && r.name === name);
  S.resOfType = (type) => S.state.resources.filter((r) => r.type === type);
  S.resById = (id) => S.state.resources.find((r) => r.id === id);
  S.nameTaken = (type, name) => S.state.resources.some((r) => r.name.toLowerCase() === name.toLowerCase() && r.type === type);
  /* Names that would already be taken in the global Azure namespace (storage, SQL server, data factory names form DNS names) */
  S.GLOBAL_TAKEN = ["storage", "data", "datalake", "lake", "test", "demo", "mystorage", "storageaccount", "teststorage", "sql", "sqlserver", "server", "myserver", "adf", "datafactory", "factory", "mydatafactory", "shopstream", "lakeshopdev"];
  S.realStrict = () => S.state.settings.realism !== "guided";

  S.createRG = (name, region) => {
    if (S.state.rgs.some((g) => g.name.toLowerCase() === name.toLowerCase())) return;
    S.state.rgs.push({ name, region, created: Date.now() });
    S.log("Create resource group", name);
  };

  S.createResource = (type, name, rg, region, props = {}) => {
    const r = { id: N.uid("r"), type, name, rg, region, created: Date.now(), props };
    S.state.resources.push(r);
    if (type === "storage") S.state.lake[name] = { containers: {} };
    if (type === "sqldb") { S.dbs[name] = new S.SQL.Database(); N.registerSqlFunctions(S.dbs[name]); dirtyDbs.add(name); r.props.users = r.props.users || {}; }
    if (type === "factory") { S.state.factories[name] = { linked: [], datasets: [], dataflows: [], pipelines: [], triggers: [], published: null }; r.props.identity = r.props.identity || { type: "SystemAssigned", principalId: N.uid("mi-") }; }
    if (type === "workspace") r.props.identity = r.props.identity || { type: "SystemAssigned", principalId: N.uid("mi-") };
    if (type === "workspace") S.state.notebooks[name] = [];
    S.log("Create " + N.typeMeta[type].label.toLowerCase(), name);
    S.changed("resource");
    return r;
  };

  S.deleteResource = async (r) => {
    S.state.resources = S.state.resources.filter((x) => x.id !== r.id);
    if (r.type === "storage") delete S.state.lake[r.name];
    if (r.type === "sqldb") { try { S.dbs[r.name].close(); } catch (e) {} delete S.dbs[r.name]; await idbSet("db:" + r.name, undefined); }
    if (r.type === "factory") { delete S.state.factories[r.name]; S.state.runs = S.state.runs.filter((x) => x.factory !== r.name); }
    if (r.type === "workspace") delete S.state.notebooks[r.name];
    if (r.type === "sqlserver") for (const d of S.state.resources.filter((x) => x.type === "sqldb" && x.props.server === r.name)) await S.deleteResource(d);
    S.state.roles = S.state.roles.filter((x) => x.principal !== r.name || !["factory", "workspace"].includes(r.type));
    S.state.roles = S.state.roles.filter((x) => !x.scope.includes("/" + r.name + "/") && !x.scope.endsWith("/" + r.name));
    S.log("Delete " + N.typeMeta[r.type].label.toLowerCase(), r.name);
    S.changed("resource");
  };

  S.deleteRG = async (name) => {
    for (const r of S.state.resources.filter((x) => x.rg === name)) await S.deleteResource(r);
    S.state.rgs = S.state.rgs.filter((g) => g.name !== name);
    S.log("Delete resource group", name);
    S.changed("resource");
  };

  /* ---------- lake ---------- */
  S.container = (acct, cont) => (S.state.lake[acct] && S.state.lake[acct].containers[cont]) || null;
  S.createContainer = (acct, cont) => {
    const a = S.state.lake[acct];
    if (!a || a.containers[cont]) return false;
    a.containers[cont] = { created: Date.now(), files: {}, folders: [] };
    S.log("Create container", acct + "/" + cont);
    S.changed("lake");
    return true;
  };
  S.deleteContainer = (acct, cont) => {
    delete S.state.lake[acct].containers[cont];
    S.log("Delete container", acct + "/" + cont);
    S.changed("lake");
  };

  /* Parse lake://acct/container/path (also accepts acct/container/path) */
  S.parseLake = (uri) => {
    const m = String(uri || "").trim().replace(/^lake:\/\//i, "").replace(/^\/+/, "");
    const parts = m.split("/");
    if (parts.length < 2) throw new Error(`"${uri}" is not a lake path. Use lake://<account>/<container>/<path>.`);
    return { acct: parts[0], cont: parts[1], path: parts.slice(2).join("/") };
  };
  S.lakeUri = (acct, cont, path) => `lake://${acct}/${cont}/${path}`;

  S.putFile = (acct, cont, path, content, { source = "upload", silent = false } = {}) => {
    const c = S.container(acct, cont);
    if (!c) throw new Error(`Container "${cont}" does not exist in storage account "${acct}".`);
    path = path.replace(/^\/+/, "");
    const existed = !!c.files[path];
    c.files[path] = { content, size: new Blob([content]).size, modified: Date.now(), source };
    S.log(existed ? "Overwrite blob" : "Create blob", `${acct}/${cont}/${path}`);
    S.changed("lake");
    if (!silent && N.engine) N.engine.onBlobCreated(acct, cont, path);
  };
  S.deleteFile = (acct, cont, path) => {
    const c = S.container(acct, cont);
    if (c && c.files[path]) { delete c.files[path]; S.log("Delete blob", `${acct}/${cont}/${path}`); S.changed("lake"); return true; }
    return false;
  };
  S.matchFiles = (acct, cont, pattern) => {
    const c = S.container(acct, cont);
    if (!c) throw new Error(`Container "${acct}/${cont}" was not found.`);
    pattern = pattern.replace(/^\/+/, "");
    if (!pattern || pattern.endsWith("/")) pattern += "**";
    if (!/[*?]/.test(pattern) && !c.files[pattern]) {
      const pre = pattern + "/";
      const under = Object.keys(c.files).filter((p) => p.startsWith(pre)).sort();
      if (under.length) return under;
    }
    const re = N.globToRegex(pattern);
    return Object.keys(c.files).filter((p) => re.test(p)).sort();
  };
  S.formatOf = (path) => (/\.(json|jsonl|ndjson)$/i.test(path) ? "json" : "csv");

  /* Read one or many files (glob) into {columns, rows, files} */
  S.readLake = (uri, format) => {
    const { acct, cont, path } = S.parseLake(uri);
    if (!S.state.lake[acct]) throw new Error(`Storage account "${acct}" was not found.`);
    const files = S.matchFiles(acct, cont, path);
    if (!files.length) throw new Error(`No files match "${path}" in ${acct}/${cont}.`);
    const columns = [], rows = [];
    for (const f of files) {
      const fmt = format || S.formatOf(f);
      const content = S.container(acct, cont).files[f].content;
      let parsed;
      try { parsed = fmt === "json" ? N.parseJSONData(content) : N.parseCSV(content); }
      catch (e) { throw new Error(`Could not parse ${f} as ${fmt.toUpperCase()}: ${e.message}`); }
      parsed.columns.forEach((c) => { if (!columns.includes(c)) columns.push(c); });
      rows.push(...parsed.rows);
    }
    return { columns, rows, files };
  };

  S.writeLake = (uri, columns, rows, format) => {
    const { acct, cont, path } = S.parseLake(uri);
    if (!path || path.endsWith("/")) throw new Error("The sink path must name a file, e.g. lake://account/container/folder/file.csv");
    const fmt = format || S.formatOf(path);
    S.putFile(acct, cont, path, fmt === "json" ? N.toJSONLines(columns, rows) : N.toCSV(columns, rows), { source: "pipeline" });
  };

  /* ---------- SQL ---------- */
  S.db = (name) => {
    const d = S.dbs[name];
    if (!d) throw new Error(`SQL database "${name}" was not found.`);
    return d;
  };
  S.markDb = (name) => { dirtyDbs.add(name); S.save(); };

  /* Load rows into a table, creating or evolving it. mode: overwrite | append */
  S.loadTable = (db, table, columns, rows, mode = "overwrite") => {
    const types = {};
    columns.forEach((c) => (types[c] = N.inferType(rows.slice(0, 2000).map((r) => (Array.isArray(r) ? r[columns.indexOf(c)] : r[c])))));
    const exists = db.exec(`SELECT name FROM sqlite_master WHERE type IN ('table') AND name = ${sqlStr(table)}`).length > 0;
    if (exists && mode === "overwrite") db.run(`DROP TABLE ${N.qid(table)}`);
    if (!exists || mode === "overwrite") {
      db.run(`CREATE TABLE ${N.qid(table)} (${columns.map((c) => `${N.qid(c)} ${types[c]}`).join(", ")})`);
    } else {
      const have = db.exec(`PRAGMA table_info(${N.qid(table)})`)[0].values.map((v) => v[1]);
      for (const c of columns) if (!have.includes(c)) db.run(`ALTER TABLE ${N.qid(table)} ADD COLUMN ${N.qid(c)} ${types[c]}`);
    }
    if (!rows.length) return 0;
    const stmt = db.prepare(`INSERT INTO ${N.qid(table)} (${columns.map(N.qid).join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`);
    db.run("BEGIN");
    try {
      for (const r of rows) stmt.run(columns.map((c, i) => N.coerce(Array.isArray(r) ? r[i] : r[c], types[c])));
      db.run("COMMIT");
    } catch (e) { db.run("ROLLBACK"); throw e; }
    finally { stmt.free(); }
    return rows.length;
  };
  const sqlStr = (s) => "'" + String(s).replace(/'/g, "''") + "'";
  S.sqlStr = sqlStr;

  S.tables = (db) => {
    const res = db.exec("SELECT name, type FROM sqlite_master WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' ORDER BY type, name");
    if (!res.length) return [];
    return res[0].values.map(([name, type]) => {
      const info = db.exec(`PRAGMA table_info(${N.qid(name)})`);
      let rows = null;
      try { rows = db.exec(`SELECT COUNT(*) FROM ${N.qid(name)}`)[0].values[0][0]; } catch (e) {}
      return { name, type, rows, cols: info.length ? info[0].values.map((v) => ({ name: v[1], type: v[2] || "ANY", pk: !!v[5], notnull: !!v[3] })) : [] };
    });
  };

  /* Sandbox helpers usable in any SQL: read_csv('lake://...'), read_json('lake://...'), read_table('db.table') */
  S.expandHelpers = (db, sql, currentDb) => {
    let n = 0;
    const loaded = [];
    const out = sql.replace(/\b(read_csv|read_json|read_lake|read_table)\s*\(\s*'([^']+)'\s*\)/gi, (m, fn, arg) => {
      const tmp = `__src_${++n}_${Math.random().toString(36).slice(2, 6)}`;
      fn = fn.toLowerCase();
      let data;
      if (fn === "read_table") {
        const [dbName, tbl] = arg.includes(".") ? [arg.slice(0, arg.indexOf(".")), arg.slice(arg.indexOf(".") + 1)] : [currentDb, arg];
        const res = S.db(dbName).exec(`SELECT * FROM ${N.qid(tbl)}`);
        const columns = res.length ? res[0].columns : S.db(dbName).exec(`PRAGMA table_info(${N.qid(tbl)})`)[0]?.values.map((v) => v[1]) || [];
        data = { columns, rows: res.length ? res[0].values : [] };
      } else {
        data = S.readLake(arg, fn === "read_json" ? "json" : fn === "read_csv" ? "csv" : undefined);
      }
      db.run(`DROP TABLE IF EXISTS temp.${N.qid(tmp)}`);
      const types = {};
      data.columns.forEach((c, i) => (types[c] = N.inferType(data.rows.slice(0, 2000).map((r) => (Array.isArray(r) ? r[i] : r[c])))));
      db.run(`CREATE TEMP TABLE ${N.qid(tmp)} (${data.columns.map((c) => `${N.qid(c)} ${types[c]}`).join(", ") || '"empty" TEXT'})`);
      if (data.rows.length) {
        const st = db.prepare(`INSERT INTO temp.${N.qid(tmp)} VALUES (${data.columns.map(() => "?").join(",")})`);
        db.run("BEGIN");
        for (const r of data.rows) st.run(data.columns.map((c, i) => N.coerce(Array.isArray(r) ? r[i] : r[c], types[c])));
        db.run("COMMIT");
        st.free();
      }
      loaded.push({ fn, arg, rows: data.rows.length, files: data.files });
      return `temp.${N.qid(tmp)}`;
    });
    return { sql: out, loaded };
  };

  /* Run SQL text against a database. Returns {results:[{columns, values}], ms, changes, loaded} */
  S.runSQL = (dbOrName, sql) => {
    const db = typeof dbOrName === "string" ? S.db(dbOrName) : dbOrName;
    const dbName = typeof dbOrName === "string" ? dbOrName : null;
    const t0 = performance.now();
    const { sql: expanded, loaded } = S.expandHelpers(db, sql, dbName);
    const before = db.getRowsModified ? db.getRowsModified() : 0;
    const results = db.exec(expanded);
    const changes = db.getRowsModified ? db.getRowsModified() : before;
    // drop helper temp tables
    try {
      const temps = db.exec("SELECT name FROM temp.sqlite_master WHERE type='table' AND name LIKE '__src_%'");
      if (temps.length) temps[0].values.forEach(([t]) => db.run(`DROP TABLE IF EXISTS temp.${N.qid(t)}`));
    } catch (e) {}
    if (dbName && /\b(create|insert|update|delete|drop|alter|replace)\b/i.test(sql)) S.markDb(dbName);
    return { results, ms: Math.round(performance.now() - t0), changes, loaded };
  };
})(window.N);

/* ======================= Identity, RBAC and networking (realism layer) ======================= */
(function (N) {
  const S = N.store;
  const ROLE_DEFS = {
    "Owner": { id: "8e3af657-a8ff-443c-a75c-2fe8c4bcb635", plane: "control", desc: "Full access to manage all resources, including assigning roles. Grants no data access by itself." },
    "Contributor": { id: "b24988ac-6180-42a0-ab88-20f7382dd24c", plane: "control", desc: "Manage resources but not role assignments. Grants no data access through Microsoft Entra ID." },
    "Reader": { id: "acdd72a7-3385-48ef-bd42-f606fba81ae7", plane: "control", desc: "View resources. No data access." },
    "Storage Account Contributor": { id: "17d1049b-9a84-46fb-8f53-869881c3d3ab", plane: "control", desc: "Manage storage accounts, including access keys. Data access only by using those keys, which pipelines should not do." },
    "Storage Blob Data Owner": { id: "b7e6dc6d-f1e8-4753-8033-0f276bb0955b", plane: "data", read: true, write: true, desc: "Full access to blob containers and data, including POSIX ACLs." },
    "Storage Blob Data Contributor": { id: "ba92f5b4-2d11-453d-a403-e96b0029c9fe", plane: "data", read: true, write: true, desc: "Read, write and delete containers and blobs." },
    "Storage Blob Data Reader": { id: "2a2b9908-6ea1-4ae2-8e65-a410df84e7d1", plane: "data", read: true, desc: "Read and list containers and blobs." },
  };
  S.ROLE_DEFS = ROLE_DEFS;
  const PROPAGATION_MS = 8000;

  S.armId = (res, sub = "") => {
    const base = `/subscriptions/${S.state.subscriptionId}/resourceGroups/${res.rg}/providers/`;
    const p = { storage: `Microsoft.Storage/storageAccounts/${res.name}`, sqlserver: `Microsoft.Sql/servers/${res.name}`, sqldb: `Microsoft.Sql/servers/${res.props.server}/databases/${res.name}`, factory: `Microsoft.DataFactory/factories/${res.name}`, workspace: `Microsoft.Databricks/workspaces/${res.name}` }[res.type];
    return base + p + sub;
  };
  S.containerScope = (acct, cont) => { const r = S.res("storage", acct); return r ? S.armId(r, `/blobServices/default/containers/${cont}`) : ""; };

  S.assignRole = (principal, principalType, role, scope) => {
    if (S.state.roles.some((x) => x.principal === principal && x.role === role && x.scope === scope)) return false;
    S.state.roles.push({ id: N.uid("ra-"), principal, principalType, role, scope, created: Date.now() });
    S.log("Create role assignment", `${role} → ${principal}`);
    S.changed("iam");
    return true;
  };
  S.removeRole = (id) => { S.state.roles = S.state.roles.filter((x) => x.id !== id); S.log("Delete role assignment", id); S.changed("iam"); };

  /* Effective data-plane rights of a principal on a container */
  S.lakeRights = (principal, acct, cont, { ignoreDelay = false } = {}) => {
    const acctRes = S.res("storage", acct);
    if (!acctRes) return { read: false, write: false, pending: false };
    const acctScope = S.armId(acctRes), contScope = S.containerScope(acct, cont), rgScope = `/subscriptions/${S.state.subscriptionId}/resourceGroups/${acctRes.rg}`, subScope = `/subscriptions/${S.state.subscriptionId}`;
    let read = false, write = false, pending = false;
    for (const a of S.state.roles) {
      if (a.principal !== principal) continue;
      if (![acctScope, contScope, rgScope, subScope].includes(a.scope)) continue;
      const d = ROLE_DEFS[a.role];
      if (!d || d.plane !== "data") continue;
      if (!ignoreDelay && Date.now() - a.created < PROPAGATION_MS) { pending = true; continue; }
      read = read || !!d.read; write = write || !!d.write;
    }
    return { read, write, pending };
  };

  /* Throws the error the calling service would raise. kind: 'adf' | 'spark' */
  S.checkLake = (principal, acct, cont, op, kind = "adf") => {
    if (!S.realStrict()) return;
    const r = S.lakeRights(principal, acct, cont);
    const ok = op === "read" ? r.read : r.write;
    if (ok) return;
    const method = op === "read" ? "GET" : op === "delete" ? "DELETE" : "PUT";
    const hint = r.pending ? `\n(Nimbus: a role assignment for ${principal} exists but has not propagated yet. In Azure this takes up to 10 minutes; here about 8 seconds.)` : `\n(Nimbus: ${principal}'s managed identity needs a Storage Blob Data ${op === "read" ? "Reader or Contributor" : "Contributor"} role on ${acct}${cont ? " or container " + cont : ""}. Owner and Contributor do not grant data access.)`;
    if (kind === "spark") {
      const e = new Error(`Operation failed: "This request is not authorized to perform this operation using this permission.", 403, ${method}, https://${acct}.dfs.core.windows.net/${cont}?upn=false&resource=filesystem&maxResults=5000, AuthorizationPermissionMismatch, "This request is not authorized to perform this operation using this permission. RequestId:${N.uid()}"${hint}`);
      e.isSpark = true; throw e;
    }
    throw new Error(`ErrorCode=AdlsGen2OperationFailed,'Type=Microsoft.DataTransfer.Common.Shared.HybridDeliveryException,Message=ADLS Gen2 operation failed for: Operation returned an invalid status code 'Forbidden'. Account: '${acct}'. FileSystem: '${cont}'. ErrorCode: 'AuthorizationPermissionMismatch'. Message: 'This request is not authorized to perform this operation using this permission.'. RequestId: '${N.uid()}'.,Source=Microsoft.DataTransfer.ClientLibrary,'${hint}`);
  };

  S.serverOf = (dbName) => { const d = S.res("sqldb", dbName); return d && S.res("sqlserver", d.props.server); };
  S.fqdn = (server) => `${server}.database.windows.net`;

  /* Network check for a connection to a SQL database. source: 'azure' (ADF, other Azure services) | 'client' (your browser) */
  S.checkSqlNetwork = (dbName, source) => {
    if (!S.realStrict()) return;
    const srv = S.serverOf(dbName);
    if (!srv) return;
    const p = srv.props;
    if (p.publicAccess === "disabled") throw new Error(`Cannot connect to SQL Database: '${S.fqdn(srv.name)}', Database: '${dbName}'. Reason: Connection was denied since Deny Public Network Access is set to Yes (https://docs.microsoft.com/azure/azure-sql/database/connectivity-settings#deny-public-network-access). To connect to this server, use the Private Endpoint from inside your virtual network.\n(Nimbus: SQL server → Networking → Public network access → Selected networks.)`);
    if (source === "azure" && !(p.firewall || []).some((f) => f.start === "0.0.0.0" && f.end === "0.0.0.0")) {
      throw new Error(`ErrorCode=SqlFailedToConnect,'Type=Microsoft.DataTransfer.Common.Shared.HybridDeliveryException,Message=Cannot connect to SQL Database. Please contact SQL server team for further support. Server: '${S.fqdn(srv.name)}', Database: '${dbName}', User: ''. Check the connection configuration is correct, and make sure the SQL Database firewall allows the Data Factory runtime to access.,Source=Microsoft.DataTransfer.Connectors.MSSQL,''Type=Microsoft.Data.SqlClient.SqlException,Message=Cannot open server '${srv.name}' requested by the login. Client with IP address '20.${87 + (srv.name.length % 9)}.${srv.name.length * 7 % 255}.14' is not allowed to access the server. To enable access, use the Azure Management Portal or run sp_set_firewall_rule on the master database to create a firewall rule for this IP address or IP address range. It may take up to five minutes for this change to take effect.,Source=Framework Microsoft SqlClient Data Provider,'\n(Nimbus: SQL server → Networking → tick "Allow Azure services and resources to access this server".)`);
    }
    if (source === "client" && !(p.firewall || []).some((f) => f.name.startsWith("ClientIPAddress") || (f.start === N.CLIENT_IP))) {
      const e = new Error(`Cannot open server '${srv.name}' requested by the login. Client with IP address '${N.CLIENT_IP}' is not allowed to access the server. To enable access, use the Azure Management Portal or run sp_set_firewall_rule on the master database to create a firewall rule for this IP address or IP address range. It may take up to five minutes for this change to take effect.`);
      e.clientIp = true; throw e;
    }
  };
  N.CLIENT_IP = "102.135.44." + (17 + (Date.now() % 200));

  const ROLE_PERMS = { db_owner: ["read", "write", "ddl", "exec"], db_datareader: ["read"], db_datawriter: ["write"], db_ddladmin: ["ddl"], db_executor: ["exec"] };
  /* What a SQL statement needs */
  S.sqlNeeds = (sql) => {
    const s = String(sql).replace(/'[^']*'/g, "''").replace(/--.*$/gm, "");
    const need = new Set();
    if (/\b(CREATE|DROP|ALTER|TRUNCATE)\b/i.test(s) || /\bSELECT\b[\s\S]*\bINTO\b\s+(?!#)/i.test(s) && !/\bINSERT\s+INTO\b/i.test(s)) need.add("ddl");
    if (/\b(INSERT|UPDATE|DELETE|MERGE|TRUNCATE)\b/i.test(s)) need.add("write");
    if (/\bSELECT\b/i.test(s)) need.add("read");
    if (/\bEXEC(UTE)?\b/i.test(s)) need.add("exec");
    return need;
  };
  /* Database-level auth check for a managed identity (factory or workspace) */
  S.checkSqlAuth = (principal, dbName, needs) => {
    if (!S.realStrict()) return;
    const d = S.res("sqldb", dbName);
    const srv = S.serverOf(dbName);
    if (!d) return;
    if (srv && srv.props.auth === "sql") throw new Error(`Login failed for user '<token-identified principal>'. The server is not configured for Microsoft Entra authentication.\n(Nimbus: set a Microsoft Entra admin on ${srv.name} → Microsoft Entra ID.)`);
    const u = (d.props.users || {})[principal.toLowerCase()];
    if (!u) throw new Error(`ErrorCode=SqlFailedToConnect,'Type=Microsoft.DataTransfer.Common.Shared.HybridDeliveryException,Message=Cannot connect to SQL Database: '${srv ? S.fqdn(srv.name) : dbName}', Database: '${dbName}', User: ''. Check the linked service configuration is correct, and make sure the SQL Database firewall allows the integration runtime to access.,Source=Microsoft.DataTransfer.Connectors.MSSQL,''Type=Microsoft.Data.SqlClient.SqlException,Message=Login failed for user '<token-identified principal>'.,Source=Framework Microsoft SqlClient Data Provider,'\n(Nimbus: connect as the Entra admin and run CREATE USER [${principal}] FROM EXTERNAL PROVIDER; then add it to database roles.)`);
    const have = new Set((u.roles || []).flatMap((r) => ROLE_PERMS[r] || []).concat(u.grants || []));
    for (const n of needs) {
      if (have.has(n)) continue;
      const msg = { read: `The SELECT permission was denied on the object, database '${dbName}', schema 'dbo'.`, write: `The INSERT permission was denied on the object, database '${dbName}', schema 'dbo'.`, ddl: `CREATE TABLE permission denied in database '${dbName}'.`, exec: `The EXECUTE permission was denied on the object, database '${dbName}', schema 'dbo'.` }[n];
      throw new Error(`ErrorCode=SqlOperationFailed,'Type=Microsoft.DataTransfer.Common.Shared.HybridDeliveryException,Message=A database operation failed with the following error: '${msg}',Source=,''Type=Microsoft.Data.SqlClient.SqlException,Message=${msg},Source=Framework Microsoft SqlClient Data Provider,'\n(Nimbus: ${principal} needs ${{ read: "db_datareader", write: "db_datawriter", ddl: "db_ddladmin", exec: "EXECUTE permission" }[n]}. ${n === "exec" ? `GRANT EXECUTE ON SCHEMA::dbo TO [${principal}];` : `ALTER ROLE … ADD MEMBER [${principal}];`})`);
    }
  };

  /* Handle CREATE USER / ALTER ROLE / DROP USER in a T-SQL batch run by the Entra admin */
  S.userStatement = (dbName) => (sql, ctx) => {
    const d = S.res("sqldb", dbName);
    d.props.users = d.props.users || {};
    let m;
    if ((m = /^CREATE\s+USER\s+\[?([^\]\s]+)\]?\s+FROM\s+EXTERNAL\s+PROVIDER\s*;?$/i.exec(sql.trim()))) {
      const name = m[1];
      const principals = [...S.resOfType("factory"), ...S.resOfType("workspace")].map((r) => r.name.toLowerCase()).concat(["learner@nimbuslearn.onmicrosoft.com"]);
      if (!principals.includes(name.toLowerCase())) throw N.tsql.sqlErr(33130, 16, 1, ctx.line, `Principal '${name}' could not be found or this principal type is not supported.`);
      if (d.props.users[name.toLowerCase()]) throw N.tsql.sqlErr(15023, 16, 1, ctx.line, `User, group, or role '${name}' already exists in the current database.`);
      d.props.users[name.toLowerCase()] = { name, roles: [], created: Date.now() };
      ctx.messages.push("Commands completed successfully."); S.log("Create database user", `${dbName}/${name}`); S.changed("resource"); return;
    }
    if ((m = /^CREATE\s+USER\s+\[?([^\]\s]+)\]?/i.exec(sql.trim()))) throw N.tsql.sqlErr(33159, 16, 1, ctx.line, `Principal '${m[1]}' could not be created. Only connections established with Active Directory accounts can create other Active Directory users. (Nimbus: for a managed identity use CREATE USER [name] FROM EXTERNAL PROVIDER.)`);
    if ((m = /^ALTER\s+ROLE\s+\[?(\w+)\]?\s+(ADD|DROP)\s+MEMBER\s+\[?([^\]\s;]+)\]?\s*;?$/i.exec(sql.trim()))) {
      const role = m[1].toLowerCase(), user = d.props.users[m[3].toLowerCase()];
      if (!ROLE_PERMS[role]) throw N.tsql.sqlErr(15151, 16, 1, ctx.line, `Cannot alter the role '${m[1]}', because it does not exist or you do not have permission.`);
      if (!user) throw N.tsql.sqlErr(15151, 16, 1, ctx.line, `Cannot add the principal '${m[3]}', because it does not exist or you do not have permission.`);
      if (m[2].toUpperCase() === "ADD") { if (!user.roles.includes(role)) user.roles.push(role); } else user.roles = user.roles.filter((r) => r !== role);
      ctx.messages.push("Commands completed successfully."); S.log("Alter role " + role, `${dbName}/${user.name}`); S.changed("resource"); return;
    }
    if ((m = /^(GRANT|REVOKE|DENY)\s+EXECUTE(?:\s+ON\s+SCHEMA\s*::\s*\[?dbo\]?)?\s+(?:TO|FROM)\s+\[?([^\]\s;]+)\]?\s*;?$/i.exec(sql.trim()))) {
      const user = d.props.users[m[2].toLowerCase()];
      if (!user) throw N.tsql.sqlErr(15151, 16, 1, ctx.line, `Cannot find the user '${m[2]}', because it does not exist or you do not have permission.`);
      user.grants = (user.grants || []).filter((g) => g !== "exec");
      if (m[1].toUpperCase() === "GRANT") user.grants.push("exec");
      ctx.messages.push("Commands completed successfully."); S.log(m[1].toUpperCase() + " EXECUTE", `${dbName}/${user.name}`); S.changed("resource"); return;
    }
    if (/^(GRANT|REVOKE|DENY)\b/i.test(sql.trim())) { ctx.messages.push("Commands completed successfully. (Nimbus models GRANT/REVOKE EXECUTE only; other grants are accepted and ignored.)"); return; }
    if ((m = /^DROP\s+USER\s+(?:IF\s+EXISTS\s+)?\[?([^\]\s;]+)\]?/i.exec(sql.trim()))) { delete d.props.users[m[1].toLowerCase()]; ctx.messages.push("Commands completed successfully."); S.changed("resource"); return; }
    throw N.tsql.sqlErr(102, 15, 1, ctx.line, `Incorrect syntax near '${sql.slice(0, 30)}'.`);
  };

  /* Run T-SQL against a database. principal: null = you (Entra admin via the portal), otherwise a managed identity */
  S.runTsql = (dbName, sql, { principal = null, source = "client" } = {}) => {
    const db = S.db(dbName);
    if (principal) { S.checkSqlNetwork(dbName, "azure"); S.checkSqlAuth(principal, dbName, S.sqlNeeds(sql)); }
    const srv = S.serverOf(dbName);
    const r = N.tsql.run(db, sql, { strict: S.realStrict(), server: srv && srv.name, onStatement: principal ? null : S.userStatement(dbName) });
    if (/\b(create|insert|update|delete|drop|alter|merge|truncate|into|exec)\b/i.test(sql)) S.markDb(dbName);
    return r;
  };
})(window.N);
