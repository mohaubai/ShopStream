/* Nimbus Portal — lake storage account blades */
(function (N) {
  const S = N.store, esc = N.esc, I = N.icon;

  N.resourceTabs.storage = [
    { id: "overview", label: "Overview", icon: "info", render: overview },
    { id: "iam", label: "Access control (IAM)", icon: "key", render: iam, live: ["iam"] },
    { group: "Data storage" },
    { id: "containers", label: "Containers", icon: "folder", render: containers, live: ["lake", "iam"] },
    { group: "Security + networking" },
    { id: "keys", label: "Access keys", icon: "key", render: keys },
    { group: "Settings" },
    { id: "config", label: "Configuration", icon: "gear", render: config },
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
        ["Replication", esc(String(res.props.redundancy || "LRS").replace("Standard_", ""))],
        ["Account kind", "StorageV2 (general purpose v2)"],
        ["Hierarchical namespace", res.props.hns ? "Enabled" : `Disabled <small class="muted">(not a data lake: no directories, no ACLs)</small>`],
        ["Data Lake Storage endpoint", `<code>https://${esc(res.name)}.dfs.core.windows.net/</code>`],
        ["Minimum TLS version", esc(String(res.props.minTls || "TLS1_2").replace("TLS", "").replace("_", "."))],
        ["Storage account key access", res.props.allowSharedKey === false ? "Disabled" : "Enabled"],
        ["Containers", s.containers], ["Files", s.files], ["Used capacity", N.fmtBytes(s.bytes)],
      ], `<p>Spark and Databricks address files as <code>abfss://&lt;container&gt;@${esc(res.name)}.dfs.core.windows.net/&lt;folder&gt;/&lt;file&gt;</code>. Both that form and the short <code>lake://${esc(res.name)}/&lt;container&gt;/…</code> work in Nimbus notebooks.</p>`)}
        <div class="btn-row"><button class="btn btn-primary" data-go='${esc(JSON.stringify({ view: "resource", id: res.id, tab: "containers" }))}'>Open containers</button></div></div>`,
      mount: (root) => N.mountOverview(root, res),
    };
  }

  function iam(res, r) {
    const scopeAcct = S.armId(res);
    const list = S.state.roles.filter((a) => a.scope === scopeAcct || a.scope.startsWith(scopeAcct + "/"));
    const inherited = [{ principal: "learner@nimbuslearn.onmicrosoft.com", type: "User", role: "Owner", scope: "Subscription (Inherited)" }];
    return {
      html: `<div class="blade"><div class="blade-head"><h1>Access control (IAM)</h1><p class="muted">Azure RBAC: a <b>role</b> (what), a <b>principal</b> (who) and a <b>scope</b> (where). Data roles (Storage Blob Data …) control reading and writing files; Owner and Contributor only manage the resource.</p></div>
        ${N.cmdbar([{ icon: "plus", label: "Add role assignment", id: "add-ra" }, { icon: "check", label: "Check access", id: "check" }])}
        <div class="tabs"><span class="tab active">Role assignments</span></div>
        <div class="table-wrap"><table class="list"><thead><tr><th>Name</th><th>Type</th><th>Role</th><th>Scope</th><th>Condition</th><th></th></tr></thead><tbody>
          ${list.map((a) => { const pend = Date.now() - a.created < 8000; return `<tr><td>${I(a.principalType === "User" ? "key" : "factory")} ${esc(a.principal)}</td><td>${a.principalType === "User" ? "User" : "App (managed identity)"}</td><td><b>${esc(a.role)}</b> <small class="muted">${S.ROLE_DEFS[a.role].plane === "data" ? "data plane" : "control plane"}</small></td><td>${a.scope === scopeAcct ? "This resource" : `Container: ${esc(a.scope.split("/").pop())}`}${pend ? ` <span class="pill pill-run">propagating</span>` : ""}</td><td class="muted">None</td><td><button class="icon-btn" data-del="${a.id}" aria-label="Remove role assignment">${I("trash")}</button></td></tr>`; }).join("")}
          ${inherited.map((a) => `<tr><td>${I("key")} ${esc(a.principal)}</td><td>${a.type}</td><td><b>${a.role}</b> <small class="muted">control plane</small></td><td class="muted">${a.scope}</td><td class="muted">None</td><td></td></tr>`).join("")}
        </tbody></table></div>
        <div class="snippet"><b>Azure CLI equivalent</b><pre>az role assignment create \
  --assignee-object-id $(az datafactory show -g ${esc(res.rg)} -n &lt;factory&gt; --query identity.principalId -o tsv) \
  --assignee-principal-type ServicePrincipal \
  --role "Storage Blob Data Contributor" \
  --scope ${esc(scopeAcct)}</pre></div></div>`,
      mount(root) {
        root.querySelector("#add-ra").onclick = () => addRole(res);
        root.querySelectorAll("[data-del]").forEach((b) => (b.onclick = async () => { if (await N.confirmDialog("Remove role assignment", "The principal loses this access (after propagation).", "Remove")) S.removeRole(b.dataset.del); }));
        root.querySelector("#check").onclick = () => {
          const ps = [...S.resOfType("factory"), ...S.resOfType("workspace")].map((x) => x.name).concat(["learner@nimbuslearn.onmicrosoft.com"]);
          const conts = Object.keys(S.state.lake[res.name].containers);
          N.modal({ title: "Check access", wide: true, body: `<p class="muted">Effective data-plane access per container (after propagation).</p><div class="table-wrap"><table class="list"><thead><tr><th>Principal</th>${conts.map((c) => `<th>${esc(c)}</th>`).join("")}</tr></thead><tbody>${ps.map((p) => `<tr><td>${esc(p)}</td>${conts.map((c) => { const x = S.lakeRights(p, res.name, c); return `<td>${x.write ? "Read/Write" : x.read ? "Read" : x.pending ? "Pending" : "<span class='muted'>None</span>"}</td>`; }).join("")}</tr>`).join("")}</tbody></table></div>`, actions: [{ label: "Close" }] });
        };
      },
    };
  }
  function addRole(res) {
    const principals = [...S.resOfType("factory").map((x) => ({ name: x.name, kind: "Data Factory" })), ...S.resOfType("workspace").map((x) => ({ name: x.name, kind: "Databricks workspace" })), { name: "learner@nimbuslearn.onmicrosoft.com", kind: "User" }];
    const conts = Object.keys(S.state.lake[res.name].containers);
    N.modal({
      title: "Add role assignment", wide: true,
      body: `<div class="tabs small"><span class="tab active">Role</span><span class="tab">Members</span><span class="tab">Review + assign</span></div>
        <div class="field"><label>Role</label><div class="role-list">${Object.entries(S.ROLE_DEFS).map(([k, v], i) => `<label class="sample-item"><input type="radio" name="role" value="${esc(k)}" ${k === "Storage Blob Data Contributor" ? "checked" : ""}><div><b>${esc(k)}</b> <span class="pill ${v.plane === "data" ? "pill-ok" : "pill-muted"}">${v.plane === "data" ? "Job function · data" : "Privileged administrator"}</span><p>${esc(v.desc)}</p></div></label>`).join("")}</div></div>
        <div class="field"><label for="ra-p">Assign access to · Members</label><select id="ra-p">${principals.map((p) => `<option value="${esc(p.name)}" data-type="${p.kind === "User" ? "User" : "ManagedIdentity"}">${esc(p.name)} (${esc(p.kind === "User" ? "User" : "Managed identity · " + p.kind)})</option>`).join("")}</select></div>
        <div class="field"><label for="ra-s">Scope</label><select id="ra-s"><option value="">Storage account: ${esc(res.name)}</option>${conts.map((c) => `<option value="${esc(c)}">Container: ${esc(c)}</option>`).join("")}</select><small class="muted">Least privilege: scope to the containers a principal really needs.</small></div>`,
      actions: [{ label: "Review + assign", kind: "primary", onClick: (c, w) => {
        const role = w.querySelector("input[name=role]:checked").value, sel = w.querySelector("#ra-p"), p = sel.value, type = sel.selectedOptions[0].dataset.type, cont = w.querySelector("#ra-s").value;
        const scope = cont ? S.containerScope(res.name, cont) : S.armId(res);
        if (!S.assignRole(p, type, role, scope)) { N.toast("That role assignment already exists.", "error"); return false; }
        N.toast(`Added ${role} for ${p}. It can take a few minutes to take effect in Azure.`, "success", 5000);
      } }, { label: "Cancel" }],
    });
  }
  function config(res) {
    const p = res.props;
    return {
      html: `<div class="blade"><div class="blade-head"><h1>Configuration</h1></div><div class="form">
        <div class="field"><label>Secure transfer required</label><div class="radios"><label><input type="radio" checked disabled> Enabled</label></div></div>
        <div class="field"><label>Allow Blob anonymous access</label><div class="radios"><label><input type="radio" name="anon" value="1" ${p.allowBlobPublic ? "checked" : ""}> Enabled</label><label><input type="radio" name="anon" value="0" ${!p.allowBlobPublic ? "checked" : ""}> Disabled</label></div></div>
        <div class="field"><label>Allow storage account key access</label><div class="radios"><label><input type="radio" name="key" value="1" ${p.allowSharedKey !== false ? "checked" : ""}> Enabled</label><label><input type="radio" name="key" value="0" ${p.allowSharedKey === false ? "checked" : ""}> Disabled</label></div><small class="muted">Disabled forces Microsoft Entra ID for everyone, including the portal.</small></div>
        <div class="field"><label for="tls">Minimum TLS version</label><select id="tls">${["TLS1_0", "TLS1_1", "TLS1_2"].map((v) => `<option value="${v}" ${(p.minTls || "TLS1_2") === v ? "selected" : ""}>Version ${v.slice(3).replace("_", ".")}</option>`).join("")}</select></div>
        <div class="field"><label>Hierarchical namespace</label><input value="${p.hns ? "Enabled" : "Disabled"}" disabled>${p.hns ? "" : `<button class="btn btn-sm" id="upgrade">Upgrade to Data Lake Storage Gen2</button><small class="muted">A one-way upgrade. It can't be undone.</small>`}</div>
        <div class="btn-row"><button class="btn btn-primary" id="save">Save</button></div></div></div>`,
      mount(root) {
        root.querySelector("#save").onclick = () => { p.allowBlobPublic = root.querySelector("input[name=anon]:checked").value === "1"; p.allowSharedKey = root.querySelector("input[name=key]:checked").value === "1"; p.minTls = root.querySelector("#tls").value; S.log("Update storage account", res.name); S.changed("resource"); N.toast("Saved", "success"); };
        const up = root.querySelector("#upgrade"); if (up) up.onclick = async () => { if (await N.confirmDialog("Upgrade to Data Lake Storage Gen2", "Enable hierarchical namespace? This is irreversible.", "Upgrade", "primary")) { p.hns = true; S.log("Enable hierarchical namespace", res.name); S.changed("resource"); N.rerender(); } };
      },
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
    if (S.realStrict() && res.props.allowSharedKey === false && !S.lakeRights("learner@nimbuslearn.onmicrosoft.com", res.name, r.cont).read) {
      return { crumbs: [{ label: r.cont, route: r }], html: `<div class="blade"><div class="path-bar"><button class="link" data-go='${esc(JSON.stringify({ view: "resource", id: res.id, tab: "containers" }))}'>Containers</button><span class="sep">/</span>${esc(r.cont)}</div><div class="kv-inline"><span><b>Authentication method:</b> Microsoft Entra user account</span></div><div class="callout callout-error"><b>You do not have permissions to list the data using your user account with Microsoft Entra ID.</b><p>This storage account has key access disabled, so the portal signs in as you. Owner on the subscription manages the account but doesn't grant data access. Assign yourself <b>Storage Blob Data Contributor</b> on this account in Access control (IAM).</p><button class="btn btn-sm" data-go='${esc(JSON.stringify({ view: "resource", id: res.id, tab: "iam" }))}'>Open Access control (IAM)</button></div></div>` };
    }
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
        <div class="snippet"><b>Read it in a Databricks-style notebook (Spark SQL)</b><pre>SELECT * FROM read_files('abfss://${esc(cont)}@${esc(acct)}.dfs.core.windows.net/${esc(path)}', format => '${S.formatOf(path)}'${S.formatOf(path) === "csv" ? ", header => true" : ""});</pre><b>Copy it to your machine (AzCopy)</b><pre>azcopy copy 'https://${esc(acct)}.dfs.core.windows.net/${esc(cont)}/${esc(path)}' './${esc(path.split("/").pop())}'</pre></div>`,
      actions: [

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
