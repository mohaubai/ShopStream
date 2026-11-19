/* Nimbus Portal — original line icons (24×24, currentColor) */
(function (N) {
  const P = {
    menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
    home: '<path d="M4 11l8-7 8 7v9h-5v-6H9v6H4z"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    grid: '<rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><rect x="14" y="14" width="6" height="6" rx="1"/>',
    rg: '<path d="M7 4H4v16h3M17 4h3v16h-3"/><rect x="8.5" y="8.5" width="7" height="7" rx="1"/>',
    storage: '<rect x="4" y="5" width="16" height="4" rx="1"/><rect x="4" y="10" width="16" height="4" rx="1"/><rect x="4" y="15" width="16" height="4" rx="1"/><circle cx="7" cy="7" r=".6"/><circle cx="7" cy="12" r=".6"/><circle cx="7" cy="17" r=".6"/>',
    sql: '<ellipse cx="12" cy="6" rx="7" ry="2.5"/><path d="M5 6v12c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5V6"/><path d="M5 12c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5"/>',
    factory: '<path d="M3 20V10l5 3V10l5 3V6h3l1 4h3v10z"/><path d="M7 17h2M12 17h2M17 17h1"/>',
    workspace: '<rect x="5" y="3" width="14" height="18" rx="1.5"/><path d="M9 3v18M12 8h4M12 12h4M12 16h3"/>',
    monitor: '<path d="M3 12h4l2-5 4 10 2-5h6"/>',
    labs: '<path d="M2 9l10-5 10 5-10 5z"/><path d="M6 11v5c2 2 10 2 12 0v-5"/><path d="M21 9v6"/>',
    shell: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 9l3 3-3 3M12 15h5"/>',
    tutor: '<path d="M12 3l1.8 4.6L18 9l-4.2 1.4L12 15l-1.8-4.6L6 9l4.2-1.4z"/><path d="M18 15l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z"/>',
    bell: '<path d="M6 17V11a6 6 0 1112 0v6l1.5 2h-15z"/><path d="M10 21h4"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/>',
    search: '<circle cx="11" cy="11" r="6"/><path d="M20 20l-4.5-4.5"/>',
    close: '<path d="M6 6l12 12M18 6L6 18"/>',
    trash: '<path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13"/>',
    refresh: '<path d="M20 11a8 8 0 10-2.3 5.7"/><path d="M20 5v6h-6"/>',
    play: '<path d="M7 5l12 7-12 7z"/>',
    upload: '<path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 16v4h16v-4"/>',
    download: '<path d="M12 4v12M7 11l5 5 5-5"/><path d="M4 16v4h16v-4"/>',
    folder: '<path d="M3 6h6l2 2h10v11H3z"/>',
    file: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/>',
    table: '<rect x="3" y="5" width="18" height="14" rx="1"/><path d="M3 10h18M3 15h18M9 5v14"/>',
    save: '<path d="M5 4h11l3 3v13H5z"/><path d="M8 4v5h7V4M8 20v-6h8v6"/>',
    copy: '<rect x="8" y="8" width="12" height="12" rx="1"/><path d="M16 8V4H4v12h4"/>',
    code: '<path d="M9 7l-5 5 5 5M15 7l5 5-5 5"/>',
    check: '<path d="M5 12l4 4 10-10"/>',
    x: '<path d="M7 7l10 10M17 7L7 17"/>',
    chevron: '<path d="M9 6l6 6-6 6"/>',
    back: '<path d="M15 6l-6 6 6 6"/>',
    link: '<path d="M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1"/>',
    clock: '<circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/>',
    bolt: '<path d="M13 3L5 14h6l-1 7 8-11h-6z"/>',
    chart: '<path d="M4 20V4M4 20h16"/><rect x="7" y="12" width="3" height="6"/><rect x="12" y="8" width="3" height="10"/><rect x="17" y="14" width="3" height="4"/>',
    filter: '<path d="M4 5h16l-6 7v6l-4 2v-8z"/>',
    send: '<path d="M4 12l16-8-6 16-2-6z"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/>',
    copyact: '<rect x="3" y="7" width="7" height="10" rx="1"/><rect x="14" y="7" width="7" height="10" rx="1"/><path d="M10 12h4M12.5 10.5L14 12l-1.5 1.5"/>',
    script: '<path d="M6 3h9l3 3v15H6z"/><path d="M9 10l-2 2 2 2M15 10l2 2-2 2M13 9l-2 6"/>',
    flow: '<circle cx="5" cy="6" r="2"/><circle cx="5" cy="18" r="2"/><circle cx="19" cy="12" r="2"/><path d="M7 6c6 0 5 6 10 6M7 18c6 0 5-6 10-6"/>',
    shield: '<path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z"/><path d="M9 12l2 2 4-4"/>',
    wait: '<path d="M7 3h10M7 21h10M8 3c0 5 8 5 8 9s-8 4-8 9M16 3c0 5-8 5-8 9"/>',
    erase: '<path d="M4 17l9-9 6 6-6 6H8z"/><path d="M13 20h7"/>',
    trigger: '<circle cx="12" cy="12" r="8"/><path d="M12 7v5h4"/><path d="M3 4l3 2M21 4l-3 2"/>',
    key: '<circle cx="8" cy="15" r="4"/><path d="M11 12l9-9M16 7l3 3M14 9l2 2"/>',
    star: '<path d="M12 4l2.4 5 5.6.6-4.2 3.8 1.2 5.6L12 16.3 7 19l1.2-5.6L4 9.6 9.6 9z"/>',
    book: '<path d="M4 5c3-1 6-1 8 1 2-2 5-2 8-1v14c-3-1-6-1-8 1-2-2-5-2-8-1z"/><path d="M12 6v14"/>',
    expand: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
    collapse: '<path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/>',
    edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13 7l4 4"/>',
  };
  N.icon = (name, cls = "") =>
    `<svg class="ic ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] || P.file}</svg>`;

  /* Colored tile icons for resource types */
  N.typeMeta = {
    rg: { label: "Resource group", plural: "Resource groups", icon: "rg", hue: "var(--t-rg)" },
    storage: { label: "Storage account", plural: "Storage accounts", icon: "storage", hue: "var(--t-storage)", real: "Azure Storage account with hierarchical namespace (ADLS Gen2)" },
    sqlserver: { label: "SQL server", plural: "SQL servers", icon: "sql", hue: "var(--t-sqlsrv)", real: "Azure SQL logical server (Microsoft.Sql/servers)" },
    sqldb: { label: "SQL database", plural: "SQL databases", icon: "sql", hue: "var(--t-sql)", real: "Azure SQL Database (Microsoft.Sql/servers/databases)" },
    factory: { label: "Data factory", plural: "Data factories", icon: "factory", hue: "var(--t-factory)", real: "Azure Data Factory (Microsoft.DataFactory/factories)" },
    workspace: { label: "Databricks workspace", plural: "Databricks workspaces", icon: "workspace", hue: "var(--t-ws)", real: "Azure Databricks workspace (notebooks with Spark SQL)" },
  };
  N.tile = (type, size = "") => {
    const m = N.typeMeta[type] || { icon: "file", hue: "var(--muted)" };
    return `<span class="tile ${size}" style="--hue:${m.hue}">${N.icon(m.icon)}</span>`;
  };
})(window.N);
