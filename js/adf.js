/* Nimbus Portal — Azure Data Factory emulation.
   Linked services → datasets → activities → pipelines → triggers, with Debug vs Publish,
   dependency conditions, managed-identity access checks, ADF-shaped activity outputs and
   ADF-format JSON export. */
(function (N) {
  const S = N.store, E = N.engine;
  const clone = (o) => JSON.parse(JSON.stringify(o));

  /* ---------------- catalogue ---------------- */
  const ACTS = {
    Copy: { label: "Copy data", icon: "copyact", group: "Move and transform", desc: "Copy data from a source dataset to a sink dataset." },
    ExecuteDataFlow: { label: "Data flow", icon: "flow", group: "Move and transform", desc: "Run a mapping data flow (Spark in Azure)." },
    Script: { label: "Script", icon: "script", group: "General", desc: "Run SQL statements against a database linked service." },
    SqlServerStoredProcedure: { label: "Stored procedure", icon: "script", group: "General", desc: "Execute a stored procedure in Azure SQL Database." },
    Lookup: { label: "Lookup", icon: "search", group: "General", desc: "Read a query result or file; downstream activities use activity('name').output." },
    SetVariable: { label: "Set variable", icon: "edit", group: "General", desc: "Set a pipeline variable." },
    Validation: { label: "Validation", icon: "shield", group: "General", desc: "Wait until a file or folder exists (optionally with a minimum size)." },
    Delete: { label: "Delete", icon: "erase", group: "General", desc: "Delete files in a lake dataset." },
    Wait: { label: "Wait", icon: "wait", group: "General", desc: "Pause the pipeline." },
    ExecutePipeline: { label: "Execute Pipeline", icon: "factory", group: "General", desc: "Invoke another pipeline." },
    IfCondition: { label: "If Condition", icon: "flow", group: "Iteration & conditionals", desc: "Evaluate an expression; when true, run the activities in the True branch." },
    Fail: { label: "Fail", icon: "x", group: "General", desc: "Fail the pipeline with your own error code and message." },
  };
  const DS_TYPES = { DelimitedText: "Delimited text (CSV)", Json: "JSON", AzureSqlTable: "Azure SQL Database table" };

  const lakeCheck = (ds, principal, op) => { if (ds.ls.auth === "AccountKey") { const acct = S.res("storage", ds.ls.target); if (acct && acct.props.allowSharedKey === false && S.realStrict()) throw new Error(`ErrorCode=AdlsGen2OperationFailed,'Message=ADLS Gen2 operation failed for: Operation returned an invalid status code 'Forbidden'. Account: '${ds.ls.target}'. ErrorCode: 'KeyBasedAuthenticationNotPermitted'. Message: 'Key based authentication is not permitted on this storage account.'.'`); return; } S.checkLake(principal, ds.ls.target, ds.container, op); };
  const lsKind = (ls) => (!ls ? null : ls.type === "AzureBlobFS" || ls.type === "lake" ? "lake" : "sql");

  function newActivity(type, existing = []) {
    let i = 1;
    const base = { Copy: "Copy data", ExecuteDataFlow: "Data flow", Script: "Script", SqlServerStoredProcedure: "Stored procedure", Lookup: "Lookup", SetVariable: "Set variable", Validation: "Validation", Delete: "Delete", Wait: "Wait", ExecutePipeline: "Execute Pipeline", IfCondition: "If Condition", Fail: "Fail" }[type];
    while (existing.some((a) => a.name === base + i)) i++;
    const prev = existing[existing.length - 1];
    const a = { name: base + i, type, dependsOn: prev ? [{ activity: prev.name, dependencyConditions: ["Succeeded"] }] : [], policy: { timeout: "0.12:00:00", retry: 0, retryIntervalInSeconds: 30 } };
    const add = {
      Copy: { inputs: [{ referenceName: "", parameters: {} }], outputs: [{ referenceName: "", parameters: {} }], source: { recursive: true, wildcardFolderPath: "", wildcardFileName: "", additionalColumns: [], sqlReaderQuery: "" }, sink: { preCopyScript: "", tableOption: "none", writeBehavior: "insert" }, translator: { allowDataTruncation: true } },
      ExecuteDataFlow: { dataflow: "" },
      Script: { linkedServiceName: "", scripts: [{ type: "NonQuery", text: "" }] },
      SqlServerStoredProcedure: { linkedServiceName: "", storedProcedureName: "", storedProcedureParameters: {} },
      Lookup: { dataset: { referenceName: "", parameters: {} }, sqlReaderQuery: "", firstRowOnly: true },
      SetVariable: { variableName: "", value: "" },
      Validation: { dataset: { referenceName: "", parameters: {} }, timeout: 30, minimumSize: 0 },
      Delete: { dataset: { referenceName: "", parameters: {} }, recursive: true, wildcardFileName: "" },
      Wait: { waitTimeInSeconds: 1 },
      ExecutePipeline: { pipeline: "", parameters: {}, waitOnCompletion: true },
      IfCondition: { expression: "", ifTrueActivities: [{ name: "Fail" + i, type: "Fail", message: "", errorCode: "" }] },
      Fail: { message: "", errorCode: "" },
    }[type];
    return Object.assign(a, clone(add));
  }
  function newDataset(type, existing) {
    let i = 1; const base = { DelimitedText: "DelimitedText", Json: "Json", AzureSqlTable: "AzureSqlTable" }[type];
    while (existing.some((d) => d.name === base + i)) i++;
    return { name: base + i, type, linkedServiceName: "", container: "", folderPath: "", fileName: "", firstRowAsHeader: true, columnDelimiter: ",", table: "", parameters: [] };
  }
  function newDataflow(existing) {
    let i = 1; while (existing.some((d) => d.name === "dataflow" + i)) i++;
    return { name: "dataflow" + i, source: { dataset: "", parameters: {} }, transforms: [], sink: { dataset: "", parameters: {}, tableAction: "none", clearFolder: true, singleFileName: "" } };
  }

  /* ---------------- publish model ---------------- */
  const DRAFT_KEYS = ["pipelines", "datasets", "dataflows", "triggers"];
  function snapshot(f, debug) { return debug ? f : (f.published || { pipelines: [], datasets: [], dataflows: [], triggers: [] }); }
  function unpublished(f) {
    const out = [];
    const pub = f.published || {};
    for (const k of DRAFT_KEYS) {
      const draft = f[k] || [], live = pub[k] || [];
      const j = (o) => JSON.stringify(o, (k, v) => (k === "lastFired" ? undefined : v));
      for (const x of draft) { const y = live.find((z) => z.name === x.name); if (!y || j(y) !== j(x)) out.push({ kind: k, name: x.name, change: y ? "edited" : "new" }); }
      for (const y of live) if (!draft.some((x) => x.name === y.name)) out.push({ kind: k, name: y.name, change: "deleted" });
    }
    return out;
  }
  function publish(facName) {
    const f = S.state.factories[facName];
    const errors = [];
    for (const p of f.pipelines) validatePipeline(f, p).forEach((e) => errors.push(`${p.name}: ${e}`));
    for (const d of f.datasets) { const ls = f.linked.find((l) => l.name === d.linkedServiceName); if (!ls) errors.push(`${d.name}: linked service is missing.`); }
    for (const t of f.triggers) {
      if (!f.pipelines.some((p) => p.name === t.pipeline)) errors.push(`${t.name}: pipeline ${t.pipeline} does not exist.`);
      if (t.type === "BlobEventsTrigger" && t.enabled && S.realStrict() && S.state.providers["Microsoft.EventGrid"] !== "Registered") errors.push(`${t.name}: Failed to start trigger. The subscription '${S.state.subscriptionId}' is not registered to use namespace 'Microsoft.EventGrid'. (Nimbus: Subscriptions → Resource providers → Microsoft.EventGrid → Register.)`);
    }
    if (errors.length) return { ok: false, errors };
    const prev = f.published;
    f.published = clone({ pipelines: f.pipelines, datasets: f.datasets, dataflows: f.dataflows, triggers: f.triggers });
    f.publishedAt = Date.now();
    for (const t of f.published.triggers) { const old = prev && prev.triggers.find((x) => x.name === t.name); t.lastFired = old && old.lastFired ? old.lastFired : Date.now(); }
    S.log("Publish factory", facName);
    S.changed("pipeline");
    return { ok: true };
  }

  /* ---------------- validation ---------------- */
  function validatePipeline(f, pl) {
    const issues = [];
    const names = new Set(), all = pl.activities || [];
    const ds = (r) => f.datasets.find((d) => d.name === (r && r.referenceName));
    if (!all.length) issues.push("The pipeline has no activities.");
    for (const a of all) {
      const p = `${a.name}: `;
      if (names.has(a.name)) issues.push(p + "duplicate activity name."); names.add(a.name);
      if (!/^[A-Za-z0-9_ ()\-]{1,55}$/.test(a.name)) issues.push(p + "names may use letters, digits, spaces, - _ ( ) and up to 55 characters.");
      (a.dependsOn || []).forEach((d) => { if (!all.some((x) => x.name === d.activity)) issues.push(p + `depends on '${d.activity}', which does not exist.`); });
      if (!ACTS[a.type]) { issues.push(p + "is a legacy v1 activity. Recreate it with the current activity types."); continue; }
      if (a.type === "Copy") {
        if (!ds(a.inputs[0])) issues.push(p + "Source dataset is required.");
        if (!ds(a.outputs[0])) issues.push(p + "Sink dataset is required.");
      }
      if (a.type === "Lookup" || a.type === "Validation" || a.type === "Delete") { if (!ds(a.dataset)) issues.push(p + "Dataset is required."); }
      if (a.type === "Delete" && ds(a.dataset) && ds(a.dataset).type === "AzureSqlTable") issues.push(p + "Delete works on file-based datasets only.");
      if (a.type === "Script" && (!a.linkedServiceName || !a.scripts.some((s) => s.text.trim()))) issues.push(p + "Linked service and at least one script are required.");
      if (a.type === "SqlServerStoredProcedure" && (!a.linkedServiceName || !a.storedProcedureName)) issues.push(p + "Linked service and stored procedure name are required.");
      if (a.type === "ExecuteDataFlow" && !f.dataflows.some((d) => d.name === a.dataflow)) issues.push(p + "Data flow is required.");
      if (a.type === "ExecutePipeline" && !f.pipelines.some((x) => x.name === a.pipeline)) issues.push(p + "Invoked pipeline is required.");
      if (a.type === "ExecutePipeline" && a.pipeline === pl.name) issues.push(p + "A pipeline cannot invoke itself.");
      if (a.type === "IfCondition" && !String(a.expression || "").trim().startsWith("@")) issues.push(p + "Expression must start with @ and return a boolean.");
      if (a.type === "SetVariable" && !(pl.variables || []).some((v) => v.name === a.variableName)) issues.push(p + `variable '${a.variableName}' is not declared.`);
      const json = JSON.stringify(a);
      (json.match(/pipeline\(\)\.parameters\.(\w+)/g) || []).forEach((m) => { const n = m.split(".").pop(); if (!(pl.params || []).some((x) => x.name === n)) issues.push(`${p}parameter '${n}' is not defined on the pipeline.`); });
      (json.match(/activity\('([^']+)'\)/g) || []).forEach((m) => { const n = /'([^']+)'/.exec(m)[1]; if (!ancestors(all, a).has(n)) issues.push(`${p}references activity('${n}') which is not an upstream dependency.`); });
    }
    return [...new Set(issues)];
  }
  function ancestors(all, a, seen = new Set()) {
    for (const d of a.dependsOn || []) { if (seen.has(d.activity)) continue; seen.add(d.activity); const x = all.find((y) => y.name === d.activity); if (x) ancestors(all, x, seen); }
    return seen;
  }

  /* ---------------- dataset resolution ---------------- */
  function resolveDataset(snap, f, ref, ctx) {
    const d = snap.datasets.find((x) => x.name === (ref && ref.referenceName));
    if (!d) throw new Error(`Dataset '${ref && ref.referenceName}' was not found${snap === f ? "" : " in the published factory. Publish your changes"}.`);
    const ls = f.linked.find((l) => l.name === d.linkedServiceName);
    if (!ls) throw new Error(`The linked service '${d.linkedServiceName}' referenced by dataset '${d.name}' was not found.`);
    const params = {};
    (d.parameters || []).forEach((p) => (params[p.name] = p.default ?? ""));
    for (const [k, v] of Object.entries((ref && ref.parameters) || {})) params[k] = E.resolve(v, ctx);
    (d.parameters || []).forEach((p) => { if (params[p.name] === "" && !p.default && JSON.stringify(d).includes(`dataset().${p.name}`)) throw new Error(`The parameter '${p.name}' of dataset '${d.name}' has no value. Supply it on the activity.`); });
    const dctx = Object.assign({}, ctx, { dataset: params });
    const r = Object.assign({}, d, {
      container: E.resolve(d.container || "", dctx), folderPath: E.resolve(d.folderPath || "", dctx), fileName: E.resolve(d.fileName || "", dctx), table: E.resolve(d.table || "", dctx),
    });
    r.ls = ls; r.kind = lsKind(ls); r.params = params;
    return r;
  }
  const joinPath = (...p) => p.filter((x) => x !== undefined && x !== null && x !== "").map((x) => String(x).replace(/^\/+|\/+$/g, "")).filter(Boolean).join("/");

  /* list files for a lake dataset (+ wildcard settings) */
  function datasetFiles(ds, wc = {}) {
    const acct = ds.ls.target, cont = ds.container;
    if (!cont) throw new Error(`Dataset '${ds.name}': file system (container) is empty.`);
    const c = S.container(acct, cont);
    if (!c) throw new Error(`ErrorCode=AdlsGen2OperationFailed,'Type=Microsoft.DataTransfer.Common.Shared.HybridDeliveryException,Message=ADLS Gen2 operation failed for: Operation returned an invalid status code 'NotFound'. Account: '${acct}'. FileSystem: '${cont}'. ErrorCode: 'FilesystemNotFound'. Message: 'The specified filesystem does not exist.'.,Source=Microsoft.DataTransfer.ClientLibrary,'`);
    const all = Object.keys(c.files);
    if (wc.wildcardFileName || wc.wildcardFolderPath) {
      const folder = (wc.wildcardFolderPath || ds.folderPath || "").replace(/^\/+|\/+$/g, "");
      const re = N.globToRegex((folder ? folder + "/" : "") + (wc.wildcardFileName || "*"));
      return all.filter((p) => re.test(p)).sort();
    }
    if (ds.fileName) {
      const p = joinPath(ds.folderPath, ds.fileName);
      if (/[*?]/.test(p)) { const re = N.globToRegex(p); return all.filter((x) => re.test(x)).sort(); }
      if (!c.files[p]) throw new Error(`ErrorCode=AdlsGen2OperationFailed,'Type=Microsoft.DataTransfer.Common.Shared.HybridDeliveryException,Message=ADLS Gen2 operation failed for: Operation returned an invalid status code 'NotFound'. Account: '${acct}'. FileSystem: '${cont}'. Path: '${p}'. ErrorCode: 'PathNotFound'. Message: 'The specified path does not exist.'.,Source=Microsoft.DataTransfer.ClientLibrary,'`);
      return [p];
    }
    const pre = ds.folderPath ? ds.folderPath.replace(/^\/+|\/+$/g, "") + "/" : "";
    const under = all.filter((p) => p.startsWith(pre) && (wc.recursive !== false || !p.slice(pre.length).includes("/"))).sort();
    if (!under.length && pre && !(c.folders || []).some((f) => f.startsWith(pre))) throw new Error(`ErrorCode=AdlsGen2OperationFailed,'Type=Microsoft.DataTransfer.Common.Shared.HybridDeliveryException,Message=ADLS Gen2 operation failed for: Operation returned an invalid status code 'NotFound'. Account: '${acct}'. FileSystem: '${cont}'. Path: '${pre.slice(0, -1)}'. ErrorCode: 'PathNotFound'. Message: 'The specified path does not exist.'.,Source=Microsoft.DataTransfer.ClientLibrary,'`);
    return under;
  }

  /* Parse one file per ADF rules: DelimitedText values are strings, empty → null; headerless → Prop_0… */
  function parseFile(ds, content) {
    if (ds.type === "Json") {
      const d = N.parseJSONData(content);
      return { columns: d.columns, rows: d.rows.map((r) => d.columns.map((c) => (r[c] === undefined ? null : r[c]))) };
    }
    const delim = ds.columnDelimiter === "\\t" ? "\t" : ds.columnDelimiter || ",";
    const p = N.parseCSV(content, delim);
    let columns = p.columns, rows = p.rows.map((r) => columns.map((c) => r[c]));
    if (ds.firstRowAsHeader === false) { rows = [columns, ...rows]; columns = columns.map((c, i) => "Prop_" + i); }
    return { columns, rows: rows.map((r) => r.map((v) => (v === "" || v === undefined ? null : v))) };
  }

  function readDataset(ds, opts, ctx, principal) {
    if (ds.kind === "lake") {
      lakeCheck(ds, principal, "read");
      const files = datasetFiles(ds, opts);
      const columns = [], rows = [];
      let bytes = 0;
      for (const f of files) {
        const file = S.container(ds.ls.target, ds.container).files[f];
        bytes += file.size;
        const d = parseFile(ds, file.content);
        d.columns.forEach((c) => { if (!columns.includes(c)) columns.push(c); });
        const extra = (opts.additionalColumns || []).map((ac) => ({ name: ac.name, value: ac.value === "$$FILEPATH" ? f : /^\$\$COLUMN:/.test(ac.value) ? { col: ac.value.slice(9) } : E.resolve(ac.value, ctx) }));
        for (const r of d.rows) {
          const o = {}; d.columns.forEach((c, i) => (o[c] = r[i]));
          extra.forEach((x) => (o[x.name] = x.value && x.value.col ? o[x.value.col] : x.value));
          rows.push(o);
        }
      }
      (opts.additionalColumns || []).forEach((ac) => { if (ac.name && !columns.includes(ac.name)) columns.push(ac.name); });
      return { columns, rows: rows.map((o) => columns.map((c) => (o[c] === undefined ? null : o[c]))), files, bytes, textTyped: ds.type === "DelimitedText" };
    }
    // SQL source
    S.checkSqlNetwork(ds.ls.target, "azure");
    const q = (opts.sqlReaderQuery || "").trim() || `SELECT * FROM [dbo].[${ds.table}]`;
    if (!opts.sqlReaderQuery && !ds.table) throw new Error(`Dataset '${ds.name}': table name is empty and no query was given.`);
    S.checkSqlAuth(principal, ds.ls.target, new Set(["read"]));
    const r = N.tsql.run(S.db(ds.ls.target), q, { strict: S.realStrict() });
    const last = r.results[r.results.length - 1];
    return { columns: last ? last.columns : [], rows: last ? last.values : [], files: [], bytes: 0, textTyped: false };
  }

  /* ADF type conversion into an existing SQL column */
  function adfConvert(v, declType, col, allowTrunc) {
    if (v === null || v === undefined) return null;
    const t = String(declType || "").toLowerCase();
    if (!t || /^(text|ntext)$/.test(t)) return v;
    try {
      const out = N.tsql.convert(v, t);
      if (typeof out === "string" && typeof v === "string" && out.length < v.length && /char/.test(t) && !allowTrunc) throw new Error("trunc");
      return out;
    } catch (e) {
      const net = /bigint/.test(t) ? "Int64" : /int/.test(t) ? "Int32" : /decimal|numeric|money/.test(t) ? "Decimal" : /float|real/.test(t) ? "Double" : /date|time/.test(t) ? "DateTime" : /bit/.test(t) ? "Boolean" : "String";
      if (e.message === "trunc") throw new Error(`ErrorCode=UserErrorInvalidDataValue,'Type=Microsoft.DataTransfer.Common.Shared.HybridDeliveryException,Message=Column '${col}' contains an invalid value '${v}'. String would be truncated to fit column type ${declType}.,Source=Microsoft.DataTransfer.Common,'`);
      throw new Error(`ErrorCode=TypeConversionFailure,Exception occurred when converting value '${v}' for column name '${col}' from type 'String' (precision:, scale:) to type '${net}' (precision:${net === "Int32" ? 10 : net === "Int64" ? 19 : ""}, scale:${net === "Decimal" ? (/,\s*(\d+)/.exec(t) || [, 0])[1] : 0}). Additional info: ${net === "DateTime" ? "String was not recognized as a valid DateTime." : "Input string was not in a correct format."}`);
    }
  }

  function writeDataset(ds, data, opts, ctx, principal) {
    if (ds.kind === "lake") {
      lakeCheck(ds, principal, "write");
      if (!S.container(ds.ls.target, ds.container)) throw new Error(`ErrorCode=AdlsGen2OperationFailed,'Message=The specified filesystem '${ds.container}' does not exist.'`);
      const fmt = ds.type === "Json" ? "json" : "csv";
      const body = (cols, rows) => (fmt === "json" ? N.toJSONLines(cols, rows) : ds.firstRowAsHeader === false ? N.toCSV(cols, rows).split("\n").slice(1).join("\n") : N.toCSV(cols, rows));
      const written = [];
      if (opts.fileName || ds.fileName) {
        const p = joinPath(ds.folderPath, opts.fileName || ds.fileName);
        S.putFile(ds.ls.target, ds.container, p, body(data.columns, data.rows), { source: "pipeline" }); written.push(p);
      } else if (data.byFile) {
        for (const [src, rows] of Object.entries(data.byFile)) { const p = joinPath(ds.folderPath, src.split("/").pop()); S.putFile(ds.ls.target, ds.container, p, body(data.columns, rows), { source: "pipeline" }); written.push(p); }
      } else {
        const p = joinPath(ds.folderPath, `data_${ctx.pipeline.RunId}.${fmt === "json" ? "json" : "csv"}`);
        S.putFile(ds.ls.target, ds.container, p, body(data.columns, data.rows), { source: "pipeline" }); written.push(p);
      }
      return { rowsCopied: data.rows.length, filesWritten: written.length, files: written };
    }
    // SQL sink
    const dbName = ds.ls.target;
    S.checkSqlNetwork(dbName, "azure");
    const db = S.db(dbName);
    if (opts.preCopyScript && opts.preCopyScript.trim()) {
      S.checkSqlAuth(principal, dbName, S.sqlNeeds(opts.preCopyScript));
      try { N.tsql.run(db, opts.preCopyScript, { strict: S.realStrict() }); }
      catch (e) { throw new Error(`ErrorCode=SqlOperationFailed,'Type=Microsoft.DataTransfer.Common.Shared.HybridDeliveryException,Message=A database operation failed. Please search error to get more details.,Source=Microsoft.DataTransfer.ClientLibrary,''Type=Microsoft.Data.SqlClient.SqlException,Message=${e.message.split("\n").slice(1).join(" ")},Source=Framework Microsoft SqlClient Data Provider,' (while running the pre-copy script)`); }
    }
    if (!ds.table) throw new Error(`Dataset '${ds.name}': table name is empty.`);
    let info = db.exec(`PRAGMA table_info(${N.qid(ds.table)})`);
    if (!info.length) {
      if (opts.tableOption !== "autoCreate") throw new Error(`ErrorCode=SqlOperationFailed,'Type=Microsoft.DataTransfer.Common.Shared.HybridDeliveryException,Message=A database operation failed with the following error: 'Invalid object name 'dbo.${ds.table}'.',Source=,''Type=Microsoft.Data.SqlClient.SqlException,Message=Invalid object name 'dbo.${ds.table}'.,Source=Framework Microsoft SqlClient Data Provider,'\n(Nimbus: create the table first, or set Sink → Table option → Auto create table.)`);
      S.checkSqlAuth(principal, dbName, new Set(["ddl", "write"]));
      const types = data.columns.map((c, i) => (data.textTyped ? "NVARCHAR(MAX)" : (() => { const t = N.inferType(data.rows.slice(0, 500).map((r) => r[i])); return t === "INTEGER" ? "BIGINT" : t === "REAL" ? "FLOAT" : "NVARCHAR(MAX)"; })()));
      db.run(`CREATE TABLE ${N.qid(ds.table)} (${data.columns.map((c, i) => `${N.qid(c)} ${types[i]} NULL`).join(", ")})`);
      info = db.exec(`PRAGMA table_info(${N.qid(ds.table)})`);
    } else S.checkSqlAuth(principal, dbName, new Set(["write"]));
    const sinkCols = info[0].values.map((v) => ({ name: v[1], type: v[2] }));
    const map = data.columns.map((c) => {
      const t = sinkCols.find((x) => x.name.toLowerCase() === c.toLowerCase());
      if (!t) throw new Error(`ErrorCode=UserErrorInvalidColumnMappingColumnNotFound,'Type=Microsoft.DataTransfer.Common.Shared.HybridDeliveryException,Message=Column '${c}' specified in column mapping cannot be found in '${ds.table}' table.,Source=Microsoft.DataTransfer.ClientLibrary,'\n(Nimbus: add the column to the table, or remove it from the source.)`);
      return t;
    });
    const stmt = db.prepare(`INSERT INTO ${N.qid(ds.table)} (${map.map((m) => N.qid(m.name)).join(", ")}) VALUES (${map.map(() => "?").join(", ")})`);
    db.run("SAVEPOINT adfcopy");
    try {
      for (const r of data.rows) stmt.run(map.map((m, i) => (S.realStrict() ? adfConvert(r[i], m.type, m.name, opts.allowDataTruncation !== false) : r[i] === null ? null : N.coerce(r[i], N.inferType([r[i]])))));
      db.run("RELEASE adfcopy");
    } catch (e) {
      try { db.run("ROLLBACK TO adfcopy"); db.run("RELEASE adfcopy"); } catch (x) {}
      if (/^ErrorCode=/.test(e.message)) throw e;
      const t = N.tsql.translateSqliteError(e, 1);
      throw new Error(`ErrorCode=SqlBatchWriteTransactionFailed,'Type=Microsoft.DataTransfer.Common.Shared.HybridDeliveryException,Message=SQL transaction commits failed,Source=Microsoft.DataTransfer.ClientLibrary,''Type=Microsoft.Data.SqlClient.SqlException,Message=${t.sqlText},Source=Framework Microsoft SqlClient Data Provider,'`);
    } finally { stmt.free(); }
    S.markDb(dbName);
    return { rowsCopied: data.rows.length };
  }

  /* ---------------- data flows ---------------- */
  function compileDataflow(df, snap, f, ctx, principal, scratch) {
    const src = resolveDataset(snap, f, { referenceName: df.source.dataset, parameters: df.source.parameters }, ctx);
    const sd = readDataset(src, { recursive: true }, ctx, principal);
    S.loadTable(scratch, "source1", sd.columns, sd.rows.map((r) => r.map((v) => v)), "overwrite");
    const ctes = ["source1 AS (SELECT * FROM src_source1)"];
    scratch.run('ALTER TABLE source1 RENAME TO src_source1');
    let prev = "source1";
    const colsOf = (name) => { const st = scratch.prepare(`WITH ${ctes.join(", ")} SELECT * FROM ${name}`); const c = st.getColumnNames(); st.free(); return c; };
    const q = (c) => '"' + String(c).replace(/"/g, '""') + '"';
    (df.transforms || []).forEach((t, i) => {
      const nm = t.name || `${t.type}${i + 1}`;
      const label = `${nm} (${t.type})`;
      let body;
      try {
        switch (t.type) {
          case "filter": body = `SELECT * FROM ${prev} WHERE ${N.dfel.toSql(t.condition)}`; break;
          case "derivedColumn": {
            const cols = colsOf(prev);
            const derived = (t.columns || []).filter((c) => c.name);
            if (!derived.length) throw new Error("add at least one column");
            const sel = cols.map((c) => { const d = derived.find((x) => x.name.toLowerCase() === c.toLowerCase()); return d ? `${N.dfel.toSql(d.expr)} AS ${q(c)}` : q(c); });
            derived.filter((d) => !cols.some((c) => c.toLowerCase() === d.name.toLowerCase())).forEach((d) => sel.push(`${N.dfel.toSql(d.expr)} AS ${q(d.name)}`));
            body = `SELECT ${sel.join(", ")} FROM ${prev}`;
            break;
          }
          case "select": {
            const parts = String(t.columns || "").split(",").map((x) => x.trim()).filter(Boolean);
            if (!parts.length) throw new Error("list the columns to keep");
            body = `SELECT ${parts.map((p) => { const m = /^(\w+)(?:\s+as\s+(\w+))?$/i.exec(p); if (!m) throw new Error(`"${p}" should be column or column as new_name`); return `${q(m[1])}${m[2] ? " AS " + q(m[2]) : ""}`; }).join(", ")} FROM ${prev}`;
            break;
          }
          case "aggregate": {
            const gb = String(t.groupBy || "").split(",").map((x) => x.trim()).filter(Boolean);
            const ag = (t.aggregates || []).filter((a) => a.name);
            if (!ag.length) throw new Error("add at least one aggregate column");
            body = `SELECT ${[...gb.map(q), ...ag.map((a) => `${N.dfel.toSql(a.expr, { aggregate: true })} AS ${q(a.name)}`)].join(", ")} FROM ${prev}${gb.length ? " GROUP BY " + gb.map(q).join(", ") : ""}`;
            break;
          }
          case "join": case "exists": {
            const rds = resolveDataset(snap, f, { referenceName: t.rightDataset, parameters: t.rightParameters || {} }, ctx);
            const rd = readDataset(rds, { recursive: true }, ctx, principal);
            const tn = "right_" + i;
            S.loadTable(scratch, tn, rd.columns, rd.rows, "overwrite");
            if (!t.leftColumn || !t.rightColumn) throw new Error("choose the left and right join columns");
            if (t.type === "exists") { body = `SELECT * FROM ${prev} AS l WHERE ${t.negate ? "NOT " : ""}EXISTS (SELECT 1 FROM ${tn} AS r WHERE l.${q(t.leftColumn)} = r.${q(t.rightColumn)})`; break; }
            const left = colsOf(prev);
            const extra = rd.columns.filter((c) => !left.some((l) => l.toLowerCase() === c.toLowerCase())).map((c) => `r.${q(c)}`);
            const jt = { inner: "INNER JOIN", left: "LEFT JOIN", right: "RIGHT JOIN", outer: "FULL OUTER JOIN", cross: "CROSS JOIN" }[t.joinType || "inner"];
            body = `SELECT l.*${extra.length ? ", " + extra.join(", ") : ""} FROM ${prev} AS l ${jt} ${tn} AS r${t.joinType === "cross" ? "" : ` ON l.${q(t.leftColumn)} = r.${q(t.rightColumn)}`}`;
            break;
          }
          case "sort": {
            const parts = String(t.columns || "").split(",").map((x) => x.trim()).filter(Boolean);
            body = `SELECT * FROM ${prev} ORDER BY ${parts.map((p) => { const m = /^(\w+)(?:\s+(asc|desc))?$/i.exec(p); if (!m) throw new Error(`"${p}" should be column [asc|desc]`); return `${q(m[1])} ${(m[2] || "asc").toUpperCase()}`; }).join(", ")}`;
            break;
          }
          default: throw new Error("unknown transformation");
        }
        ctes.push(`${q(nm)} AS (\n  ${body}\n)`);
        colsOf(q(nm));
      } catch (e) { throw new Error(`DF-Executor-InvalidTransformation: ${label}: ${N.__udfErr || e.message}`); }
      prev = q(nm);
    });
    const sql = `WITH ${ctes.join(",\n")}\nSELECT * FROM ${prev}`;
    return { sql, readInfo: sd, srcDs: src };
  }

  function dataflowScript(df) {
    const lines = ["source(allowSchemaDrift: true,", "     validateSchema: false,", "     ignoreNoFilesFound: false) ~> source1"];
    let prev = "source1";
    (df.transforms || []).forEach((t, i) => {
      const nm = t.name || `${t.type}${i + 1}`;
      if (t.type === "join" || t.type === "exists") lines.unshift(`source(allowSchemaDrift: true, validateSchema: false) ~> ${t.rightDataset || "source2"}`);
      const body = {
        filter: () => `${prev} filter(${t.condition}) ~> ${nm}`,
        derivedColumn: () => `${prev} derive(${(t.columns || []).map((c) => `${c.name} = ${c.expr}`).join(",\n          ")}) ~> ${nm}`,
        select: () => `${prev} select(mapColumn(\n          ${String(t.columns || "").split(",").map((x) => x.trim()).filter(Boolean).map((p) => { const m = /^(\w+)(?:\s+as\s+(\w+))?$/i.exec(p) || [p, p]; return m[2] ? `${m[2]} = ${m[1]}` : m[1]; }).join(",\n          ")}\n     ),\n     skipDuplicateMapInputs: true,\n     skipDuplicateMapOutputs: true) ~> ${nm}`,
        aggregate: () => `${prev} aggregate(groupBy(${t.groupBy || ""}),\n     ${(t.aggregates || []).map((a) => `${a.name} = ${a.expr}`).join(",\n     ")}) ~> ${nm}`,
        join: () => `${prev}, ${t.rightDataset} join(${t.leftColumn} == ${t.rightDataset}@${t.rightColumn},\n     joinType:'${t.joinType || "inner"}',\n     matchType:'exact',\n     ignoreSpaces: false,\n     broadcast: 'auto')~> ${nm}`,
        exists: () => `${prev}, ${t.rightDataset} exists(${t.leftColumn} == ${t.rightDataset}@${t.rightColumn},\n     negate:${t.negate ? "true" : "false"},\n     broadcast: 'auto')~> ${nm}`,
        sort: () => `${prev} sort(${String(t.columns || "").split(",").map((x) => x.trim()).filter(Boolean).map((p) => { const m = /^(\w+)(?:\s+(asc|desc))?$/i.exec(p) || [p, p]; return `${(m[2] || "asc").toLowerCase()}(${m[1]}, true)`; }).join(",\n     ")}) ~> ${nm}`,
      }[t.type];
      lines.push(body ? body() : `${prev} ${t.type}() ~> ${nm}`);
      prev = nm;
    });
    lines.push(`${prev} sink(allowSchemaDrift: true,\n     validateSchema: false,${df.sink.singleFileName ? `\n     partitionFileNames:['${df.sink.singleFileName}'],\n     partitionBy('hash', 1),` : ""}\n     skipDuplicateMapInputs: true,\n     skipDuplicateMapOutputs: true) ~> sink1`);
    return lines.join("\n").split("\n");
  }

  /* ---------------- activity execution ---------------- */
  function copyOutput(start, read, written, srcType, sinkType) {
    const dur = Math.max(1, Math.round((Date.now() - start) / 1000));
    return {
      dataRead: read.bytes || 0, dataWritten: Math.round((read.bytes || read.rows.length * 60) * 1.05), filesRead: read.files ? read.files.length : undefined, filesWritten: written.filesWritten,
      sourcePeakConnections: 1, sinkPeakConnections: 1, rowsRead: read.rows.length, rowsCopied: written.rowsCopied, copyDuration: dur, throughput: +(((read.bytes || 1) / 1024) / dur).toFixed(3), errors: [],
      effectiveIntegrationRuntime: "AutoResolveIntegrationRuntime (South Africa North)", usedDataIntegrationUnits: 4,
      billingReference: { activityType: "DataMovement", billableDuration: [{ meterType: "AzureIR", duration: 0.0667, unit: "DIUHours" }], totalBillableDuration: [{ meterType: "AzureIR", duration: 0.0667, unit: "DIUHours" }] },
      usedParallelCopies: 1,
      executionDetails: [{ source: { type: srcType }, sink: { type: sinkType }, status: "Succeeded", start: new Date(start).toISOString(), duration: dur, usedDataIntegrationUnits: 4, usedParallelCopies: 1, profile: { queue: { status: "Completed", duration: 2 }, transfer: { status: "Completed", duration: Math.max(1, dur - 2) } }, detailedDurations: { queuingDuration: 2, transferDuration: Math.max(1, dur - 2) } }],
      dataConsistencyVerification: { VerificationResult: "NotVerified" },
      durationInQueue: { integrationRuntimeQueue: 0 },
      files: read.files, sinkFiles: written.files,
    };
  }

  async function execActivity(f, snap, a, ctx, run) {
    const principal = f.__name;
    switch (a.type) {
      case "Wait": await N.sleep(Math.min(20, Number(a.waitTimeInSeconds) || 0) * 1000); return {};
      case "Fail": { const e = new Error(E.resolve(a.message, ctx) || "Fail activity"); e.errorCode = E.resolve(a.errorCode, ctx) || "Fail"; e.failureType = "UserError"; throw e; }
      case "SetVariable": { const v = E.resolve(a.value, ctx); ctx.variables[a.variableName] = v; return { name: a.variableName, value: v }; }
      case "Copy": {
        const start = Date.now();
        const src = resolveDataset(snap, f, a.inputs[0], ctx), snk = resolveDataset(snap, f, a.outputs[0], ctx);
        const so = E.resolveDeep(clone(a.source || {}), ctx), sk = E.resolveDeep(clone(a.sink || {}), ctx);
        const read = readDataset(src, so, ctx, principal);
        if (snk.kind === "lake" && read.files && read.files.length > 1 && !snk.fileName) {
          // rows were concatenated in file order; split them back per file (PreserveHierarchy copy behaviour)
          read.byFile = {};
          let offset = 0;
          for (const file of read.files) { const n = parseFile(src, S.container(src.ls.target, src.container).files[file].content).rows.length; read.byFile[file] = read.rows.slice(offset, offset + n); offset += n; }
        }
        await N.sleep(250);
        const written = writeDataset(snk, read, Object.assign({}, sk, { allowDataTruncation: (a.translator || {}).allowDataTruncation }), ctx, principal);
        return copyOutput(start, read, written, src.kind === "lake" ? "AzureBlobFS" : "AzureSqlDatabase", snk.kind === "lake" ? "AzureBlobFS" : "AzureSqlDatabase");
      }
      case "Lookup": {
        const ds = resolveDataset(snap, f, a.dataset, ctx);
        const d = readDataset(ds, { sqlReaderQuery: E.resolve(a.sqlReaderQuery || "", ctx), recursive: true }, ctx, principal);
        const objs = d.rows.map((r) => Object.fromEntries(d.columns.map((c, i) => [c, r[i]])));
        if (a.firstRowOnly !== false) { if (!objs.length) return { firstRow: undefined, effectiveIntegrationRuntime: "AutoResolveIntegrationRuntime" }; return { firstRow: objs[0], effectiveIntegrationRuntime: "AutoResolveIntegrationRuntime" }; }
        if (objs.length > 5000) throw new Error("ErrorCode=UserErrorLookupResultExceedsLimit: The size of the lookup activity result exceeds the limit of 5000 rows. Use a narrower query or a ForEach pattern.");
        return { count: objs.length, value: objs, effectiveIntegrationRuntime: "AutoResolveIntegrationRuntime" };
      }
      case "Script": {
        const ls = f.linked.find((l) => l.name === a.linkedServiceName);
        if (!ls || lsKind(ls) !== "sql") throw new Error("Script activity needs an Azure SQL Database linked service.");
        const out = { resultSetCount: 0, recordsAffected: 0, resultSets: [], outputParameters: {}, outputLogs: "" };
        for (const s of a.scripts || []) {
          const text = E.resolve(s.text || "", ctx);
          if (!text.trim()) continue;
          let r;
          try { r = S.runTsql(ls.target, text, { principal }); }
          catch (e) { throw new Error(/^ErrorCode=/.test(e.message) ? e.message : `ErrorCode=SqlOperationFailed? Failure happened on 'Source' side. ${e.message.split("\n").slice(1).join(" ")}`.replace("? ", ",") + (e.sqlNumber ? ` (Msg ${e.sqlNumber}, Line ${/Line (\d+)/.exec(e.message)?.[1] || 1})` : "")); }
          out.recordsAffected += r.changes;
          if (s.type === "Query") r.results.forEach((x) => { out.resultSetCount++; out.resultSets.push({ rowCount: x.values.length, rows: x.values.slice(0, 5000).map((v) => Object.fromEntries(x.columns.map((c, i) => [c, v[i]]))) }); });
          out.outputLogs += r.messages.join("\n") + "\n";
        }
        return out;
      }
      case "SqlServerStoredProcedure": {
        const ls = f.linked.find((l) => l.name === a.linkedServiceName);
        if (!ls || lsKind(ls) !== "sql") throw new Error("Stored procedure activity needs an Azure SQL Database linked service.");
        const params = Object.entries(a.storedProcedureParameters || {}).map(([k, v]) => { const val = E.resolve(v.value, ctx); return `@${k.replace(/^@/, "")} = ${val === null || val === "" ? "NULL" : /^(Int|Decimal|Double|Int64|Boolean)/.test(v.type || "") ? Number(val) : "N'" + String(val).replace(/'/g, "''") + "'"}`; });
        const sql = `EXEC ${a.storedProcedureName} ${params.join(", ")}`;
        try { S.runTsql(ls.target, sql, { principal }); }
        catch (e) { throw new Error(/^ErrorCode=/.test(e.message) ? e.message : `ErrorCode=SqlOperationFailed,'Message=A database operation failed with the following error: '${e.message.split("\n").slice(1).join(" ")}''`); }
        return { effectiveIntegrationRuntime: "AutoResolveIntegrationRuntime", executionDuration: 1 };
      }
      case "Delete": {
        const ds = resolveDataset(snap, f, a.dataset, ctx);
        if (ds.kind !== "lake") throw new Error("Delete activity works on file-based datasets only.");
        lakeCheck(ds, principal, "delete");
        let files;
        try { files = datasetFiles(ds, { wildcardFileName: a.wildcardFileName, recursive: a.recursive }); } catch (e) { files = []; }
        files.forEach((p) => S.deleteFile(ds.ls.target, ds.container, p));
        return { datasetName: ds.name, type: "AzureBlobFS", filesDeleted: files.length, logPath: null };
      }
      case "Validation": {
        const ds = resolveDataset(snap, f, a.dataset, ctx);
        if (ds.kind !== "lake") throw new Error("Validation activity works on file-based datasets.");
        lakeCheck(ds, principal, "read");
        const until = Date.now() + Math.min(20, Number(a.timeout) || 10) * 1000;
        while (true) {
          let files = []; try { files = datasetFiles(ds, {}); } catch (e) {}
          const size = files.reduce((s, p) => s + S.container(ds.ls.target, ds.container).files[p].size, 0);
          if (files.length && size >= (Number(a.minimumSize) || 0)) return { exists: true, size, childItems: files.length };
          if (Date.now() > until) throw new Error(`Activity '${a.name}' timed out waiting for '${joinPath(ds.container, ds.folderPath, ds.fileName)}' (minimumSize ${a.minimumSize || 0} bytes). (Nimbus caps the timeout at 20 s; Azure allows up to 7 days.)`);
          await N.sleep(1000);
        }
      }
      case "ExecutePipeline": {
        const params = {};
        for (const [k, v] of Object.entries(a.parameters || {})) params[k] = E.resolve(v, ctx);
        const child = await runPipeline(f.__name, a.pipeline, params, { type: "PipelineActivity", name: run.pipeline + " → " + a.name }, { debug: run.debug, parentRunId: run.id });
        if (child.status !== "Succeeded") { const e = new Error(`Operation on target ${child.failedActivity || a.pipeline} failed: ${child.error}`); e.errorCode = child.errorCode || "2011"; throw e; }
        return { pipelineName: a.pipeline, pipelineRunId: child.id };
      }
      case "ExecuteDataFlow": {
        const df = snap.dataflows.find((d) => d.name === a.dataflow);
        if (!df) throw new Error(`Data flow '${a.dataflow}' was not found${run.debug ? "" : " in the published factory"}.`);
        const t0 = Date.now();
        run.note = "Acquiring Spark compute for the data flow (about 3–5 minutes on a cold Azure cluster; simulated here).";
        S.changed("runs");
        await N.sleep(1800);
        const scratch = new S.SQL.Database();
        N.registerSqlFunctions(scratch);
        try {
          const { sql, readInfo } = compileDataflow(df, snap, f, ctx, principal, scratch);
          let res;
          try { res = scratch.exec(sql); } catch (e) { throw new Error(`DF-Executor-Execution: ${N.__udfErr || e.message}`); }
          const st = scratch.prepare(sql); const columns = st.getColumnNames(); st.free();
          const rows = res.length ? res[0].values : [];
          const sink = resolveDataset(snap, f, { referenceName: df.sink.dataset, parameters: df.sink.parameters }, ctx);
          let written;
          if (sink.kind === "lake") {
            lakeCheck(sink, principal, "write");
            if (df.sink.clearFolder !== false) { const pre = sink.folderPath ? sink.folderPath.replace(/\/+$/, "") + "/" : ""; Object.keys(S.container(sink.ls.target, sink.container)?.files || {}).filter((p) => p.startsWith(pre) && !p.slice(pre.length).includes("/")).forEach((p) => S.deleteFile(sink.ls.target, sink.container, p)); }
            const name = df.sink.singleFileName || sink.fileName || `part-00000-${(crypto.randomUUID ? crypto.randomUUID() : N.uid())}-c000.${sink.type === "Json" ? "json" : "csv"}`;
            written = writeDataset(sink, { columns, rows }, { fileName: name }, ctx, principal);
          } else {
            const db = S.db(sink.ls.target);
            S.checkSqlNetwork(sink.ls.target, "azure");
            if (df.sink.tableAction === "recreate") { S.checkSqlAuth(principal, sink.ls.target, new Set(["ddl", "write"])); db.run(`DROP TABLE IF EXISTS ${N.qid(sink.table)}`); S.loadTable(db, sink.table, columns, rows, "overwrite"); written = { rowsCopied: rows.length }; S.markDb(sink.ls.target); }
            else { if (df.sink.tableAction === "truncate") { S.checkSqlAuth(principal, sink.ls.target, new Set(["ddl"])); try { db.run(`DELETE FROM ${N.qid(sink.table)}`); } catch (e) {} } written = writeDataset(sink, { columns, rows, textTyped: false }, { tableOption: "autoCreate" }, ctx, principal); }
          }
          return { runStatus: { metrics: { sink1: { rowsWritten: rows.length, sinkProcessingTime: Date.now() - t0, sources: { source1: { rowsRead: readInfo.rows.length } } } }, dsl: dataflowScript(df).join("\n") }, effectiveIntegrationRuntime: "AutoResolveIntegrationRuntime (General, 8 cores)", billingReference: { activityType: "executedataflow", billableDuration: [{ meterType: "General", duration: 0.044, unit: "coreHour" }] }, generatedSql: sql, sinkFiles: written.files };
        } finally { scratch.close(); }
      }
      case "IfCondition": {
        const v = E.resolve(a.expression, ctx);
        if (typeof v !== "boolean") throw new Error(`The expression '${a.expression}' must evaluate to a boolean; it returned ${JSON.stringify(v)} (${typeof v}).`);
        if (v) for (const inner of a.ifTrueActivities || []) await execActivity(f, snap, inner, ctx, run);
        return { ifExpressionResult: v };
      }
    }
    if (E.ACT[a.type]) return E.execLegacy(f, E.resolveDeep(clone(a), ctx), ctx);
    throw new Error(`Unknown activity type ${a.type}`);
  }

  /* ---------------- runner ---------------- */
  const running = new Set();
  async function runPipeline(facName, plName, params = {}, trigger = { type: "Manual", name: "Trigger now" }, opts = {}) {
    const f = S.state.factories[facName];
    if (!f) throw new Error(`Factory ${facName} not found`);
    f.__name = facName;
    const snap = snapshot(f, opts.debug);
    const pl = snap.pipelines.find((p) => p.name === plName);
    if (!pl) throw new Error(opts.debug ? `Pipeline ${plName} not found.` : `Pipeline '${plName}' has not been published. Trigger now and triggers run the published version: click Publish all first, or use Debug to run your draft.`);
    const run = { id: (crypto.randomUUID ? crypto.randomUUID() : N.uid()), factory: facName, pipeline: plName, status: "Queued", start: Date.now(), end: null, trigger, params: {}, activities: [], error: null, debug: !!opts.debug, parentRunId: opts.parentRunId || null };
    for (const p of pl.params || []) run.params[p.name] = params[p.name] !== undefined && params[p.name] !== "" ? params[p.name] : p.default ?? "";
    for (const k of Object.keys(params)) if (!(pl.params || []).some((p) => p.name === k)) run.params[k] = params[k];
    S.state.runs.unshift(run);
    S.state.runs.length = Math.min(S.state.runs.length, 300);
    S.changed("runs");
    running.add(facName + "/" + plName);
    const ctx = {
      pipeline: { parameters: run.params, RunId: run.id, TriggerTime: new Date(run.start).toISOString(), TriggerType: trigger.type, TriggerName: trigger.name, Pipeline: plName, DataFactory: facName, GroupId: run.id, TriggeredByPipelineRunId: opts.parentRunId || null },
      triggerBody: opts.triggerBody || {}, trigger: { startTime: new Date(run.start).toISOString() },
      variables: Object.fromEntries((pl.variables || []).map((v) => [v.name, v.default ?? ""])), outputs: {},
    };
    await N.sleep(300);
    run.status = "InProgress"; S.changed("runs");
    const acts = pl.activities || [];
    const status = {};
    const done = new Set();
    let guard = 0;
    while (done.size < acts.length && guard++ < 500) {
      let progressed = false;
      for (const a of acts) {
        if (done.has(a.name)) continue;
        const deps = a.dependsOn || [];
        if (!deps.every((d) => done.has(d.activity) || !acts.some((x) => x.name === d.activity))) continue;
        progressed = true;
        const ar = { name: a.name, type: a.type, status: "InProgress", start: Date.now(), end: null, input: null, output: null, error: null };
        run.activities.push(ar);
        const ok = deps.every((d) => {
          const st = status[d.activity];
          return (d.dependencyConditions || ["Succeeded"]).some((c) => c === "Completed" ? ["Succeeded", "Failed"].includes(st) : c === st);
        });
        if (!ok) { ar.status = "Skipped"; ar.end = Date.now(); status[a.name] = "Skipped"; done.add(a.name); S.changed("runs"); continue; }
        S.changed("runs");
        try {
          ar.input = clone(a);
          await N.sleep(200 + Math.random() * 300);
          ar.output = await execActivity(f, snap, a, ctx, run);
          ctx.outputs[a.name] = ar.output;
          ar.status = "Succeeded";
        } catch (e) {
          ar.status = "Failed";
          ar.error = { errorCode: e.errorCode || (/^ErrorCode=(\w+)/.exec(e.message) || [, "2200"])[1], message: e.message, failureType: e.failureType || (/AuthorizationPermissionMismatch|Login failed|not allowed to access|Invalid object|cannot be found|TypeConversion|Conversion failed|not found|is empty|required/.test(e.message) ? "UserError" : "SystemError"), target: a.name };
          ctx.outputs[a.name] = { error: ar.error };
        }
        ar.end = Date.now();
        status[a.name] = ar.status;
        done.add(a.name);
        S.changed("runs");
      }
      if (!progressed) break;
    }
    // ADF rule of thumb: a failure counts unless another activity handles it (depends on it with Failed/Completed and ran)
    const unhandled = run.activities.filter((x) => x.status === "Failed" && !acts.some((y) => (y.dependsOn || []).some((d) => d.activity === x.name && (d.dependencyConditions || []).some((c) => c === "Failed" || c === "Completed")) && status[y.name] && status[y.name] !== "Skipped"));
    if (unhandled.length) {
      run.status = "Failed";
      const fa = unhandled[0];
      run.failedActivity = fa.name;
      run.errorCode = fa.error.errorCode;
      run.error = `Operation on target ${fa.name} failed: ${fa.error.message}`;
    } else run.status = "Succeeded";
    run.end = Date.now();
    running.delete(facName + "/" + plName);
    if (!opts.parentRunId) {
      S.log(`Pipeline run${run.debug ? " (debug)" : ""}: ${plName}`, facName, run.status);
      if (!run.debug) S.notify(`Pipeline ${plName} ${run.status === "Succeeded" ? "succeeded" : "failed"}`, run.status === "Succeeded" ? `${run.activities.length} activities in ${N.fmtDur(run.end - run.start)} · ${trigger.name}` : run.error.slice(0, 300), run.status === "Succeeded" ? "success" : "error");
    }
    S.changed("runs");
    return run;
  }

  /* ---------------- triggers ---------------- */
  function triggerRun(facName, t, triggerBody, status, message) {
    S.state.triggerRuns = S.state.triggerRuns || [];
    S.state.triggerRuns.unshift({ id: N.uid("tr"), factory: facName, trigger: t.name, type: t.type, t: Date.now(), status, message, props: triggerBody });
    S.state.triggerRuns.length = Math.min(S.state.triggerRuns.length, 200);
  }
  function fireTrigger(facName, t, triggerBody) {
    const f = S.state.factories[facName];
    const pub = f.published;
    if (!pub || !pub.pipelines.some((p) => p.name === t.pipeline)) { triggerRun(facName, t, triggerBody, "Failed", `Pipeline ${t.pipeline} is not published.`); return; }
    const ctx = { pipeline: { TriggerTime: new Date().toISOString(), TriggerName: t.name, parameters: {} }, triggerBody: triggerBody || {}, trigger: { startTime: new Date().toISOString(), scheduledTime: new Date().toISOString() } };
    const params = {};
    try { for (const [k, v] of Object.entries(t.parameters || {})) params[k] = E.resolve(v, ctx); }
    catch (e) { triggerRun(facName, t, triggerBody, "Failed", e.message); S.notify(`Trigger ${t.name} failed`, e.message, "error"); return; }
    triggerRun(facName, t, triggerBody, "Succeeded", `Triggered ${t.pipeline}`);
    runPipeline(facName, t.pipeline, params, { type: t.type === "BlobEventsTrigger" ? "BlobEventsTrigger" : "ScheduleTrigger", name: t.name }, { triggerBody }).catch((e) => S.notify(`Trigger ${t.name} could not start ${t.pipeline}`, e.message, "error"));
  }
  function onBlobCreated(acct, cont, path, size) {
    for (const [facName, f] of Object.entries(S.state.factories)) {
      const pub = f.published;
      if (!pub) continue;
      for (const t of pub.triggers || []) {
        if (t.type !== "BlobEventsTrigger" || !t.enabled) continue;
        if (S.realStrict() && S.state.providers["Microsoft.EventGrid"] !== "Registered") continue;
        const ls = f.linked.find((l) => l.name === t.linkedService);
        const scopeAcct = t.storageAccount || (ls && ls.target);
        if (scopeAcct !== acct || t.container !== cont) continue;
        const pre = (t.blobPathBeginsWith || "").replace(/^\/+/, "");
        if (pre && !path.startsWith(pre)) continue;
        if (t.blobPathEndsWith && !path.endsWith(t.blobPathEndsWith)) continue;
        if (t.ignoreEmptyBlobs !== false && size === 0) continue;
        const slash = path.lastIndexOf("/");
        setTimeout(() => fireTrigger(facName, t, { fileName: path.slice(slash + 1), folderPath: cont + "/" + path.slice(0, Math.max(0, slash)), container: cont, account: acct, url: `https://${acct}.blob.core.windows.net/${cont}/${path}` }), 400);
      }
    }
  }
  setInterval(() => {
    const now = Date.now();
    for (const [facName, f] of Object.entries(S.state.factories)) {
      for (const t of (f.published && f.published.triggers) || []) {
        if (t.type !== "ScheduleTrigger" || !t.enabled) continue;
        const mult = { Minute: 60000, Hour: 3600000, Day: 86400000 }[t.frequency || "Minute"];
        const every = Math.max(1, Number(t.interval) || 15) * mult;
        if (!t.lastFired) { t.lastFired = now; continue; }
        if (now - t.lastFired >= every) { t.lastFired = now; S.save(); fireTrigger(facName, t, {}); }
      }
    }
  }, 10000);

  /* ---------------- ADF JSON export (real ARM / ADF Studio format) ---------------- */
  const dsRef = (r) => ({ referenceName: r.referenceName, type: "DatasetReference", ...(r.parameters && Object.keys(r.parameters).length ? { parameters: r.parameters } : {}) });
  const exprOrStr = (v) => (typeof v === "string" && v.startsWith("@") ? { value: v, type: "Expression" } : v);
  function activityJson(f, a) {
    const base = { name: a.name, type: a.type, dependsOn: (a.dependsOn || []).map((d) => ({ activity: d.activity, dependencyConditions: d.dependencyConditions || ["Succeeded"] })), userProperties: [] };
    const pol = { policy: { timeout: "0.12:00:00", retry: 0, retryIntervalInSeconds: 30, secureOutput: false, secureInput: false } };
    const ds = (n) => f.datasets.find((d) => d.name === n) || {};
    switch (a.type) {
      case "Copy": {
        const s = ds(a.inputs[0].referenceName), k = ds(a.outputs[0].referenceName);
        const source = s.type === "AzureSqlTable"
          ? { type: "AzureSqlSource", ...(a.source.sqlReaderQuery ? { sqlReaderQuery: exprOrStr(a.source.sqlReaderQuery) } : {}), queryTimeout: "02:00:00", partitionOption: "None" }
          : { type: s.type === "Json" ? "JsonSource" : "DelimitedTextSource", ...(a.source.additionalColumns && a.source.additionalColumns.length ? { additionalColumns: a.source.additionalColumns.map((c) => ({ name: c.name, value: c.value.startsWith("$$") ? c.value : exprOrStr(c.value) })) } : {}), storeSettings: { type: "AzureBlobFSReadSettings", recursive: a.source.recursive !== false, ...(a.source.wildcardFolderPath ? { wildcardFolderPath: exprOrStr(a.source.wildcardFolderPath) } : {}), ...(a.source.wildcardFileName ? { wildcardFileName: exprOrStr(a.source.wildcardFileName) } : {}), enablePartitionDiscovery: false }, formatSettings: { type: s.type === "Json" ? "JsonReadSettings" : "DelimitedTextReadSettings" } };
        const sink = k.type === "AzureSqlTable"
          ? { type: "AzureSqlSink", ...(a.sink.preCopyScript ? { preCopyScript: exprOrStr(a.sink.preCopyScript) } : {}), writeBehavior: "insert", sqlWriterUseTableLock: false, ...(a.sink.tableOption === "autoCreate" ? { tableOption: "autoCreate" } : {}), disableMetricsCollection: false }
          : { type: k.type === "Json" ? "JsonSink" : "DelimitedTextSink", storeSettings: { type: "AzureBlobFSWriteSettings" }, formatSettings: k.type === "Json" ? { type: "JsonWriteSettings" } : { type: "DelimitedTextWriteSettings", quoteAllText: true, fileExtension: ".csv" } };
        return { ...base, ...pol, typeProperties: { source, sink, enableStaging: false, translator: { type: "TabularTranslator", typeConversion: true, typeConversionSettings: { allowDataTruncation: (a.translator || {}).allowDataTruncation !== false, treatBooleanAsNumber: false } } }, inputs: [dsRef(a.inputs[0])], outputs: [dsRef(a.outputs[0])] };
      }
      case "Script": return { ...base, ...pol, linkedServiceName: { referenceName: a.linkedServiceName, type: "LinkedServiceReference" }, typeProperties: { scripts: (a.scripts || []).map((s) => ({ type: s.type, text: exprOrStr(s.text) })), scriptBlockExecutionTimeout: "02:00:00" } };
      case "SqlServerStoredProcedure": return { ...base, ...pol, linkedServiceName: { referenceName: a.linkedServiceName, type: "LinkedServiceReference" }, typeProperties: { storedProcedureName: `[dbo].[${a.storedProcedureName}]`, storedProcedureParameters: Object.fromEntries(Object.entries(a.storedProcedureParameters || {}).map(([k, v]) => [k, { value: exprOrStr(v.value), type: v.type || "String" }])) } };
      case "Lookup": { const d = ds(a.dataset.referenceName); return { ...base, ...pol, typeProperties: { source: d.type === "AzureSqlTable" ? { type: "AzureSqlSource", ...(a.sqlReaderQuery ? { sqlReaderQuery: exprOrStr(a.sqlReaderQuery) } : {}), queryTimeout: "02:00:00", partitionOption: "None" } : { type: "DelimitedTextSource", storeSettings: { type: "AzureBlobFSReadSettings", recursive: true }, formatSettings: { type: "DelimitedTextReadSettings" } }, dataset: dsRef(a.dataset), firstRowOnly: a.firstRowOnly !== false } }; }
      case "SetVariable": return { ...base, typeProperties: { variableName: a.variableName, value: exprOrStr(a.value) } };
      case "Validation": return { ...base, typeProperties: { dataset: dsRef(a.dataset), timeout: "0.12:00:00", sleep: 10, minimumSize: Number(a.minimumSize) || 0 } };
      case "Delete": return { ...base, ...pol, typeProperties: { dataset: dsRef(a.dataset), enableLogging: false, storeSettings: { type: "AzureBlobFSReadSettings", recursive: a.recursive !== false, ...(a.wildcardFileName ? { wildcardFileName: a.wildcardFileName } : {}), enablePartitionDiscovery: false } } };
      case "Wait": return { ...base, typeProperties: { waitTimeInSeconds: Number(a.waitTimeInSeconds) || 1 } };
      case "Fail": return { ...base, typeProperties: { message: exprOrStr(a.message), errorCode: exprOrStr(a.errorCode) } };
      case "ExecutePipeline": return { ...base, typeProperties: { pipeline: { referenceName: a.pipeline, type: "PipelineReference" }, waitOnCompletion: a.waitOnCompletion !== false, ...(Object.keys(a.parameters || {}).length ? { parameters: Object.fromEntries(Object.entries(a.parameters).map(([k, v]) => [k, exprOrStr(v)])) } : {}) } };
      case "ExecuteDataFlow": return { ...base, ...pol, typeProperties: { dataflow: { referenceName: a.dataflow, type: "DataFlowReference" }, compute: { coreCount: 8, computeType: "General" }, traceLevel: "Fine" } };
      case "IfCondition": return { ...base, typeProperties: { expression: { value: a.expression, type: "Expression" }, ifTrueActivities: (a.ifTrueActivities || []).map((x) => activityJson(f, x)) } };
    }
    return { ...base, type: a.type, note: "Legacy Nimbus v1 activity: not an ADF type." };
  }
  function toJson(facName, kind, name) {
    const f = S.state.factories[facName];
    if (kind === "pipelines") {
      const p = f.pipelines.find((x) => x.name === name);
      return { name: p.name, properties: { activities: p.activities.map((a) => activityJson(f, a)), ...(p.params && p.params.length ? { parameters: Object.fromEntries(p.params.map((x) => [x.name, { type: x.type || "string", ...(x.default !== undefined && x.default !== "" ? { defaultValue: x.default } : {}) }])) } : {}), ...(p.variables && p.variables.length ? { variables: Object.fromEntries(p.variables.map((v) => [v.name, { type: v.type || "String", ...(v.default ? { defaultValue: v.default } : {}) }])) } : {}), annotations: [] } };
    }
    if (kind === "datasets") {
      const d = f.datasets.find((x) => x.name === name);
      const tp = d.type === "AzureSqlTable" ? { schema: "dbo", table: exprOrStr(d.table) }
        : { location: { type: "AzureBlobFSLocation", ...(d.fileName ? { fileName: exprOrStr(d.fileName) } : {}), ...(d.folderPath ? { folderPath: exprOrStr(d.folderPath) } : {}), fileSystem: exprOrStr(d.container) }, ...(d.type === "DelimitedText" ? { columnDelimiter: d.columnDelimiter || ",", escapeChar: "\\", firstRowAsHeader: d.firstRowAsHeader !== false, quoteChar: '"' } : {}) };
      return { name: d.name, properties: { linkedServiceName: { referenceName: d.linkedServiceName, type: "LinkedServiceReference" }, ...(d.parameters && d.parameters.length ? { parameters: Object.fromEntries(d.parameters.map((p) => [p.name, { type: "string", ...(p.default ? { defaultValue: p.default } : {}) }])) } : {}), annotations: [], type: d.type, typeProperties: tp, schema: [] } };
    }
    if (kind === "linked") {
      const l = f.linked.find((x) => x.name === name);
      if (lsKind(l) === "lake") return { name: l.name, type: "Microsoft.DataFactory/factories/linkedservices", properties: { annotations: [], type: "AzureBlobFS", typeProperties: { url: `https://${l.target}.dfs.core.windows.net/` } } };
      const srv = S.serverOf(l.target);
      return { name: l.name, type: "Microsoft.DataFactory/factories/linkedservices", properties: { annotations: [], type: "AzureSqlDatabase", typeProperties: { server: srv ? S.fqdn(srv.name) : "", database: l.target, encrypt: "mandatory", trustServerCertificate: false, authenticationType: "SystemAssignedManagedIdentity" } } };
    }
    if (kind === "triggers") {
      const t = f.triggers.find((x) => x.name === name);
      const pipelines = [{ pipelineReference: { referenceName: t.pipeline, type: "PipelineReference" }, parameters: t.parameters || {} }];
      if (t.type === "ScheduleTrigger") return { name: t.name, properties: { annotations: [], runtimeState: t.enabled ? "Started" : "Stopped", pipelines, type: "ScheduleTrigger", typeProperties: { recurrence: { frequency: t.frequency || "Minute", interval: Number(t.interval) || 15, startTime: new Date(t.created || Date.now()).toISOString().slice(0, 19), timeZone: "UTC" } } } };
      const acct = S.res("storage", t.storageAccount || (f.linked.find((l) => l.name === t.linkedService) || {}).target);
      return { name: t.name, properties: { annotations: [], runtimeState: t.enabled ? "Started" : "Stopped", pipelines, type: "BlobEventsTrigger", typeProperties: { blobPathBeginsWith: `/${t.container}/blobs/${(t.blobPathBeginsWith || "").replace(/^\/+/, "")}`, ...(t.blobPathEndsWith ? { blobPathEndsWith: t.blobPathEndsWith } : {}), ignoreEmptyBlobs: t.ignoreEmptyBlobs !== false, scope: acct ? S.armId(acct) : "", events: ["Microsoft.Storage.BlobCreated"] } } };
    }
    if (kind === "dataflows") {
      const d = f.dataflows.find((x) => x.name === name);
      const rights = [...new Set((d.transforms || []).filter((t) => t.type === "join" || t.type === "exists").map((t) => t.rightDataset))];
      return { name: d.name, properties: { type: "MappingDataFlow", typeProperties: { sources: [{ dataset: { referenceName: d.source.dataset, type: "DatasetReference" }, name: "source1" }, ...rights.map((r) => ({ dataset: { referenceName: r, type: "DatasetReference" }, name: r }))], sinks: [{ dataset: { referenceName: d.sink.dataset, type: "DatasetReference" }, name: "sink1" }], transformations: (d.transforms || []).map((t, i) => ({ name: t.name || `${t.type}${i + 1}` })), scriptLines: dataflowScript(d) } } };
    }
  }

  N.adf = { ACTS, DS_TYPES, lsKind, newActivity, newDataset, newDataflow, validatePipeline, publish, unpublished, runPipeline, fireTrigger, onBlobCreated, toJson, resolveDataset, datasetFiles, ancestors, dataflowScript, snapshot, running };
  /* storage events come from the store */
  N.engine.onBlobCreated = (acct, cont, path) => { const c = S.container(acct, cont); onBlobCreated(acct, cont, path, c && c.files[path] ? c.files[path].size : 0); };
  N.engine.runPipeline = (facName, plName, params, trigger, opts) => runPipeline(facName, plName, params, trigger, opts);
  N.engine.fireTrigger = fireTrigger;
})(window.N);
