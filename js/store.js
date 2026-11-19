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
  });

  const S = { state: fresh(), SQL: null, dbs: {}, persistent: false, listeners: [] };
  N.store = S;

  let saveTimer = null;
  const dirtyDbs = new Set();
  S.save = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      await idbSet("state", JSON.parse(JSON.stringify(S.state)));
      for (const name of dirtyDbs) if (S.dbs[name]) await idbSet("db:" + name, S.dbs[name].export());
      dirtyDbs.clear();
    }, 400);
  };
  S.changed = (what) => { S.save(); S.listeners.forEach((fn) => fn(what)); };
  S.on = (fn) => S.listeners.push(fn);

  S.init = async () => {
    S.SQL = await window.initSqlJs();
    idb = await openIDB();
    S.persistent = !!idb;
    const saved = await idbGet("state");
    if (saved && saved.v === 1) S.state = Object.assign(fresh(), saved);
    for (const r of S.state.resources.filter((x) => x.type === "sqldb")) {
      const bytes = await idbGet("db:" + r.name);
      try { S.dbs[r.name] = bytes ? new S.SQL.Database(new Uint8Array(bytes)) : new S.SQL.Database(); }
      catch (e) { S.dbs[r.name] = new S.SQL.Database(); }
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
  S.nameTaken = (type, name) => S.state.resources.some((r) => r.name.toLowerCase() === name.toLowerCase() && (r.type === type || type === "storage"));

  S.createRG = (name, region) => {
    if (S.state.rgs.some((g) => g.name.toLowerCase() === name.toLowerCase())) return;
    S.state.rgs.push({ name, region, created: Date.now() });
    S.log("Create resource group", name);
  };

  S.createResource = (type, name, rg, region, props = {}) => {
    const r = { id: N.uid("r"), type, name, rg, region, created: Date.now(), props };
    S.state.resources.push(r);
    if (type === "storage") S.state.lake[name] = { containers: {} };
    if (type === "sqldb") { S.dbs[name] = new S.SQL.Database(); dirtyDbs.add(name); }
    if (type === "factory") S.state.factories[name] = { linked: [], pipelines: [], triggers: [] };
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
