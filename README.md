# Nimbus Portal · DE101

A browser replica of the Azure portal that behaves like Azure, with an MIT-style practical course in data engineering on top. Everything runs in your browser; nothing costs money.

## What "behaves like Azure" means

Strict realism mode (the default) reproduces the friction you meet in a real subscription:

- **Create forms** with the portal's tabs, defaults and rules: RA-GRS pre-selected, hierarchical namespace off on the Advanced tab, SQL server networking defaulting to *No access*, globally unique names.
- **Identity**: managed identities for data factories and Databricks workspaces; RBAC with the real role definitions. *Owner* and *Contributor* don't grant data access; you need *Storage Blob Data …* roles. Roles can be scoped to containers, and assignments take time to propagate.
- **Azure SQL**: a logical server with public network access, firewall rules (including `AllowAllWindowsAzureIps`), and a client-IP check in the query editor. You need a Microsoft Entra admin, Entra-only auth, contained users `FROM EXTERNAL PROVIDER`, fixed database roles and `GRANT EXECUTE`. Each layer fails with the error SQL Server or ADF would give.
- **T-SQL**, interpreted on SQLite:
  - Statements and batches: GO batches, statements without semicolons, variables, IF/WHILE, TRY/CATCH/THROW, transactions, stored procedures.
  - Queries and DDL: `TOP`/`OFFSET FETCH`, `SELECT … INTO` (keeps source types), `IDENTITY`, `MERGE` (must end with `;`), recursive CTEs, window functions, `INFORMATION_SCHEMA`.
  - Functions: `CAST`/`CONVERT`/`TRY_*` with styles and us_english date parsing, `DATEADD`/`DATEDIFF`/`FORMAT`, and SQL Server `ROUND`.
  - SQLite-only syntax (`LIMIT`, `CREATE TABLE AS`, `IFNULL`…) fails with SQL Server error numbers.
- **Data Factory Studio** (Home · Author · Monitor · Manage):
  - Building blocks: linked services (managed identity or account key) and parameterised datasets.
  - Activities: Copy (wildcards, `$$FILEPATH`, pre-copy script, auto-create as `nvarchar(max)`, name mapping, type-conversion errors), Script, Stored procedure, Lookup, Set variable, Validation, Delete, Wait, Execute Pipeline, If Condition + Fail, and Execute Data Flow.
  - Mapping data flows use the data flow expression language.
  - Runs: dependency conditions, **Debug vs Publish all**, and schedule and storage-event triggers (Event Grid provider registration, `/container/blobs/` paths).
  - Monitor shows ADF-shaped Input/Output/Error. You can export ADF JSON, the data flow script and the ARM template.
- **Databricks-style notebooks** in Spark SQL: `read_files('abfss://…', format => 'csv', header => true)`, `_c0` columns without a header, `_rescued_data`, struct dot notation, temp views, and `INSERT OVERWRITE DIRECTORY` writing part files plus `_SUCCESS`. Storage access is checked against the workspace identity.
- **Cloud Shell** with a working subset of the Azure CLI (`az group/storage/role/sql/datafactory/provider/databricks …`), `--query`, `-o tsv|table`, `$(…)` substitution, and `sqlcmd`.
- JSON View for every resource, and Bicep export for a resource group.

The in-app **Realism contract** page lists exactly what's identical, what's simulated and what's missing (no Python, Parquet/Delta, VNets or Key Vault, for example).

## The course

Ten practicals. Each has:

1. **Lecture notes**: precise, with the numbers and rules that matter.
2. **Pre-lab quiz** with explanations.
3. **Specification**: exact names, types and behaviours, like a lab handout.
4. **In real Azure**: portal click path, `az` CLI, T-SQL, ADF JSON or Bicep, gotchas, cost and teardown.
5. **Autograder**: inspects your real state and attacks your solution. It runs your published pipelines twice, drops duplicate and corrected files, injects malformed data and breaks permissions during incident drills.

| | Practical |
|---|---|
| P1 | The Azure resource model and a production-grade lake |
| P2 | Identity and access: control plane vs data plane |
| P3 | T-SQL for data engineers |
| P4 | Batch ingestion with Azure Data Factory |
| P5 | Dimensional modelling and ELT orchestration |
| P6 | Incremental, event-driven ingestion |
| P7 | Data quality gates and failure handling |
| P8 | Mapping data flows |
| P9 | Lakehouse notebooks with Spark SQL |
| P10 | Operations: incident response drills |

Grade = 85% practicals (best autograder score, minus 1 point per hint) + 15% quizzes.

The built-in **instructor** (sparkle icon) sees your practical, resources, permissions and last failure. It works when the portal is opened as a Claude artifact.

## Run locally

```bash
python3 -m http.server 8080
```

Open http://localhost:8080. The SQL engine (sql.js, ~1.3 MB) loads from jsDelivr. Work is saved in this browser's IndexedDB.

## Files

```
index.html / portal.html   entry points (portal.html is the artifact page)
css/portal.css             styles, light and dark
js/util.js icons.js datasets.js        helpers, icons, ShopStream sample data
js/tsql.js                 T-SQL interpreter, Spark SQL and data flow expression compilers
js/store.js                state, persistence, lake, RBAC, SQL networking and users
js/engine.js adf.js        pipeline expressions; Data Factory runtime, triggers, JSON export
js/app.js create.js        shell, routing, lists; create forms, ARM JSON, Bicep, subscription
js/views-*.js              storage, SQL, Data Factory Studio, notebooks, tutor
js/shell.js                Cloud Shell (az CLI subset)
js/course.js views-course.js   DE101 content, autograders, course UI
```
