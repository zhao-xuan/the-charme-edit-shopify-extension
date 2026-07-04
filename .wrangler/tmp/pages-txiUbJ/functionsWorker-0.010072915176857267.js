var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// api/_lib.js
var json = /* @__PURE__ */ __name((data, init = {}) => new Response(JSON.stringify(data), {
  ...init,
  headers: {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "access-control-allow-origin": "*",
    ...init.headers || {}
  }
}), "json");
var bad = /* @__PURE__ */ __name((msg, status = 400) => json({ error: msg }, { status }), "bad");
function b64urlToBytes(s) {
  s = String(s || "").replace(/-/g, "+").replace(/_/g, "/");
  const pad = s.length % 4;
  if (pad) s += "=".repeat(4 - pad);
  const bin = atob(s);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}
__name(b64urlToBytes, "b64urlToBytes");
async function verifyShopifySessionToken(token, env) {
  const secret = env.SHOPIFY_CLIENT_SECRET;
  if (!secret || !token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [h, p, sig] = parts;
  let payload;
  try {
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"]
    );
    const ok = await crypto.subtle.verify(
      "HMAC",
      key,
      b64urlToBytes(sig),
      new TextEncoder().encode(`${h}.${p}`)
    );
    if (!ok) return null;
    payload = JSON.parse(new TextDecoder().decode(b64urlToBytes(p)));
  } catch {
    return null;
  }
  const now = Math.floor(Date.now() / 1e3);
  if (payload.exp && now >= Number(payload.exp)) return null;
  if (payload.nbf && now < Number(payload.nbf) - 5) return null;
  if (env.SHOPIFY_CLIENT_ID && payload.aud && payload.aud !== env.SHOPIFY_CLIENT_ID) return null;
  return payload;
}
__name(verifyShopifySessionToken, "verifyShopifySessionToken");
async function requireAdmin(request, env) {
  const auth = request.headers.get("authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "");
  if (!token) return false;
  if (env.ADMIN_TOKEN && token === env.ADMIN_TOKEN) return true;
  if (await verifyShopifySessionToken(token, env)) return true;
  return false;
}
__name(requireAdmin, "requireAdmin");
var rowToCharm = /* @__PURE__ */ __name((r) => ({
  id: r.id,
  name: r.name,
  collection: r.collection,
  category: r.category,
  tier: r.tier,
  type: r.type,
  price: r.price,
  widthMm: r.width_mm,
  heightMm: r.height_mm,
  pxW: r.px_w,
  pxH: r.px_h,
  src: `/api/image/${r.image_key}`,
  hidden: !!r.hidden,
  source: r.source,
  dupOf: r.dup_of,
  dupScore: r.dup_score,
  bundle: !!r.bundle,
  bundleMax: r.bundle_max ?? null,
  minScale: 1,
  maxScale: 1
}), "rowToCharm");
var rowToProduct = /* @__PURE__ */ __name((r) => ({
  id: r.id,
  name: r.name,
  kind: r.kind,
  basePrice: r.base_price,
  widthMm: r.width_mm,
  heightMm: r.height_mm,
  src: r.image_key ? `/api/image/${r.image_key}` : null,
  colourLabel: r.colour_label
}), "rowToProduct");
async function storeImage(env, key, dataUrl) {
  const m = /^data:([^;]+);base64,(.*)$/s.exec(dataUrl || "");
  if (!m) throw new Error("expected a base64 data URL");
  const contentType = m[1];
  const bin = atob(m[2]);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  await env.IMAGES.put(`img:${key}`, bytes, { metadata: { contentType } });
  return key;
}
__name(storeImage, "storeImage");
var slug = /* @__PURE__ */ __name((s) => (s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "item", "slug");
var rid = /* @__PURE__ */ __name(() => Math.random().toString(36).slice(2, 7), "rid");
var makeId = /* @__PURE__ */ __name((prefix, name) => `${prefix}-${slug(name)}-${rid()}`, "makeId");

// api/admin/charms.js
var cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST,PATCH,DELETE,OPTIONS",
  "access-control-allow-headers": "authorization,content-type"
};
var onRequestOptions = /* @__PURE__ */ __name(() => new Response(null, { headers: cors }), "onRequestOptions");
async function onRequestPost({ request, env }) {
  if (!await requireAdmin(request, env)) return bad("unauthorized", 401);
  const body = await request.json().catch(() => null);
  const items = body?.charms || (body ? [body] : []);
  if (!items.length) return bad("no charms");
  const created = [];
  for (const c of items) {
    if (!c.src) return bad(`charm "${c.name}" has no image`);
    const id = c.id || makeId("charm", c.name || "charm");
    const imageKey = await storeImage(env, id, c.src);
    const bundle = c.bundle ? 1 : 0;
    const bundleMax = bundle ? Math.max(1, Number(c.bundleMax) || 1) : null;
    await env.DB.prepare(
      `INSERT OR REPLACE INTO charms
       (id,name,collection,category,tier,type,price,width_mm,height_mm,px_w,px_h,image_key,hidden,source,dup_of,dup_score,bundle,bundle_max)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).bind(
      id,
      c.name || "Charm",
      c.collection || "Custom",
      c.category || "gold",
      c.tier || "midi",
      c.type || 2,
      c.price ?? 2,
      c.widthMm || 16,
      c.heightMm || 16,
      c.pxW || null,
      c.pxH || null,
      imageKey,
      c.hidden ? 1 : 0,
      c.source || "custom",
      c.dupOf || null,
      c.dupScore ?? null,
      bundle,
      bundleMax
    ).run();
    const row = await env.DB.prepare("SELECT * FROM charms WHERE id = ?").bind(id).first();
    created.push(rowToCharm(row));
  }
  return json({ ok: true, charms: created }, { headers: cors });
}
__name(onRequestPost, "onRequestPost");
async function onRequestPatch({ request, env }) {
  if (!await requireAdmin(request, env)) return bad("unauthorized", 401);
  const { id, price, hidden } = await request.json().catch(() => ({})) || {};
  if (!id) return bad("id required");
  if (price != null) await env.DB.prepare("UPDATE charms SET price = ? WHERE id = ?").bind(price, id).run();
  if (hidden != null) await env.DB.prepare("UPDATE charms SET hidden = ? WHERE id = ?").bind(hidden ? 1 : 0, id).run();
  return json({ ok: true }, { headers: cors });
}
__name(onRequestPatch, "onRequestPatch");
async function onRequestDelete({ request, env }) {
  if (!await requireAdmin(request, env)) return bad("unauthorized", 401);
  const { id } = await request.json().catch(() => ({})) || {};
  if (!id) return bad("id required");
  const row = await env.DB.prepare("SELECT image_key FROM charms WHERE id = ?").bind(id).first();
  if (row?.image_key) await env.IMAGES.delete(`img:${row.image_key}`);
  await env.DB.prepare("DELETE FROM charms WHERE id = ?").bind(id).run();
  return json({ ok: true }, { headers: cors });
}
__name(onRequestDelete, "onRequestDelete");

// api/admin/override.js
var cors2 = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST,OPTIONS",
  "access-control-allow-headers": "authorization,content-type"
};
var onRequestOptions2 = /* @__PURE__ */ __name(() => new Response(null, { headers: cors2 }), "onRequestOptions");
async function onRequestPost2({ request, env }) {
  if (!await requireAdmin(request, env)) return bad("unauthorized", 401);
  const { scope, refId, price, hidden } = await request.json().catch(() => ({})) || {};
  if (!scope || !refId) return bad("scope and refId required");
  await env.DB.prepare(
    `INSERT INTO overrides (scope, ref_id, price, hidden) VALUES (?,?,?,?)
     ON CONFLICT(scope, ref_id) DO UPDATE SET
       price = COALESCE(excluded.price, overrides.price),
       hidden = COALESCE(excluded.hidden, overrides.hidden)`
  ).bind(scope, refId, price ?? null, hidden == null ? null : hidden ? 1 : 0).run();
  return json({ ok: true }, { headers: cors2 });
}
__name(onRequestPost2, "onRequestPost");

// api/admin/products.js
var cors3 = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST,DELETE,OPTIONS",
  "access-control-allow-headers": "authorization,content-type"
};
var onRequestOptions3 = /* @__PURE__ */ __name(() => new Response(null, { headers: cors3 }), "onRequestOptions");
async function onRequestPost3({ request, env }) {
  if (!await requireAdmin(request, env)) return bad("unauthorized", 401);
  const p = await request.json().catch(() => null) || {};
  if (!p.src) return bad("product needs a body image");
  const id = p.id || makeId("prod", p.name || "product");
  const imageKey = await storeImage(env, id, p.src);
  await env.DB.prepare(
    `INSERT OR REPLACE INTO products
     (id,name,kind,base_price,width_mm,height_mm,image_key,colour_label,active)
     VALUES (?,?,?,?,?,?,?,?,1)`
  ).bind(
    id,
    p.name || "Custom product",
    p.kind === "tote" ? "tote" : "phone",
    p.basePrice ?? 26,
    p.widthMm || 75,
    p.heightMm || 150,
    imageKey,
    p.colourLabel || "Default"
  ).run();
  const row = await env.DB.prepare("SELECT * FROM products WHERE id = ?").bind(id).first();
  return json({ ok: true, product: rowToProduct(row) }, { headers: cors3 });
}
__name(onRequestPost3, "onRequestPost");
async function onRequestDelete2({ request, env }) {
  if (!await requireAdmin(request, env)) return bad("unauthorized", 401);
  const { id } = await request.json().catch(() => ({})) || {};
  if (!id) return bad("id required");
  const row = await env.DB.prepare("SELECT image_key FROM products WHERE id = ?").bind(id).first();
  if (row?.image_key) await env.IMAGES.delete(`img:${row.image_key}`);
  await env.DB.prepare("DELETE FROM products WHERE id = ?").bind(id).run();
  return json({ ok: true }, { headers: cors3 });
}
__name(onRequestDelete2, "onRequestDelete");

// api/shopify/draft-order.js
var API_VERSION = "2024-10";
var BASE_PRICE = { phone: 26, tote: 16, frame: 24 };
var cors4 = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST,OPTIONS",
  "access-control-allow-headers": "content-type"
};
var json2 = /* @__PURE__ */ __name((data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { "content-type": "application/json; charset=utf-8", ...cors4 }
}), "json");
var onRequestOptions4 = /* @__PURE__ */ __name(() => new Response(null, { headers: cors4 }), "onRequestOptions");
var cachedToken = null;
async function getAccessToken(env) {
  if (env.SHOPIFY_CLIENT_ID && env.SHOPIFY_CLIENT_SECRET) {
    const now = Date.now();
    if (cachedToken && cachedToken.exp > now + 6e4) return cachedToken.token;
    const res = await fetch(`https://${env.SHOPIFY_STORE}/admin/oauth/access_token`, {
      method: "POST",
      body: new URLSearchParams({
        client_id: env.SHOPIFY_CLIENT_ID,
        client_secret: env.SHOPIFY_CLIENT_SECRET,
        grant_type: "client_credentials"
      })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.access_token) {
      throw new Error(`token exchange failed: ${JSON.stringify(data).slice(0, 200)}`);
    }
    cachedToken = { token: data.access_token, exp: now + (Number(data.expires_in) || 3600) * 1e3 };
    return cachedToken.token;
  }
  if (env.SHOPIFY_ADMIN_TOKEN) return env.SHOPIFY_ADMIN_TOKEN;
  throw new Error("no Shopify auth configured");
}
__name(getAccessToken, "getAccessToken");
async function admin(env, query, variables) {
  const token = await getAccessToken(env);
  const res = await fetch(
    `https://${env.SHOPIFY_STORE}/admin/api/${API_VERSION}/graphql.json`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-shopify-access-token": token
      },
      body: JSON.stringify({ query, variables })
    }
  );
  const body = await res.json();
  if (body.errors) throw new Error(JSON.stringify(body.errors));
  return body.data;
}
__name(admin, "admin");
var DRAFT_ORDER_CREATE = `
  mutation draftOrderCreate($input: DraftOrderInput!) {
    draftOrderCreate(input: $input) {
      draftOrder { id invoiceUrl totalPrice }
      userErrors { field message }
    }
  }`;
var money = /* @__PURE__ */ __name((n) => (Math.round(Number(n) * 100) / 100).toFixed(2), "money");
async function storeProof(env, origin, token, dataUrl) {
  if (!env.IMAGES || !dataUrl) return null;
  const m = /^data:(image\/[a-z+]+);base64,(.*)$/s.exec(dataUrl);
  if (!m) return null;
  const bin = atob(m[2]);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const key = `proof-${token}`;
  await env.IMAGES.put(`img:${key}`, bytes, { metadata: { contentType: m[1] } });
  return `${origin}/api/image/${key}`;
}
__name(storeProof, "storeProof");
async function onRequestPost4({ request, env }) {
  const hasAuth = env.SHOPIFY_CLIENT_ID && env.SHOPIFY_CLIENT_SECRET || env.SHOPIFY_ADMIN_TOKEN;
  if (!env.SHOPIFY_STORE || !hasAuth) {
    return json2(
      {
        error: "Shopify backend not configured (set SHOPIFY_STORE + SHOPIFY_CLIENT_ID/SHOPIFY_CLIENT_SECRET, or SHOPIFY_ADMIN_TOKEN)."
      },
      503
    );
  }
  let payload;
  try {
    payload = await request.json();
  } catch {
    return json2({ error: "invalid JSON body" }, 400);
  }
  const product = payload.product || {};
  const charms = Array.isArray(payload.charms) ? payload.charms : [];
  if (!product.id || !charms.length) return json2({ error: "design has no product or charms" }, 400);
  const token = payload.designToken || `cd_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
  const origin = new URL(request.url).origin;
  const ids = [...new Set(charms.map((c) => c.charmId).filter(Boolean))];
  const priceById = /* @__PURE__ */ new Map();
  const nameById = /* @__PURE__ */ new Map();
  if (env.DB && ids.length) {
    const placeholders = ids.map(() => "?").join(",");
    const rows = await env.DB.prepare(
      `SELECT id, name, price FROM charms WHERE id IN (${placeholders})`
    ).bind(...ids).all();
    for (const r of rows.results || []) {
      priceById.set(r.id, Number(r.price));
      nameById.set(r.id, r.name);
    }
  }
  const priceFor = /* @__PURE__ */ __name((c) => {
    if (priceById.has(c.charmId)) return priceById.get(c.charmId);
    return Math.max(0, Math.min(100, Number(c.price) || 0));
  }, "priceFor");
  const counts = /* @__PURE__ */ new Map();
  const bundleBilled = /* @__PURE__ */ new Set();
  for (const c of charms) {
    if (!c.charmId) continue;
    if (c.bundle) {
      if (bundleBilled.has(c.charmId)) continue;
      bundleBilled.add(c.charmId);
    }
    const cur = counts.get(c.charmId) || {
      qty: 0,
      price: priceFor(c),
      name: nameById.get(c.charmId) || c.name || "Charm"
    };
    cur.qty += 1;
    counts.set(c.charmId, cur);
  }
  const proofUrl = await storeProof(env, origin, token, payload.preview);
  const finish = product.color || product.colorId || "";
  const kind = BASE_PRICE[product.kind] != null ? product.kind : "phone";
  const basePrice = BASE_PRICE[kind];
  const charmEntries = [...counts.values()];
  const charmsTotal = charmEntries.reduce((n, c) => n + c.price * c.qty, 0);
  const casePrice = basePrice + charmsTotal;
  const baseAttributes = [];
  baseAttributes.push({ key: "Model", value: String(product.name || product.id || "") });
  if (finish) baseAttributes.push({ key: "Case & Gel", value: String(finish) });
  baseAttributes.push({ key: "Base case", value: `\xA3${money(basePrice)}` });
  charmEntries.forEach((c, i) => {
    const qtyPart = c.qty > 1 ? ` \xD7${c.qty}` : "";
    baseAttributes.push({
      key: `Charm ${i + 1}`,
      value: `${c.name}${qtyPart} \xB7 \xA3${money(c.price * c.qty)}`
    });
  });
  baseAttributes.push({ key: "Charms subtotal", value: `\xA3${money(charmsTotal)}` });
  if (proofUrl) baseAttributes.push({ key: "Proof", value: proofUrl });
  baseAttributes.push({ key: "_design_token", value: token });
  baseAttributes.push({
    key: "_layout",
    value: JSON.stringify({ product, charms, proof: proofUrl }).slice(0, 4e3)
  });
  const lineItems = [
    {
      title: `${product.name}${finish ? ` \u2014 ${finish}` : ""}`,
      originalUnitPrice: money(casePrice),
      quantity: 1,
      requiresShipping: true,
      taxable: true,
      customAttributes: baseAttributes
    }
  ];
  const total = casePrice;
  const input = {
    lineItems,
    tags: ["charme-customizer"],
    note: `Charm\xE9 custom design ${token}${proofUrl ? `
Proof: ${proofUrl}` : ""}`,
    customAttributes: [
      { key: "_design_token", value: token },
      ...proofUrl ? [{ key: "_proof", value: proofUrl }] : []
    ]
  };
  try {
    const data = await admin(env, DRAFT_ORDER_CREATE, { input });
    const r = data.draftOrderCreate;
    if (r.userErrors && r.userErrors.length) {
      return json2({ error: r.userErrors.map((e) => e.message).join("; ") }, 422);
    }
    return json2({
      invoiceUrl: r.draftOrder.invoiceUrl,
      draftOrderId: r.draftOrder.id,
      total: money(total),
      designToken: token
    });
  } catch (err) {
    return json2({ error: String(err.message || err) }, 502);
  }
}
__name(onRequestPost4, "onRequestPost");

// api/image/[key].js
async function onRequestGet({ params, env }) {
  const key = Array.isArray(params.key) ? params.key.join("/") : params.key;
  if (!env.IMAGES || !key) return new Response("Not found", { status: 404 });
  const rec = await env.IMAGES.getWithMetadata(`img:${key}`, { type: "arrayBuffer" });
  if (!rec || !rec.value) return new Response("Not found", { status: 404 });
  const ct = rec.metadata && rec.metadata.contentType || "image/png";
  return new Response(rec.value, {
    headers: {
      "content-type": ct,
      "cache-control": "public, max-age=31536000, immutable",
      "access-control-allow-origin": "*"
    }
  });
}
__name(onRequestGet, "onRequestGet");

// api/preset/[handle].js
async function onRequestGet2({ params, env }) {
  const handle = String(params.handle || "").trim();
  if (!handle) return bad("missing handle", 400);
  if (!env.DB) return json({ error: "not found" }, { status: 404 });
  const row = await env.DB.prepare(
    "SELECT handle, title, product_id, case_colour, gel_colour, layout FROM presets WHERE handle = ? AND active = 1"
  ).bind(handle).first();
  if (!row) return json({ error: "not found" }, { status: 404 });
  let layout;
  try {
    layout = JSON.parse(row.layout);
  } catch {
    return json({ error: "corrupt preset" }, { status: 500 });
  }
  layout.productId = layout.productId || row.product_id;
  layout.caseColourId = layout.caseColourId || row.case_colour;
  layout.gelColourId = layout.gelColourId || row.gel_colour;
  return json({ handle: row.handle, title: row.title, layout });
}
__name(onRequestGet2, "onRequestGet");
async function onRequestPost5({ request, params, env }) {
  if (!await requireAdmin(request, env)) return bad("unauthorized", 401);
  const handle = String(params.handle || "").trim();
  if (!handle) return bad("missing handle", 400);
  if (!env.DB) return bad("no database bound", 500);
  let body;
  try {
    body = await request.json();
  } catch {
    return bad("invalid JSON body", 400);
  }
  const layout = body.layout;
  if (!layout || !Array.isArray(layout.charms)) return bad("layout.charms required", 400);
  const productId = layout.productId || "iphone-16-pro-max";
  const caseColour = layout.caseColourId || "white";
  const gelColour = layout.gelColourId || "glitter";
  await env.DB.prepare(
    `INSERT INTO presets (handle, title, product_id, case_colour, gel_colour, layout, active, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 1, datetime('now'))
     ON CONFLICT(handle) DO UPDATE SET
       title = excluded.title,
       product_id = excluded.product_id,
       case_colour = excluded.case_colour,
       gel_colour = excluded.gel_colour,
       layout = excluded.layout,
       active = 1,
       updated_at = datetime('now')`
  ).bind(handle, body.title || null, productId, caseColour, gelColour, JSON.stringify(layout)).run();
  return json({ ok: true, handle });
}
__name(onRequestPost5, "onRequestPost");

// api/catalog.js
async function onRequestGet3({ env }) {
  if (!env.DB) return json({ products: [], charms: [], overrides: {} });
  const [products, charms, overrides] = await Promise.all([
    env.DB.prepare("SELECT * FROM products WHERE active = 1 ORDER BY created_at DESC").all(),
    env.DB.prepare("SELECT * FROM charms ORDER BY created_at DESC").all(),
    env.DB.prepare("SELECT * FROM overrides").all()
  ]);
  const ov = { productPrices: {}, charmPrices: {}, charmHidden: {} };
  for (const o of overrides.results || []) {
    if (o.scope === "product" && o.price != null) ov.productPrices[o.ref_id] = o.price;
    if (o.scope === "charm" && o.price != null) ov.charmPrices[o.ref_id] = o.price;
    if (o.scope === "charm" && o.hidden) ov.charmHidden[o.ref_id] = true;
  }
  return json({
    products: (products.results || []).map(rowToProduct),
    charms: (charms.results || []).map(rowToCharm),
    overrides: ov
  });
}
__name(onRequestGet3, "onRequestGet");

// ../.wrangler/tmp/pages-txiUbJ/functionsRoutes-0.06033459142650921.mjs
var routes = [
  {
    routePath: "/api/admin/charms",
    mountPath: "/api/admin",
    method: "DELETE",
    middlewares: [],
    modules: [onRequestDelete]
  },
  {
    routePath: "/api/admin/charms",
    mountPath: "/api/admin",
    method: "OPTIONS",
    middlewares: [],
    modules: [onRequestOptions]
  },
  {
    routePath: "/api/admin/charms",
    mountPath: "/api/admin",
    method: "PATCH",
    middlewares: [],
    modules: [onRequestPatch]
  },
  {
    routePath: "/api/admin/charms",
    mountPath: "/api/admin",
    method: "POST",
    middlewares: [],
    modules: [onRequestPost]
  },
  {
    routePath: "/api/admin/override",
    mountPath: "/api/admin",
    method: "OPTIONS",
    middlewares: [],
    modules: [onRequestOptions2]
  },
  {
    routePath: "/api/admin/override",
    mountPath: "/api/admin",
    method: "POST",
    middlewares: [],
    modules: [onRequestPost2]
  },
  {
    routePath: "/api/admin/products",
    mountPath: "/api/admin",
    method: "DELETE",
    middlewares: [],
    modules: [onRequestDelete2]
  },
  {
    routePath: "/api/admin/products",
    mountPath: "/api/admin",
    method: "OPTIONS",
    middlewares: [],
    modules: [onRequestOptions3]
  },
  {
    routePath: "/api/admin/products",
    mountPath: "/api/admin",
    method: "POST",
    middlewares: [],
    modules: [onRequestPost3]
  },
  {
    routePath: "/api/shopify/draft-order",
    mountPath: "/api/shopify",
    method: "OPTIONS",
    middlewares: [],
    modules: [onRequestOptions4]
  },
  {
    routePath: "/api/shopify/draft-order",
    mountPath: "/api/shopify",
    method: "POST",
    middlewares: [],
    modules: [onRequestPost4]
  },
  {
    routePath: "/api/image/:key",
    mountPath: "/api/image",
    method: "GET",
    middlewares: [],
    modules: [onRequestGet]
  },
  {
    routePath: "/api/preset/:handle",
    mountPath: "/api/preset",
    method: "GET",
    middlewares: [],
    modules: [onRequestGet2]
  },
  {
    routePath: "/api/preset/:handle",
    mountPath: "/api/preset",
    method: "POST",
    middlewares: [],
    modules: [onRequestPost5]
  },
  {
    routePath: "/api/catalog",
    mountPath: "/api",
    method: "GET",
    middlewares: [],
    modules: [onRequestGet3]
  }
];

// ../node_modules/path-to-regexp/dist.es2015/index.js
function lexer(str) {
  var tokens = [];
  var i = 0;
  while (i < str.length) {
    var char = str[i];
    if (char === "*" || char === "+" || char === "?") {
      tokens.push({ type: "MODIFIER", index: i, value: str[i++] });
      continue;
    }
    if (char === "\\") {
      tokens.push({ type: "ESCAPED_CHAR", index: i++, value: str[i++] });
      continue;
    }
    if (char === "{") {
      tokens.push({ type: "OPEN", index: i, value: str[i++] });
      continue;
    }
    if (char === "}") {
      tokens.push({ type: "CLOSE", index: i, value: str[i++] });
      continue;
    }
    if (char === ":") {
      var name = "";
      var j = i + 1;
      while (j < str.length) {
        var code = str.charCodeAt(j);
        if (
          // `0-9`
          code >= 48 && code <= 57 || // `A-Z`
          code >= 65 && code <= 90 || // `a-z`
          code >= 97 && code <= 122 || // `_`
          code === 95
        ) {
          name += str[j++];
          continue;
        }
        break;
      }
      if (!name)
        throw new TypeError("Missing parameter name at ".concat(i));
      tokens.push({ type: "NAME", index: i, value: name });
      i = j;
      continue;
    }
    if (char === "(") {
      var count = 1;
      var pattern = "";
      var j = i + 1;
      if (str[j] === "?") {
        throw new TypeError('Pattern cannot start with "?" at '.concat(j));
      }
      while (j < str.length) {
        if (str[j] === "\\") {
          pattern += str[j++] + str[j++];
          continue;
        }
        if (str[j] === ")") {
          count--;
          if (count === 0) {
            j++;
            break;
          }
        } else if (str[j] === "(") {
          count++;
          if (str[j + 1] !== "?") {
            throw new TypeError("Capturing groups are not allowed at ".concat(j));
          }
        }
        pattern += str[j++];
      }
      if (count)
        throw new TypeError("Unbalanced pattern at ".concat(i));
      if (!pattern)
        throw new TypeError("Missing pattern at ".concat(i));
      tokens.push({ type: "PATTERN", index: i, value: pattern });
      i = j;
      continue;
    }
    tokens.push({ type: "CHAR", index: i, value: str[i++] });
  }
  tokens.push({ type: "END", index: i, value: "" });
  return tokens;
}
__name(lexer, "lexer");
function parse(str, options) {
  if (options === void 0) {
    options = {};
  }
  var tokens = lexer(str);
  var _a = options.prefixes, prefixes = _a === void 0 ? "./" : _a, _b = options.delimiter, delimiter = _b === void 0 ? "/#?" : _b;
  var result = [];
  var key = 0;
  var i = 0;
  var path = "";
  var tryConsume = /* @__PURE__ */ __name(function(type) {
    if (i < tokens.length && tokens[i].type === type)
      return tokens[i++].value;
  }, "tryConsume");
  var mustConsume = /* @__PURE__ */ __name(function(type) {
    var value2 = tryConsume(type);
    if (value2 !== void 0)
      return value2;
    var _a2 = tokens[i], nextType = _a2.type, index = _a2.index;
    throw new TypeError("Unexpected ".concat(nextType, " at ").concat(index, ", expected ").concat(type));
  }, "mustConsume");
  var consumeText = /* @__PURE__ */ __name(function() {
    var result2 = "";
    var value2;
    while (value2 = tryConsume("CHAR") || tryConsume("ESCAPED_CHAR")) {
      result2 += value2;
    }
    return result2;
  }, "consumeText");
  var isSafe = /* @__PURE__ */ __name(function(value2) {
    for (var _i = 0, delimiter_1 = delimiter; _i < delimiter_1.length; _i++) {
      var char2 = delimiter_1[_i];
      if (value2.indexOf(char2) > -1)
        return true;
    }
    return false;
  }, "isSafe");
  var safePattern = /* @__PURE__ */ __name(function(prefix2) {
    var prev = result[result.length - 1];
    var prevText = prefix2 || (prev && typeof prev === "string" ? prev : "");
    if (prev && !prevText) {
      throw new TypeError('Must have text between two parameters, missing text after "'.concat(prev.name, '"'));
    }
    if (!prevText || isSafe(prevText))
      return "[^".concat(escapeString(delimiter), "]+?");
    return "(?:(?!".concat(escapeString(prevText), ")[^").concat(escapeString(delimiter), "])+?");
  }, "safePattern");
  while (i < tokens.length) {
    var char = tryConsume("CHAR");
    var name = tryConsume("NAME");
    var pattern = tryConsume("PATTERN");
    if (name || pattern) {
      var prefix = char || "";
      if (prefixes.indexOf(prefix) === -1) {
        path += prefix;
        prefix = "";
      }
      if (path) {
        result.push(path);
        path = "";
      }
      result.push({
        name: name || key++,
        prefix,
        suffix: "",
        pattern: pattern || safePattern(prefix),
        modifier: tryConsume("MODIFIER") || ""
      });
      continue;
    }
    var value = char || tryConsume("ESCAPED_CHAR");
    if (value) {
      path += value;
      continue;
    }
    if (path) {
      result.push(path);
      path = "";
    }
    var open = tryConsume("OPEN");
    if (open) {
      var prefix = consumeText();
      var name_1 = tryConsume("NAME") || "";
      var pattern_1 = tryConsume("PATTERN") || "";
      var suffix = consumeText();
      mustConsume("CLOSE");
      result.push({
        name: name_1 || (pattern_1 ? key++ : ""),
        pattern: name_1 && !pattern_1 ? safePattern(prefix) : pattern_1,
        prefix,
        suffix,
        modifier: tryConsume("MODIFIER") || ""
      });
      continue;
    }
    mustConsume("END");
  }
  return result;
}
__name(parse, "parse");
function match(str, options) {
  var keys = [];
  var re = pathToRegexp(str, keys, options);
  return regexpToFunction(re, keys, options);
}
__name(match, "match");
function regexpToFunction(re, keys, options) {
  if (options === void 0) {
    options = {};
  }
  var _a = options.decode, decode = _a === void 0 ? function(x) {
    return x;
  } : _a;
  return function(pathname) {
    var m = re.exec(pathname);
    if (!m)
      return false;
    var path = m[0], index = m.index;
    var params = /* @__PURE__ */ Object.create(null);
    var _loop_1 = /* @__PURE__ */ __name(function(i2) {
      if (m[i2] === void 0)
        return "continue";
      var key = keys[i2 - 1];
      if (key.modifier === "*" || key.modifier === "+") {
        params[key.name] = m[i2].split(key.prefix + key.suffix).map(function(value) {
          return decode(value, key);
        });
      } else {
        params[key.name] = decode(m[i2], key);
      }
    }, "_loop_1");
    for (var i = 1; i < m.length; i++) {
      _loop_1(i);
    }
    return { path, index, params };
  };
}
__name(regexpToFunction, "regexpToFunction");
function escapeString(str) {
  return str.replace(/([.+*?=^!:${}()[\]|/\\])/g, "\\$1");
}
__name(escapeString, "escapeString");
function flags(options) {
  return options && options.sensitive ? "" : "i";
}
__name(flags, "flags");
function regexpToRegexp(path, keys) {
  if (!keys)
    return path;
  var groupsRegex = /\((?:\?<(.*?)>)?(?!\?)/g;
  var index = 0;
  var execResult = groupsRegex.exec(path.source);
  while (execResult) {
    keys.push({
      // Use parenthesized substring match if available, index otherwise
      name: execResult[1] || index++,
      prefix: "",
      suffix: "",
      modifier: "",
      pattern: ""
    });
    execResult = groupsRegex.exec(path.source);
  }
  return path;
}
__name(regexpToRegexp, "regexpToRegexp");
function arrayToRegexp(paths, keys, options) {
  var parts = paths.map(function(path) {
    return pathToRegexp(path, keys, options).source;
  });
  return new RegExp("(?:".concat(parts.join("|"), ")"), flags(options));
}
__name(arrayToRegexp, "arrayToRegexp");
function stringToRegexp(path, keys, options) {
  return tokensToRegexp(parse(path, options), keys, options);
}
__name(stringToRegexp, "stringToRegexp");
function tokensToRegexp(tokens, keys, options) {
  if (options === void 0) {
    options = {};
  }
  var _a = options.strict, strict = _a === void 0 ? false : _a, _b = options.start, start = _b === void 0 ? true : _b, _c = options.end, end = _c === void 0 ? true : _c, _d = options.encode, encode = _d === void 0 ? function(x) {
    return x;
  } : _d, _e = options.delimiter, delimiter = _e === void 0 ? "/#?" : _e, _f = options.endsWith, endsWith = _f === void 0 ? "" : _f;
  var endsWithRe = "[".concat(escapeString(endsWith), "]|$");
  var delimiterRe = "[".concat(escapeString(delimiter), "]");
  var route = start ? "^" : "";
  for (var _i = 0, tokens_1 = tokens; _i < tokens_1.length; _i++) {
    var token = tokens_1[_i];
    if (typeof token === "string") {
      route += escapeString(encode(token));
    } else {
      var prefix = escapeString(encode(token.prefix));
      var suffix = escapeString(encode(token.suffix));
      if (token.pattern) {
        if (keys)
          keys.push(token);
        if (prefix || suffix) {
          if (token.modifier === "+" || token.modifier === "*") {
            var mod = token.modifier === "*" ? "?" : "";
            route += "(?:".concat(prefix, "((?:").concat(token.pattern, ")(?:").concat(suffix).concat(prefix, "(?:").concat(token.pattern, "))*)").concat(suffix, ")").concat(mod);
          } else {
            route += "(?:".concat(prefix, "(").concat(token.pattern, ")").concat(suffix, ")").concat(token.modifier);
          }
        } else {
          if (token.modifier === "+" || token.modifier === "*") {
            throw new TypeError('Can not repeat "'.concat(token.name, '" without a prefix and suffix'));
          }
          route += "(".concat(token.pattern, ")").concat(token.modifier);
        }
      } else {
        route += "(?:".concat(prefix).concat(suffix, ")").concat(token.modifier);
      }
    }
  }
  if (end) {
    if (!strict)
      route += "".concat(delimiterRe, "?");
    route += !options.endsWith ? "$" : "(?=".concat(endsWithRe, ")");
  } else {
    var endToken = tokens[tokens.length - 1];
    var isEndDelimited = typeof endToken === "string" ? delimiterRe.indexOf(endToken[endToken.length - 1]) > -1 : endToken === void 0;
    if (!strict) {
      route += "(?:".concat(delimiterRe, "(?=").concat(endsWithRe, "))?");
    }
    if (!isEndDelimited) {
      route += "(?=".concat(delimiterRe, "|").concat(endsWithRe, ")");
    }
  }
  return new RegExp(route, flags(options));
}
__name(tokensToRegexp, "tokensToRegexp");
function pathToRegexp(path, keys, options) {
  if (path instanceof RegExp)
    return regexpToRegexp(path, keys);
  if (Array.isArray(path))
    return arrayToRegexp(path, keys, options);
  return stringToRegexp(path, keys, options);
}
__name(pathToRegexp, "pathToRegexp");

// ../node_modules/wrangler/templates/pages-template-worker.ts
var escapeRegex = /[.+?^${}()|[\]\\]/g;
function* executeRequest(request) {
  const requestPath = new URL(request.url).pathname;
  for (const route of [...routes].reverse()) {
    if (route.method && route.method !== request.method) {
      continue;
    }
    const routeMatcher = match(route.routePath.replace(escapeRegex, "\\$&"), {
      end: false
    });
    const mountMatcher = match(route.mountPath.replace(escapeRegex, "\\$&"), {
      end: false
    });
    const matchResult = routeMatcher(requestPath);
    const mountMatchResult = mountMatcher(requestPath);
    if (matchResult && mountMatchResult) {
      for (const handler of route.middlewares.flat()) {
        yield {
          handler,
          params: matchResult.params,
          path: mountMatchResult.path
        };
      }
    }
  }
  for (const route of routes) {
    if (route.method && route.method !== request.method) {
      continue;
    }
    const routeMatcher = match(route.routePath.replace(escapeRegex, "\\$&"), {
      end: true
    });
    const mountMatcher = match(route.mountPath.replace(escapeRegex, "\\$&"), {
      end: false
    });
    const matchResult = routeMatcher(requestPath);
    const mountMatchResult = mountMatcher(requestPath);
    if (matchResult && mountMatchResult && route.modules.length) {
      for (const handler of route.modules.flat()) {
        yield {
          handler,
          params: matchResult.params,
          path: matchResult.path
        };
      }
      break;
    }
  }
}
__name(executeRequest, "executeRequest");
var pages_template_worker_default = {
  async fetch(originalRequest, env, workerContext) {
    let request = originalRequest;
    const handlerIterator = executeRequest(request);
    let data = {};
    let isFailOpen = false;
    const next = /* @__PURE__ */ __name(async (input, init) => {
      if (input !== void 0) {
        let url = input;
        if (typeof input === "string") {
          url = new URL(input, request.url).toString();
        }
        request = new Request(url, init);
      }
      const result = handlerIterator.next();
      if (result.done === false) {
        const { handler, params, path } = result.value;
        const context = {
          request: new Request(request.clone()),
          functionPath: path,
          next,
          params,
          get data() {
            return data;
          },
          set data(value) {
            if (typeof value !== "object" || value === null) {
              throw new Error("context.data must be an object");
            }
            data = value;
          },
          env,
          waitUntil: workerContext.waitUntil.bind(workerContext),
          passThroughOnException: /* @__PURE__ */ __name(() => {
            isFailOpen = true;
          }, "passThroughOnException")
        };
        const response = await handler(context);
        if (!(response instanceof Response)) {
          throw new Error("Your Pages function should return a Response");
        }
        return cloneResponse(response);
      } else if ("ASSETS") {
        const response = await env["ASSETS"].fetch(request);
        return cloneResponse(response);
      } else {
        const response = await fetch(request);
        return cloneResponse(response);
      }
    }, "next");
    try {
      return await next();
    } catch (error) {
      if (isFailOpen) {
        const response = await env["ASSETS"].fetch(request);
        return cloneResponse(response);
      }
      throw error;
    }
  }
};
var cloneResponse = /* @__PURE__ */ __name((response) => (
  // https://fetch.spec.whatwg.org/#null-body-status
  new Response(
    [101, 204, 205, 304].includes(response.status) ? null : response.body,
    response
  )
), "cloneResponse");
export {
  pages_template_worker_default as default
};
