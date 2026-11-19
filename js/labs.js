/* Nimbus Portal — guided labs. Each step has a live check against your portal state. */
(function (N) {
  const S = N.store;
  const st = () => S.state;
  const containers = () => Object.entries(st().lake).flatMap(([acct, a]) => Object.entries(a.containers).map(([name, c]) => ({ acct, name, c })));
  const cont = (name) => containers().filter((x) => x.name === name);
  const filesIn = (name, re) => cont(name).flatMap((x) => Object.keys(x.c.files).filter((p) => re.test(p)));
  const anyTable = (pred) => Object.entries(S.dbs).some(([n, db]) => { try { return S.tables(db).some((t) => pred(t, n)); } catch (e) { return false; } });
  const table = (name, minRows = 1) => anyTable((t) => t.name.toLowerCase() === name && (t.rows || 0) >= minRows);
  const pipelines = () => Object.entries(st().factories).flatMap(([f, x]) => x.pipelines.map((p) => ({ f, p, fac: x })));
  const runs = (pred = () => true) => st().runs.filter(pred);
  const okRun = (pred) => runs((r) => r.status === "Succeeded" && pred(r)).length > 0;
  const actTypes = (r) => r.activities.map((a) => a.type);
  const flag = (k) => !!st().flags[k];

  const L = [
    {
      id: "cloud-basics", title: "Cloud foundations: groups, storage and the medallion lake", level: "Beginner", minutes: 15,
      concept: `<p>Everything you build in a cloud lives inside a <b>subscription</b> (the billing boundary) and is organised into <b>resource groups</b>. A resource group is a folder for resources that share a lifecycle: delete the group and everything in it goes too. Data teams usually create one group per project and environment, for example <code>rg-shopstream-dev</code>.</p>
<p>A data lake is just cheap, durable file storage with a folder hierarchy. Turning on the <b>hierarchical namespace</b> makes folders real objects, so renames and permissions work per directory, which analytics engines depend on.</p>
<p>Most teams split the lake into zones by data quality, often called the <b>medallion architecture</b>:</p>
<ul><li><b>bronze</b>: raw files exactly as they arrived. Never edited, so you can always replay.</li><li><b>silver</b>: cleaned, typed, de-duplicated data.</li><li><b>gold</b>: business-ready aggregates that reports read.</li></ul>`,
      real: "Resource groups and subscriptions work the same way in Azure. A Nimbus lake storage account maps to an Azure Storage account with hierarchical namespace enabled (ADLS Gen2), and containers map one-to-one.",
      steps: [
        { title: "Create a resource group", detail: "Name it <code>rg-shopstream-dev</code> (any name works). Use <b>Create a resource → Resource group</b>.", check: () => st().rgs.length > 0, go: { view: "create", type: "rg" }, hint: "Resource group names can contain letters, digits, dashes, underscores, periods and parentheses." },
        { title: "Create a lake storage account with hierarchical namespace on", detail: "Name it something like <code>lakeshopdev</code>. Storage names must be 3–24 lowercase letters and digits.", check: () => S.resOfType("storage").some((r) => r.props.hns), go: { view: "create", type: "storage" }, hint: "On the create form, keep the 'Hierarchical namespace' box ticked." },
        { title: "Create three containers: bronze, silver and gold", detail: "Open the storage account → <b>Containers</b> → <b>+ Container</b>.", check: () => ["bronze", "silver", "gold"].every((n) => cont(n).length), hint: "Container names are lowercase. Create all three in the same account." },
      ],
    },
    {
      id: "ingest", title: "Land raw data in the bronze zone", level: "Beginner", minutes: 10,
      concept: `<p><b>Ingestion</b> is getting data from source systems into your lake. In real projects files arrive from apps, partners, exports and APIs. A good landing zone keeps files <b>immutable</b> and organises them by source and date, for example <code>shopstream/orders/orders_2026-11-01.csv</code>.</p>
<p>Daily files are the most common shape you will meet. They let you load <b>incrementally</b>: process only the new day instead of everything again.</p>
<p>Formats matter. CSV is simple but has no types, so <code>00123</code> and <code>123</code> look alike. JSON carries nesting, which you must <b>flatten</b> into columns before loading tables. Columnar formats such as Parquet are what production lakes prefer for analytics.</p>`,
      real: "In Azure you would upload with Storage Explorer, AzCopy or the portal's Upload blade, or have a pipeline pull from the source.",
      steps: [
        { title: "Add the ShopStream orders sample to bronze", detail: "In the <b>bronze</b> container choose <b>Add sample data → ShopStream orders</b>. Or upload your own CSV.", check: () => filesIn("bronze", /orders_.*\.csv$/).length >= 7, hint: "Open the storage account, click the bronze container, then use the 'Add sample data' button in the toolbar." },
        { title: "Add customers and products samples to bronze", detail: "These become your dimension tables later.", check: () => filesIn("bronze", /customers\.csv$/).length && filesIn("bronze", /products\.csv$/).length },
        { title: "Preview a file", detail: "Click any CSV to open the previewer and inspect its columns.", check: () => flag("preview"), hint: "Click a file name in the container browser." },
      ],
    },
    {
      id: "sql-basics", title: "SQL database and the query editor", level: "Beginner", minutes: 20,
      concept: `<p>Lakes store files; a <b>SQL database</b> stores tables with types, keys and indexes, and answers questions fast. Data engineers write SQL every day, so this lab is about getting fluent.</p>
<p>Key ideas:</p><ul><li><b>DDL</b> defines structure: <code>CREATE TABLE</code>, <code>ALTER</code>, <code>DROP</code>.</li><li><b>DML</b> changes rows: <code>INSERT</code>, <code>UPDATE</code>, <code>DELETE</code>.</li><li><b>Queries</b> read: <code>SELECT … FROM … WHERE … GROUP BY … ORDER BY</code>.</li></ul>
<p>This sandbox's engine is SQLite, which runs entirely in your browser. It supports CTEs (<code>WITH</code>), joins and window functions. A sandbox helper, <code>read_csv('lake://account/container/path')</code>, reads lake files straight into a query, similar to <code>OPENROWSET</code> in cloud warehouses.</p>`,
      real: "Azure SQL Database speaks T-SQL, a dialect with small differences (TOP instead of LIMIT, GETDATE() instead of date('now')). The concepts carry over directly.",
      steps: [
        { title: "Create a SQL database", detail: "Name it <code>sqldb-shopstream</code>.", check: () => S.resOfType("sqldb").length > 0, go: { view: "create", type: "sqldb" } },
        { title: "Create a table with DDL", detail: `In <b>Query editor</b> run something like:<pre>CREATE TABLE regions (
  region_id INTEGER PRIMARY KEY,
  name TEXT NOT NULL
);
INSERT INTO regions VALUES (1,'Africa'),(2,'Europe');</pre>`, check: () => anyTable((t) => t.type === "table"), hint: "Run the statements with the Run button or Ctrl+Enter." },
        { title: "Query a lake file directly", detail: `Run <pre>SELECT status, COUNT(*) AS orders
FROM read_csv('lake://&lt;account&gt;/bronze/shopstream/orders/*.csv')
GROUP BY status;</pre>Replace &lt;account&gt; with your storage account name.`, check: () => flag("sql-readlake") && flag("sql-groupby"), hint: "The wildcard * reads all seven daily files as one table." },
      ],
    },
    {
      id: "first-pipeline", title: "Your first pipeline: copy bronze → SQL staging", level: "Beginner", minutes: 20,
      concept: `<p>Running queries by hand does not scale. A <b>pipeline</b> is a saved, repeatable workflow of <b>activities</b> that an orchestrator runs on demand or on a schedule, records, and retries.</p>
<p>Pipelines connect to systems through <b>linked services</b>: named connections that hold where a system lives and how to authenticate. Activities reference the linked service, never raw credentials, so moving from dev to prod means changing the linked service only.</p>
<p>The <b>Copy</b> activity is the workhorse: read from a source, write to a sink. Loading raw files as-is into <b>staging</b> tables (<code>stg_*</code>) is the first step of most warehouses.</p>`,
      real: "This is Azure Data Factory. In ADF you also define datasets (a linked service plus a path or table); Nimbus folds the dataset into the activity's source and sink fields to keep it short.",
      steps: [
        { title: "Create a pipeline factory", detail: "Name it <code>adf-shopstream</code>.", check: () => S.resOfType("factory").length > 0, go: { view: "create", type: "factory" } },
        { title: "Add two linked services: your lake and your SQL database", detail: "Factory → <b>Linked services</b> → <b>+ New</b>. Suggested names: <code>ls_lake</code> and <code>ls_sql</code>.", check: () => Object.values(st().factories).some((f) => f.linked.some((l) => l.type === "lake") && f.linked.some((l) => l.type === "sql")) },
        { title: "Build pipeline pl_load_orders with a Copy activity", detail: "Source: <code>ls_lake</code>, path <code>bronze/shopstream/orders/*.csv</code>. Sink: <code>ls_sql</code>, table <code>stg_orders</code>, mode overwrite.", check: () => pipelines().some(({ p }) => p.activities.some((a) => a.type === "copy")) },
        { title: "Run it and confirm stg_orders has ~1,000 rows", detail: "Use <b>Trigger now</b>, then check <b>Monitor</b> and query the table.", check: () => okRun((r) => actTypes(r).includes("copy")) && table("stg_orders", 900), hint: "If the run failed, open it in Monitor: the error tells you which field is wrong." },
      ],
    },
    {
      id: "elt-star", title: "ELT: build a star schema with Script activities", level: "Intermediate", minutes: 30,
      concept: `<p><b>ETL</b> transforms data before loading it; <b>ELT</b> loads raw data first and transforms it inside the database with SQL. ELT is the common approach today because databases are fast and SQL is easy to review.</p>
<p>Analytics models are usually a <b>star schema</b>:</p><ul><li><b>Fact</b> tables hold events and measures: one row per order line with quantity and revenue.</li><li><b>Dimension</b> tables describe the who, what and where: customers, products, dates.</li></ul>
<p>Facts join to dimensions on keys. Reports then become simple: join a fact to the dimensions you need and group.</p>
<p>Make transforms <b>idempotent</b>: running them twice must give the same result. <code>DROP TABLE IF EXISTS</code> followed by <code>CREATE TABLE … AS SELECT</code> is the simplest way.</p>`,
      real: "In Azure this is a Script or Stored procedure activity in Data Factory, or a dbt project run against Azure SQL or Synapse.",
      steps: [
        { title: "Load stg_customers and stg_products", detail: "Add two more Copy activities (or a new pipeline) from <code>bronze/shopstream/customers/customers.csv</code> and <code>bronze/shopstream/products/products.csv</code>.", check: () => table("stg_customers", 100) && table("stg_products", 20) },
        { title: "Create dim_customer and dim_product", detail: `Add a <b>Script</b> activity, for example:<pre>DROP TABLE IF EXISTS dim_customer;
CREATE TABLE dim_customer AS
SELECT customer_id, first_name || ' ' || last_name AS customer_name,
       city, country, segment, signup_date
FROM stg_customers;</pre>Do the same for products.`, check: () => table("dim_customer") && table("dim_product") },
        { title: "Create fact_sales with revenue", detail: `Revenue = <code>quantity * unit_price * (1 - discount_pct/100.0)</code>. Keep only completed and shipped orders. Include <code>date(order_ts) AS order_date</code>.`, check: () => table("fact_sales", 500) && okRun((r) => actTypes(r).includes("script")), hint: "CREATE TABLE fact_sales AS SELECT order_id, date(order_ts) AS order_date, customer_id, product_id, quantity, ROUND(quantity*unit_price*(1-discount_pct/100.0),2) AS revenue FROM stg_orders WHERE status IN ('completed','shipped');" },
        { title: "Answer a business question", detail: "Write a query: revenue by product category, highest first. This needs a join from fact_sales to dim_product.", check: () => flag("sql-join") && flag("sql-groupby") },
      ],
    },
    {
      id: "dataflow-gold", title: "Data flows: publish a gold dataset to the lake", level: "Intermediate", minutes: 20,
      concept: `<p>A <b>data flow</b> is a visual transformation: a chain of steps such as filter, derived column, join and aggregate. Under the hood a data flow is compiled to code (Spark in the cloud, SQL here). Nimbus shows you the generated SQL after every run, so you can see exactly what each box does.</p>
<p>Gold datasets are shaped for one consumer: a dashboard, a finance export, an ML feature table. Writing them back to the lake lets many tools read them without touching the database.</p>`,
      real: "Mapping Data Flows in Azure Data Factory and Synapse run the same kind of step graph on managed Spark clusters.",
      steps: [
        { title: "Create a Data flow activity that aggregates daily revenue", detail: `Source: bronze orders (<code>bronze/shopstream/orders/*.csv</code>). Steps: <b>Filter</b> <code>status IN ('completed','shipped')</code> → <b>Derived column</b> <code>revenue = quantity*unit_price*(1-discount_pct/100.0)</code> → <b>Derived column</b> <code>order_date = date(order_ts)</code> → <b>Aggregate</b> group by <code>order_date</code>, <code>ROUND(SUM(revenue),2) AS revenue, COUNT(*) AS orders</code> → <b>Sort</b> <code>order_date</code>.`, check: () => pipelines().some(({ p }) => p.activities.some((a) => a.type === "dataflow" && (a.steps || []).some((s) => s.type === "aggregate"))) },
        { title: "Sink it to gold as CSV and run", detail: "Sink: <code>ls_lake</code>, path <code>gold/daily_revenue/daily_revenue.csv</code>.", check: () => okRun((r) => actTypes(r).includes("dataflow")) && filesIn("gold", /\.csv$/).length > 0 },
        { title: "Read the generated SQL", detail: "Open the run in <b>Monitor</b>, select the data flow activity and read <code>generatedSql</code> in its output.", check: () => flag("viewed-flow-sql") },
      ],
    },
    {
      id: "params-triggers", title: "Parameters, expressions and event triggers", level: "Intermediate", minutes: 25,
      concept: `<p>Hard-coded paths make pipelines brittle. <b>Parameters</b> let one pipeline handle any day or file. Fields accept <b>expressions</b> that start with <code>@</code>:</p>
<ul><li><code>@pipeline().parameters.fileName</code>: a parameter value</li><li><code>bronze/shopstream/orders/@{pipeline().parameters.fileName}</code>: string interpolation</li><li><code>@formatDateTime(utcNow(), 'yyyy-MM-dd')</code>: today's date</li><li><code>@triggerBody().fileName</code>: the file that fired an event trigger</li></ul>
<p><b>Triggers</b> start pipelines automatically. A <b>schedule trigger</b> runs on a clock. A <b>storage event trigger</b> runs when a file lands, which gives you near-real-time incremental loading: each new daily file is appended as soon as it arrives.</p>`,
      real: "The expression syntax here is a subset of Azure Data Factory's expression language, with the same function names.",
      steps: [
        { title: "Create pl_ingest_file with a fileName parameter", detail: "Pipeline → <b>Parameters</b> → add <code>fileName</code>. Copy source path: <code>bronze/shopstream/orders/@{pipeline().parameters.fileName}</code>. Sink: <code>stg_orders_incremental</code>, mode <b>append</b>.", check: () => pipelines().some(({ p }) => (p.params || []).length && JSON.stringify(p.activities).includes("pipeline().parameters")) },
        { title: "Run it manually with fileName = orders_2026-11-01.csv", detail: "Trigger now asks for parameter values.", check: () => okRun((r) => Object.values(r.params || {}).some((v) => String(v).includes(".csv"))) },
        { title: "Add a storage event trigger", detail: "Factory → <b>Triggers</b> → <b>+ New</b>: type Storage event, container <code>bronze</code>, prefix <code>shopstream/orders/</code>, suffix <code>.csv</code>, parameter <code>fileName = @triggerBody().fileName</code>.", check: () => Object.values(st().factories).some((f) => f.triggers.some((t) => t.type === "storage" && t.enabled)) },
        { title: "Drop a new file and watch the pipeline fire", detail: "Upload any CSV into <code>bronze/shopstream/orders/</code>, or add the <b>Messy orders file</b> sample. Then check Monitor.", check: () => okRun((r) => r.trigger && r.trigger.type === "BlobEvent") || runs((r) => r.trigger && r.trigger.type === "BlobEvent").length > 0 },
      ],
    },
    {
      id: "data-quality", title: "Data quality gates", level: "Intermediate", minutes: 20,
      concept: `<p>Bad data that reaches a dashboard costs trust. Put <b>quality gates</b> between zones: checks that stop the pipeline when data breaks a rule.</p>
<p>Common rules: <b>not null</b> on keys, <b>uniqueness</b> of IDs, <b>row count</b> above a threshold (an empty file is a failed export), <b>valid ranges</b> (quantity &gt; 0) and <b>referential integrity</b> (every product_id exists in products).</p>
<p>When a gate fails, you typically <b>quarantine</b> the bad rows into a separate table, load the good ones, and alert someone.</p>`,
      real: "Teams implement this with assertion activities, Great Expectations, dbt tests or Delta Live Tables expectations.",
      steps: [
        { title: "Load the messy file into stg_orders_raw", detail: "Add the <b>Messy orders file</b> sample to bronze, then copy <code>bronze/shopstream/orders/orders_2026-11-08.csv</code> into <code>stg_orders_raw</code>.", check: () => table("stg_orders_raw", 50) },
        { title: "Add a Validate activity that fails", detail: "Rule <b>Not null</b> on <code>customer_id</code> of <code>stg_orders_raw</code>. Run the pipeline and see it fail with a clear message.", check: () => runs((r) => r.activities.some((a) => a.type === "validate" && a.status === "Failed")).length > 0 },
        { title: "Fix the data with a Script, then pass the gate", detail: "Write a script that moves bad rows to <code>quarantine_orders</code> and deletes them from <code>stg_orders_raw</code> (null customers, quantity ≤ 0, duplicates). Re-run until the Validate step succeeds.", check: () => runs((r) => r.activities.some((a) => a.type === "validate" && a.status === "Succeeded")).length > 0 && table("quarantine_orders"), hint: "CREATE TABLE quarantine_orders AS SELECT * FROM stg_orders_raw WHERE customer_id IS NULL OR quantity <= 0; DELETE FROM stg_orders_raw WHERE customer_id IS NULL OR quantity <= 0;" },
      ],
    },
    {
      id: "notebooks", title: "Notebooks: explore and transform interactively", level: "Intermediate", minutes: 25,
      concept: `<p><b>Notebooks</b> mix code, results and notes. Engineers use them to explore new data, prototype transformations and share analysis. Each notebook has a <b>session</b>: tables you create live until the session ends, like a Spark session.</p>
<p>In Nimbus notebooks:</p><ul><li>SQL cells can read the lake: <code>SELECT * FROM read_json('lake://acct/bronze/shopstream/events/*.json')</code>. Nested JSON is flattened (<code>device.type</code> becomes <code>device_type</code>).</li><li>Read SQL database tables with <code>read_table('sqldb-name.fact_sales')</code>.</li><li>Start a cell with <code>%%write lake://acct/silver/path/file.csv</code> to save its result to the lake.</li><li>Markdown cells document your thinking.</li></ul>
<p><b>Window functions</b> compute across related rows without collapsing them: running totals, rankings and session numbering. They are a must-know.</p>`,
      real: "Azure Databricks and Synapse notebooks run Python, Scala and Spark SQL on clusters. The SQL you write here (window functions, CTEs) is almost identical in Spark SQL.",
      steps: [
        { title: "Create an analytics workspace and a notebook", detail: "Create the workspace, then <b>+ Notebook</b>.", check: () => Object.values(st().notebooks).some((l) => l.length), go: { view: "create", type: "workspace" } },
        { title: "Explore the clickstream JSON", detail: "Add the clickstream sample to bronze, then count events by <code>event_type</code> and <code>device_type</code> with <code>read_json(...)</code>.", check: () => flag("nb-readlake") },
        { title: "Use a window function", detail: `For example, rank products by revenue within each category:<pre>SELECT category, product_name, revenue,
  RANK() OVER (PARTITION BY category ORDER BY revenue DESC) AS rnk
FROM ...</pre>`, check: () => flag("window-fn") },
        { title: "Write a silver dataset with %%write", detail: "Flatten and clean the events, then save them to <code>silver/events/events_clean.csv</code>.", check: () => flag("nb-write") && filesIn("silver", /./).length > 0 },
      ],
    },
    {
      id: "ops", title: "Operate it: monitoring, scheduling and the CLI", level: "Advanced", minutes: 15,
      concept: `<p>Building a pipeline is half the job; running it every day is the other half. <b>Monitoring</b> shows run history, durations and failures. Each run records inputs and outputs for every activity, which is how you debug at 3 a.m.</p>
<p><b>Schedules</b> run batch pipelines on a clock. Design for <b>reruns</b>: a failed day should be safe to run again (idempotency again).</p>
<p>A <b>command-line interface</b> lets you script the platform. Everything you clicked in this portal can be automated, which is the step toward infrastructure-as-code and CI/CD.</p>`,
      real: "Azure Monitor, ADF's Monitor hub and the Azure CLI (az) cover the same jobs. Bicep or Terraform describe resources as code.",
      steps: [
        { title: "Open Monitor and inspect a failed run", detail: "Find any failed run and open its details.", check: () => flag("monitor-failed") },
        { title: "Create a schedule trigger", detail: "Run a pipeline every 5 minutes while the portal is open.", check: () => Object.values(st().factories).some((f) => f.triggers.some((t) => t.type === "schedule")) },
        { title: "Use the Cloud Shell", detail: "Open the shell from the top bar and run <code>ls</code>, then <code>sql &lt;db&gt; \"SELECT COUNT(*) FROM fact_sales\"</code>.", check: () => flag("shell-ls") && flag("shell-sql") },
      ],
    },
  ];

  N.labs = L;
  N.labProgress = (lab) => {
    const done = lab.steps.map((s) => { try { return !!s.check(); } catch (e) { return false; } });
    return { done, count: done.filter(Boolean).length, total: lab.steps.length, complete: done.every(Boolean) };
  };
})(window.N);
