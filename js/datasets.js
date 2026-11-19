/* Nimbus Portal — ShopStream sample datasets (generated with a fixed seed, so every learner gets identical data) */
(function (N) {
  const FIRST = ["Amara", "Leo", "Sofia", "Kenji", "Zanele", "Omar", "Elena", "Tariq", "Mia", "Diego", "Aisha", "Lucas", "Nora", "Ravi", "Ines", "Kwame", "Hana", "Mateo", "Yara", "Felix", "Lerato", "Jonas", "Priya", "Sipho", "Chloe", "Arjun", "Lina", "Thabo", "Emma", "Bilal"];
  const LAST = ["Mokoena", "Silva", "Nakamura", "Ahmed", "Rossi", "Dlamini", "Kim", "Okafor", "Novak", "Haddad", "Fischer", "Patel", "Garcia", "Mensah", "Larsen", "Khumalo", "Moreau", "Ivanova", "Chen", "Ndlovu"];
  const CITIES = [["Johannesburg", "South Africa"], ["Cape Town", "South Africa"], ["Lagos", "Nigeria"], ["Nairobi", "Kenya"], ["London", "United Kingdom"], ["Berlin", "Germany"], ["Lisbon", "Portugal"], ["Toronto", "Canada"], ["Austin", "United States"], ["Mumbai", "India"], ["Tokyo", "Japan"], ["São Paulo", "Brazil"]];
  const SEG = ["Consumer", "Consumer", "Consumer", "Small Business", "Corporate"];
  const CATS = {
    Electronics: [["Wireless Earbuds", 59.99], ["USB-C Hub 7-in-1", 34.5], ["Mechanical Keyboard", 89], ["27in Monitor", 229], ["Webcam 1080p", 45.75], ["Portable SSD 1TB", 99.9], ["Smart Plug 2-pack", 24.99], ["Noise-cancel Headphones", 179]],
    Home: [["Ceramic Mug Set", 22], ["Linen Throw", 48.5], ["Desk Lamp", 31.25], ["Cast Iron Pan", 39.95], ["Plant Pot Trio", 18.4], ["Bamboo Organizer", 27]],
    Sports: [["Yoga Mat", 25.5], ["Running Belt", 15.99], ["Resistance Bands", 19.95], ["Water Bottle 1L", 14.5], ["Trail Socks 3-pack", 21], ["Jump Rope", 9.99]],
    Books: [["Data Pipelines Pocket Guide", 32], ["SQL for Analysts", 28.5], ["Designing Data Systems Notes", 41], ["Cloud Basics Workbook", 19.99], ["Statistics Field Guide", 26.75]],
    Grocery: [["Rooibos Tea 80 bags", 7.5], ["Dark Roast Beans 1kg", 18.9], ["Raw Honey 500g", 11.2], ["Trail Mix 750g", 9.4], ["Olive Oil 1L", 13.75]],
    Beauty: [["Shea Body Butter", 12.5], ["Bamboo Toothbrush 4-pack", 8.99], ["Sunscreen SPF50", 16.25], ["Hair Oil 100ml", 14]],
  };
  const SUPPLIERS = ["Kopano Trading", "Northwind Supply", "Bluebird Goods", "Atlas Wholesale", "Savanna Imports"];
  const STATUS = ["completed", "completed", "completed", "completed", "completed", "completed", "shipped", "shipped", "cancelled", "returned"];
  const CHANNEL = ["web", "web", "web", "mobile_app", "mobile_app", "marketplace"];

  let cache = null;
  function build() {
    if (cache) return cache;
    const r = N.rng(20261101);
    const customers = [];
    for (let i = 1; i <= 180; i++) {
      const f = r.pick(FIRST), l = r.pick(LAST), c = r.pick(CITIES);
      const d = new Date(Date.UTC(2024, 0, 1) + r.int(0, 640) * 86400000);
      customers.push({ customer_id: 1000 + i, first_name: f, last_name: l, email: `${f}.${l}${i}@example.com`.toLowerCase(), city: c[0], country: c[1], signup_date: d.toISOString().slice(0, 10), segment: r.pick(SEG) });
    }
    const products = [];
    let pid = 1;
    for (const [cat, items] of Object.entries(CATS))
      for (const [name, price] of items) products.push({ product_id: "P" + String(pid++).padStart(3, "0"), product_name: name, category: cat, unit_price: price, supplier: r.pick(SUPPLIERS) });

    const orderFiles = {};
    let oid = 50001;
    for (let day = 1; day <= 7; day++) {
      const date = `2026-11-0${day}`;
      const n = r.int(110, 170);
      const rows = [];
      for (let k = 0; k < n; k++) {
        const p = r.pick(products);
        const h = String(r.int(6, 23)).padStart(2, "0"), m = String(r.int(0, 59)).padStart(2, "0"), s = String(r.int(0, 59)).padStart(2, "0");
        rows.push({
          order_id: oid++, order_ts: `${date}T${h}:${m}:${s}Z`, customer_id: r.pick(customers).customer_id, product_id: p.product_id,
          quantity: r() < 0.7 ? 1 : r.int(2, 5), unit_price: p.unit_price, discount_pct: r() < 0.75 ? 0 : r.pick([5, 10, 15, 20]),
          status: r.pick(STATUS), channel: r.pick(CHANNEL),
        });
      }
      rows.sort((a, b) => a.order_ts.localeCompare(b.order_ts));
      orderFiles[date] = rows;
    }
    // A deliberately messy file for data-quality practice
    const dirty = orderFiles["2026-11-07"].slice(0, 60).map((o) => ({ ...o, order_id: o.order_id + 1000, order_ts: o.order_ts.replace("2026-11-07", "2026-11-08") }));
    dirty[3].customer_id = ""; dirty[11].customer_id = "";
    dirty[7].quantity = -2; dirty[19].quantity = 0;
    dirty[25].order_ts = "08/11/2026 14:02";
    dirty[30].status = "COMPLETED ";
    dirty.push({ ...dirty[5] }, { ...dirty[6] });
    dirty[40].product_id = "P999";

    const DEVICES = [["desktop", "Windows"], ["desktop", "macOS"], ["mobile", "Android"], ["mobile", "iOS"], ["tablet", "iPadOS"]];
    const PAGES = ["/", "/search", "/category/electronics", "/category/home", "/product", "/cart", "/checkout"];
    const TYPES = ["page_view", "page_view", "page_view", "search", "add_to_cart", "add_to_cart", "checkout_start", "purchase"];
    const events = [];
    for (let i = 1; i <= 400; i++) {
      const dv = r.pick(DEVICES);
      events.push({ event_id: "e" + (90000 + i), ts: `2026-11-07T${String(r.int(6, 23)).padStart(2, "0")}:${String(r.int(0, 59)).padStart(2, "0")}:${String(r.int(0, 59)).padStart(2, "0")}Z`, session_id: "s" + r.int(1, 120), customer_id: r() < 0.25 ? null : r.pick(customers).customer_id, event_type: r.pick(TYPES), page: r.pick(PAGES), device: { type: dv[0], os: dv[1] } });
    }
    events.sort((a, b) => a.ts.localeCompare(b.ts));
    cache = { customers, products, orderFiles, dirty, events };
    return cache;
  }

  const cols = (rows) => Object.keys(rows[0]);

  /* Catalog of sample datasets that can be added to any container */
  N.sampleCatalog = [
    {
      id: "shopstream-orders", name: "ShopStream orders (7 daily files)", desc: "One CSV per day, 1–7 Nov 2026. ~1,000 orders. Typical landing-zone shape for incremental loads.",
      files: () => { const d = build(); return Object.entries(d.orderFiles).map(([date, rows]) => ({ path: `shopstream/orders/orders_${date}.csv`, content: N.toCSV(cols(rows), rows) })); },
    },
    {
      id: "shopstream-customers", name: "ShopStream customers", desc: "180 customers with city, country, segment and signup date. A classic dimension source.",
      files: () => { const d = build(); return [{ path: "shopstream/customers/customers.csv", content: N.toCSV(cols(d.customers), d.customers) }]; },
    },
    {
      id: "shopstream-products", name: "ShopStream products", desc: "34 products across 6 categories with list price and supplier.",
      files: () => { const d = build(); return [{ path: "shopstream/products/products.csv", content: N.toCSV(cols(d.products), d.products) }]; },
    },
    {
      id: "shopstream-events", name: "Clickstream events (JSON lines)", desc: "400 semi-structured web events with a nested device object. Good for practising flattening.",
      files: () => { const d = build(); return [{ path: "shopstream/events/clickstream_2026-11-07.json", content: d.events.map((e) => JSON.stringify(e)).join("\n") + "\n" }]; },
    },
    {
      id: "shopstream-dirty", name: "Messy orders file (data quality)", desc: "Orders for 8 Nov with planted problems: duplicates, missing keys, bad dates, negative quantities, unknown products.",
      files: () => { const d = build(); return [{ path: "shopstream/orders/orders_2026-11-08.csv", content: N.toCSV(cols(d.dirty), d.dirty) }]; },
    },
  ];
  N.sampleData = build;
})(window.N);
