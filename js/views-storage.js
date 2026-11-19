/* Nimbus Portal — lake storage account blades */
(function (N) {
  const S = N.store, esc = N.esc, I = N.icon;

  N.resourceTabs.storage = [
    { id: "overview", label: "Overview", icon: "info", render: overview },
    { group: "Data storage" },
    { id: "containers", label: "Containers", icon: "folder", render: containers, live: ["lake"] },
    { group: "Security + networking" },
    { id: "keys", label: "Access keys", icon: "key", render: keys },
  ];

  function stats(res) {
    const a = S.state.lake[res.name] || { containers: {} };
    let files = 0, bytes = 0;
    Object.values(a.containers).forEach((c) => Object.values(c.files).forEach((f) => { files++; bytes += f.size; }));
    return { containers: Object.keys(a.containers).length, files, bytes };
  }

  function overview(res) {
    const s = stats(res);
    return {
      html: `<div class="blade">${N.overview(res, [
        ["Performance", esc(res.props.performance || "Standard")],
        ["Redundancy", esc(res.props.redundancy || "LRS")],
        ["Hierarchical namespace", res.props.hns ? "Enabled" : `Disabled <small class="muted">(not a data lake)</small>`],
        ["Lake endpoint", `<code>lake://${esc(res.name)}/</code>`],
        ["Containers", s.containers], ["Files", s.files], ["Used capacity", N.fmtBytes(s.bytes)],
      ], `<p>Paths in this sandbox look like <code>lake://${esc(res.name)}/&lt;container&gt;/&lt;folder&gt;/&lt;file&gt;</code>. In Azure the same file would be <code>abfss://&lt;container&gt;@${esc(res.name)}.dfs.core.windows.net/&lt;folder&gt;/&lt;file&gt;</code>.</p>`)}
        <div class="btn-row"><button class="btn btn-primary" data-go='${esc(JSON.stringify({ view: "resource", id: res.id, tab: "containers" }))}'>Open containers</button></div></div>`,
      mount: (root) => N.mountOverview(root, res),
    };
  }

  function keys(res) {
    const fake = btoa(res.name + "-learning-only-key-" + res.id).replace(/=/g, "");
    return {
      html: `<div class="blade"><div class="blade-head"><h1>Access keys</h1></div>
        <div class="callout callout-warn">${I("info")} These keys are fake. In a real cloud, an account key grants full control of every file, so treat it like a root password.</div>
        <table class="kv"><tr><th>Storage account name</th><td><code>${esc(res.name)}</code></td></tr><tr><th>key1</th><td><code>${esc(fake.slice(0, 12))}••••••••••••••••••••</code></td></tr>
        <tr><th>Connection string</th><td><code>DefaultEndpointsProtocol=https;AccountName=${esc(res.name)};AccountKey=••••••;EndpointSuffix=nimbus.local</code></td></tr></table>
        <div class="learn-card">${I("shield")}<div><b>Better than keys</b><p>Production pipelines avoid account keys. They use a <b>managed identity</b> (an identity the cloud gives the pipeline service) plus role assignments such as <i>Storage Blob Data Contributor</i> on one container. Secrets that must exist live in a <b>key vault</b>, and linked services reference the vault, never the raw value.</p></div></div></div>`,
    };
  }

  /* ---------------- containers ---------------- */
  function containers(res, r) {
    const acct = S.state.lake[res.name];
    if (r.cont && acct.containers[r.cont]) return browser(res, r);
    const list = Object.entries(acct.containers);
    return {
      html: `<div class="blade"><div class="blade-head"><h1>Containers</h1><p class="muted">Top-level folders of the lake. Many teams use one per zone: bronze, silver, gold.</p></div>
        ${N.cmdbar([{ icon: "plus", label: "Container", id: "new-cont" }, { icon: "refresh", label: "Refresh", id: "refresh" }])}
        ${list.length ? `<div class="table-wrap"><table class="list"><thead><tr><th>Name</th><th>Files</th><th>Size</th><th>Last modified</th><th></th></tr></thead><tbody>
          ${list.map(([name, c]) => { const fs = Object.values(c.files); return `<tr><td><button class="link res-link" data-go='${esc(JSON.stringify({ view: "resource", id: res.id, tab: "containers", cont: name, prefix: "" }))}'><span class="nav-ic">${I("folder")}</span><span>${esc(name)}</span></button></td><td>${fs.length}</td><td>${N.fmtBytes(fs.reduce((a, f) => a + f.size, 0))}</td><td class="muted">${N.fmtTime(Math.max(c.created, ...fs.map((f) => f.modified)))}</td><td class="right"><button class="icon-btn" data-del="${esc(name)}" aria-label="Delete container ${esc(name)}">${I("trash")}</button></td></tr>`; }).join("")}
        </tbody></table></div>` : `<div class="empty"><p>No containers yet. Create <code>bronze</code>, <code>silver</code> and <code>gold</code> to follow the labs.</p><button class="btn btn-primary" id="new-cont2">+ Container</button> <button class="btn" id="medallion">Create bronze, silver, gold</button></div>`}</div>`,
      mount(root) {
        const create = () => N.modal({
          title: "New container",
          body: `<div class="field"><label for="cn">Name</label><input id="cn" placeholder="bronze" autocomplete="off"><small class="muted">3–63 characters: lowercase letters, digits and dashes.</small></div>`,
          actions: [{ label: "Create", kind: "primary", onClick: (c, w) => {
            const v = w.querySelector("#cn").value.trim();
            if (!/^[a-z0-9](?!.*--)[a-z0-9-]{1,61}[a-z0-9]$/.test(v)) { N.toast("Use 3–63 lowercase letters, digits or single dashes.", "error"); return false; }
            if (!S.createContainer(res.name, v)) { N.toast("That container already exists.", "error"); return false; }
            N.toast(`Created container ${v}`, "success");
          } }, { label: "Cancel" }],
          onMount: (w, close) => w.querySelector("#cn").addEventListener("keydown", (e) => { if (e.key === "Enter") w.querySelector(".btn-primary").click(); }),
        });
        root.querySelector("#new-cont").onclick = create;
        const c2 = root.querySelector("#new-cont2"); if (c2) c2.onclick = create;
        const md = root.querySelector("#medallion"); if (md) md.onclick = () => { ["bronze", "silver", "gold"].forEach((c) => S.createContainer(res.name, c)); N.toast("Created bronze, silver and gold", "success"); };
        root.querySelector("#refresh").onclick = () => N.rerender();
        root.querySelectorAll("[data-del]").forEach((b) => b.onclick = async () => {
          const name = b.dataset.del;
          if (await N.confirmDialog(`Delete container ${name}`, `All ${Object.keys(acct.containers[name].files).length} files inside will be deleted.`)) { S.deleteContainer(res.name, name); N.toast(`Deleted ${name}`, "success"); }
        });
      },
    };
  }

  function browser(res, r) {
    const c = S.container(res.name, r.cont);
    const prefix = r.prefix || "";
    const folders = new Set(), files = [];
    for (const [p, f] of Object.entries(c.files)) {
      if (!p.startsWith(prefix)) continue;
      const rest = p.slice(prefix.length);
      const i = rest.indexOf("/");
      if (i >= 0) folders.add(rest.slice(0, i)); else files.push([p, f]);
    }
    (c.folders || []).forEach((p) => { if (p.startsWith(prefix)) { const rest = p.slice(prefix.length).split("/")[0]; if (rest) folders.add(rest); } });
    const parts = prefix.split("/").filter(Boolean);
    const crumbRoute = (i) => ({ view: "resource", id: res.id, tab: "containers", cont: r.cont, prefix: i < 0 ? "" : parts.slice(0, i + 1).join("/") + "/" });
    return {
      live: ["lake"],
      crumbs: [{ label: r.cont, route: crumbRoute(-1) }],
      html: `<div class="blade">
        <div class="path-bar"><button class="link" data-go='${esc(JSON.stringify({ view: "resource", id: res.id, tab: "containers" }))}'>Containers</button><span class="sep">/</span><button class="link" data-go='${esc(JSON.stringify(crumbRoute(-1)))}'>${esc(r.cont)}</button>${parts.map((p, i) => `<span class="sep">/</span><button class="link" data-go='${esc(JSON.stringify(crumbRoute(i)))}'>${esc(p)}</button>`).join("")}
          <button class="icon-btn copy-path" id="copy-uri" title="Copy lake path" aria-label="Copy lake path">${I("copy")}</button></div>
        ${N.cmdbar([{ icon: "upload", label: "Upload", id: "upl" }, { icon: "plus", label: "Add directory", id: "mkdir" }, { icon: "file", label: "New file", id: "newfile" }, { icon: "star", label: "Add sample data", id: "sample" }, "|", { icon: "refresh", label: "Refresh", id: "refresh" }])}
        <input type="file" id="file-in" multiple hidden accept=".csv,.json,.jsonl,.txt,.tsv,.ndjson,.sql,.md">
        <div class="dropzone" id="drop">
          ${folders.size || files.length ? `<div class="table-wrap"><table class="list"><thead><tr><th>Name</th><th>Modified</th><th>Size</th><th>Origin</th><th></th></tr></thead><tbody>
            ${parts.length ? `<tr><td colspan="5"><button class="link res-link" data-go='${esc(JSON.stringify(crumbRoute(parts.length - 2)))}'><span class="nav-ic">${I("back")}</span><span>..</span></button></td></tr>` : ""}
            ${[...folders].sort().map((f) => `<tr><td><button class="link res-link" data-go='${esc(JSON.stringify({ ...crumbRoute(-1), prefix: prefix + f + "/" }))}'><span class="nav-ic">${I("folder")}</span><span>${esc(f)}</span></button></td><td></td><td></td><td class="muted">Directory</td><td></td></tr>`).join("")}
            ${files.sort().map(([p, f]) => `<tr><td><button class="link res-link" data-open="${esc(p)}"><span class="nav-ic">${I("file")}</span><span>${esc(p.slice(prefix.length))}</span></button></td><td class="muted">${N.fmtTime(f.modified)}</td><td>${N.fmtBytes(f.size)}</td><td class="muted">${esc(f.source || "upload")}</td><td class="right"><button class="icon-btn" data-delf="${esc(p)}" aria-label="Delete ${esc(p)}">${I("trash")}</button></td></tr>`).join("")}
          </tbody></table></div>` : `<div class="empty"><p>This ${prefix ? "folder" : "container"} is empty. Drop files here, upload, or add a sample dataset.</p></div>`}
          <div class="drop-hint">Drop CSV or JSON files to upload into <code>${esc(r.cont + "/" + prefix)}</code></div>
        </div></div>`,
      mount(root) {
        const fileIn = root.querySelector("#file-in");
        const upload = async (list) => {
          let n = 0;
          for (const f of list) {
            if (f.size > 8 * 1024 * 1024) { N.toast(`${f.name} is over 8 MiB, which this browser sandbox cannot hold comfortably.`, "error"); continue; }
            const text = await f.text();
            S.putFile(res.name, r.cont, prefix + f.name, text, { source: "upload" });
            n++;
          }
          if (n) N.toast(`Uploaded ${n} file${n > 1 ? "s" : ""}`, "success");
        };
        root.querySelector("#upl").onclick = () => fileIn.click();
        fileIn.onchange = () => upload([...fileIn.files]);
        const dz = root.querySelector("#drop");
        dz.addEventListener("dragover", (e) => { e.preventDefault(); dz.classList.add("over"); });
        dz.addEventListener("dragleave", () => dz.classList.remove("over"));
        dz.addEventListener("drop", (e) => { e.preventDefault(); dz.classList.remove("over"); upload([...e.dataTransfer.files]); });
        root.querySelector("#refresh").onclick = () => N.rerender();
        root.querySelector("#copy-uri").onclick = () => copy(`lake://${res.name}/${r.cont}/${prefix}`);
        root.querySelector("#mkdir").onclick = () => N.modal({
          title: "Add directory", body: `<div class="field"><label for="dn">Directory name</label><input id="dn" placeholder="orders" autocomplete="off"></div>`,
          actions: [{ label: "Save", kind: "primary", onClick: (cl, w) => {
            const v = w.querySelector("#dn").value.trim().replace(/^\/+|\/+$/g, "");
            if (!v || /[\\:*?"<>|]/.test(v)) { N.toast("Enter a valid directory name.", "error"); return false; }
            c.folders = c.folders || []; c.folders.push(prefix + v + "/"); S.changed("lake");
          } }, { label: "Cancel" }],
        });
        root.querySelector("#newfile").onclick = () => N.modal({
          title: "New file", wide: true,
          body: `<div class="field"><label for="fn">File name</label><input id="fn" placeholder="notes.csv" autocomplete="off"></div><div class="field"><label for="fc">Content</label><textarea id="fc" class="code" rows="10" placeholder="id,name&#10;1,Alpha"></textarea></div>`,
          actions: [{ label: "Save", kind: "primary", onClick: (cl, w) => {
            const name = w.querySelector("#fn").value.trim();
            if (!name) { N.toast("Enter a file name.", "error"); return false; }
            S.putFile(res.name, r.cont, prefix + name.replace(/^\/+/, ""), w.querySelector("#fc").value, { source: "editor" });
            N.toast(`Saved ${name}`, "success");
          } }, { label: "Cancel" }],
        });
        root.querySelector("#sample").onclick = () => N.modal({
          title: "Add sample data", wide: true,
          body: `<p class="muted">Files are added under <code>${esc(r.cont)}/${esc(prefix)}shopstream/…</code>. Storage event triggers fire for each file.</p><div class="sample-list">${N.sampleCatalog.map((d) => `<label class="sample-item"><input type="checkbox" value="${d.id}" ${d.id !== "shopstream-dirty" ? "checked" : ""}><div><b>${esc(d.name)}</b><p>${esc(d.desc)}</p></div></label>`).join("")}</div>`,
          actions: [{ label: "Add", kind: "primary", onClick: (cl, w) => {
            const ids = [...w.querySelectorAll("input:checked")].map((x) => x.value);
            let n = 0;
            ids.forEach((id) => N.sampleCatalog.find((d) => d.id === id).files().forEach((f) => { S.putFile(res.name, r.cont, prefix + f.path, f.content, { source: "sample" }); n++; }));
            N.toast(`Added ${n} files`, "success");
          } }, { label: "Cancel" }],
        });
        root.querySelectorAll("[data-open]").forEach((b) => (b.onclick = () => preview(res.name, r.cont, b.dataset.open)));
        root.querySelectorAll("[data-delf]").forEach((b) => (b.onclick = async () => {
          if (await N.confirmDialog("Delete file", `Delete <code>${esc(b.dataset.delf)}</code>?`)) S.deleteFile(res.name, r.cont, b.dataset.delf);
        }));
      },
    };
  }

  function copy(text) {
    try { navigator.clipboard.writeText(text).then(() => N.toast("Copied " + text, "success"), () => N.toast(text, "info", 6000)); }
    catch (e) { N.toast(text, "info", 6000); }
  }
  N.copyText = copy;

  function preview(acct, cont, path) {
    S.flag("preview");
    const f = S.container(acct, cont).files[path];
    const uri = S.lakeUri(acct, cont, path);
    let data = null, err = null;
    try { data = S.formatOf(path) === "json" ? N.parseJSONData(f.content) : N.parseCSV(f.content); } catch (e) { err = e.message; }
    const fn = S.formatOf(path) === "json" ? "read_json" : "read_csv";
    const sqldbs = S.resOfType("sqldb");
    N.modal({
      title: path.split("/").pop(), wide: true,
      body: `<div class="kv-inline"><span><b>Path</b> <code>${esc(uri)}</code></span><span><b>Size</b> ${N.fmtBytes(f.size)}</span>${data ? `<span><b>Rows</b> ${data.rows.length}</span><span><b>Columns</b> ${data.columns.length}</span>` : ""}</div>
        <div class="tabs small"><button class="tab active" data-pt="grid">Preview</button><button class="tab" data-pt="schema">Schema</button><button class="tab" data-pt="raw">Raw / edit</button></div>
        <div data-pp="grid">${err ? `<div class="callout callout-error">Could not parse: ${esc(err)}</div>` : N.grid(data.columns, data.rows, { max: 200 })}</div>
        <div data-pp="schema" hidden>${data ? `<table class="list"><thead><tr><th>Column</th><th>Inferred type</th><th>Nulls / empty</th><th>Example</th></tr></thead><tbody>${data.columns.map((c) => { const vals = data.rows.map((x) => x[c]); return `<tr><td><code>${esc(c)}</code></td><td>${N.inferType(vals)}</td><td>${vals.filter((v) => v === "" || v == null).length}</td><td class="muted">${esc(String(vals.find((v) => v !== "" && v != null) ?? ""))}</td></tr>`; }).join("")}</tbody></table><p class="muted">Types are inferred from values: CSV has no types of its own.</p>` : ""}</div>
        <div data-pp="raw" hidden><textarea class="code" id="raw-edit" rows="16" spellcheck="false">${esc(f.content.length > 300000 ? f.content.slice(0, 300000) : f.content)}</textarea>${f.content.length > 300000 ? `<p class="muted">Large file: editing is disabled.</p>` : ""}</div>
        <div class="snippet"><b>Query it with SQL</b><pre>SELECT * FROM ${fn}('${esc(uri)}') LIMIT 100;</pre></div>`,
      actions: [
        sqldbs.length ? { label: "Open in query editor", kind: "primary", onClick: () => { N.pendingQuery = `SELECT *\nFROM ${fn}('${uri}')\nLIMIT 100;`; N.go({ view: "resource", id: sqldbs[0].id, tab: "query" }); } } : null,
        { label: "Save edits", onClick: (cl, w) => { if (f.content.length > 300000) return; S.putFile(acct, cont, path, w.querySelector("#raw-edit").value, { source: "editor" }); N.toast("Saved", "success"); } },
        { label: "Close" },
      ].filter(Boolean),
      onMount(w) {
        w.querySelectorAll("[data-pt]").forEach((t) => (t.onclick = () => {
          w.querySelectorAll("[data-pt]").forEach((x) => x.classList.toggle("active", x === t));
          w.querySelectorAll("[data-pp]").forEach((p) => (p.hidden = p.dataset.pp !== t.dataset.pt));
        }));
      },
    });
  }
  N.previewFile = preview;
})(window.N);
