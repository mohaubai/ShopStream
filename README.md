# Nimbus Portal

A free cloud-portal sandbox for learning data engineering. It runs entirely in your browser: there's no backend, no cloud account and no cost.

The layout and concepts follow the big cloud portals, and every service notes its Azure equivalent so the names you learn carry over to real work.

| Nimbus service | What it does here | Azure equivalent |
| --- | --- | --- |
| Resource groups | Organise resources and delete them together | Resource groups |
| Lake storage | Containers, folders, upload, preview, sample data | ADLS Gen2 storage account |
| SQL database | A real SQL engine (SQLite, compiled to JS) with a query editor | Azure SQL Database |
| Pipeline factory | Linked services, pipelines, Copy / Script / Data flow / Validate / Delete / Wait activities, parameters, expressions, schedule and storage-event triggers, run monitoring | Azure Data Factory |
| Analytics workspace | SQL + Markdown notebooks with per-notebook sessions | Databricks / Synapse notebooks |
| Cloud Shell | `ls`, `cat`, `sql`, `pipeline run`, `nimbus group create`… | Cloud Shell + Azure CLI |
| Learning center | 10 guided labs whose steps check themselves | — |
| Tutor | Chat tutor that knows your current lab and resources (works when opened as a Claude artifact) | — |

## Run it locally

You need any static file server, because browsers block scripts loaded from `file://` pages:

```bash
python3 -m http.server 8080
```

Then open http://localhost:8080. The first load fetches the SQL engine (about 1.3 MB) from jsDelivr.

Your work is saved in the browser's IndexedDB, so it survives a reload but stays on that one browser. **Settings → Reset everything** starts over.

## Sandbox helpers

These work in any SQL editor, notebook cell or Script activity:

```sql
SELECT * FROM read_csv('lake://<account>/<container>/path/*.csv');
SELECT * FROM read_json('lake://<account>/<container>/events/*.json');  -- nested objects are flattened: device.type → device_type
SELECT * FROM read_table('<database>.<table>');                          -- notebooks: read a SQL database table
```

In a notebook, put `%%write lake://<account>/<container>/file.csv` (or `%%write sql://<db>/<table>`) as a cell's first line to save its result.

Pipeline fields accept expressions: `@pipeline().parameters.fileName`, `bronze/orders/@{pipeline().parameters.fileName}`, `@triggerBody().fileName`, `@formatDateTime(utcNow(), 'yyyy-MM-dd')`, `addDays`, `concat`, `replace`, `toUpper` and more.

## Labs

1. Cloud foundations: groups, storage and the medallion lake
2. Land raw data in the bronze zone
3. SQL database and the query editor
4. Your first pipeline: copy bronze → SQL staging
5. ELT: build a star schema with Script activities
6. Data flows: publish a gold dataset to the lake
7. Parameters, expressions and event triggers
8. Data quality gates
9. Notebooks: explore and transform interactively
10. Operate it: monitoring, scheduling and the CLI

The sample data is a made-up online shop called ShopStream: daily order files, customers, products, clickstream JSON, and one deliberately messy file for the data quality lab. It's generated from a fixed seed, so every learner gets the same rows.

## Limits

- SQL is SQLite. T-SQL and Spark SQL differ in small ways (`TOP` vs `LIMIT`, date functions), which the labs point out.
- There's no Python or Spark, and Parquet isn't supported. Files are CSV or JSON text.
- Triggers only fire while the portal tab is open.
- Data stays in your browser, so plan for a few tens of MB at most.

## Files

```
index.html          local entry point
portal.html         same page without the document wrapper (used for the hosted artifact)
css/portal.css      all styles, light and dark themes
js/util.js          CSV/JSON parsing, modals, grids, charts
js/icons.js         icons and service metadata
js/datasets.js      ShopStream sample data generator
js/store.js         state, IndexedDB persistence, lake + SQL engine
js/engine.js        pipeline expressions, activities, runner, triggers
js/labs.js          lab content and step checks
js/app.js           shell, router, home, create flow, lists, settings
js/views-*.js       storage, SQL, factory, notebook, learning/tutor/shell blades
```
