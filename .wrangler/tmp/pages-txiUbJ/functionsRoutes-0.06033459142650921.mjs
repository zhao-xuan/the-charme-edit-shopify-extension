import { onRequestDelete as __api_admin_charms_js_onRequestDelete } from "/Users/a4o-zhaoxu/Desktop/the-charme-edit-shopify-extension/functions/api/admin/charms.js"
import { onRequestOptions as __api_admin_charms_js_onRequestOptions } from "/Users/a4o-zhaoxu/Desktop/the-charme-edit-shopify-extension/functions/api/admin/charms.js"
import { onRequestPatch as __api_admin_charms_js_onRequestPatch } from "/Users/a4o-zhaoxu/Desktop/the-charme-edit-shopify-extension/functions/api/admin/charms.js"
import { onRequestPost as __api_admin_charms_js_onRequestPost } from "/Users/a4o-zhaoxu/Desktop/the-charme-edit-shopify-extension/functions/api/admin/charms.js"
import { onRequestOptions as __api_admin_override_js_onRequestOptions } from "/Users/a4o-zhaoxu/Desktop/the-charme-edit-shopify-extension/functions/api/admin/override.js"
import { onRequestPost as __api_admin_override_js_onRequestPost } from "/Users/a4o-zhaoxu/Desktop/the-charme-edit-shopify-extension/functions/api/admin/override.js"
import { onRequestDelete as __api_admin_products_js_onRequestDelete } from "/Users/a4o-zhaoxu/Desktop/the-charme-edit-shopify-extension/functions/api/admin/products.js"
import { onRequestOptions as __api_admin_products_js_onRequestOptions } from "/Users/a4o-zhaoxu/Desktop/the-charme-edit-shopify-extension/functions/api/admin/products.js"
import { onRequestPost as __api_admin_products_js_onRequestPost } from "/Users/a4o-zhaoxu/Desktop/the-charme-edit-shopify-extension/functions/api/admin/products.js"
import { onRequestOptions as __api_shopify_draft_order_js_onRequestOptions } from "/Users/a4o-zhaoxu/Desktop/the-charme-edit-shopify-extension/functions/api/shopify/draft-order.js"
import { onRequestPost as __api_shopify_draft_order_js_onRequestPost } from "/Users/a4o-zhaoxu/Desktop/the-charme-edit-shopify-extension/functions/api/shopify/draft-order.js"
import { onRequestGet as __api_image__key__js_onRequestGet } from "/Users/a4o-zhaoxu/Desktop/the-charme-edit-shopify-extension/functions/api/image/[key].js"
import { onRequestGet as __api_preset__handle__js_onRequestGet } from "/Users/a4o-zhaoxu/Desktop/the-charme-edit-shopify-extension/functions/api/preset/[handle].js"
import { onRequestPost as __api_preset__handle__js_onRequestPost } from "/Users/a4o-zhaoxu/Desktop/the-charme-edit-shopify-extension/functions/api/preset/[handle].js"
import { onRequestGet as __api_catalog_js_onRequestGet } from "/Users/a4o-zhaoxu/Desktop/the-charme-edit-shopify-extension/functions/api/catalog.js"

export const routes = [
    {
      routePath: "/api/admin/charms",
      mountPath: "/api/admin",
      method: "DELETE",
      middlewares: [],
      modules: [__api_admin_charms_js_onRequestDelete],
    },
  {
      routePath: "/api/admin/charms",
      mountPath: "/api/admin",
      method: "OPTIONS",
      middlewares: [],
      modules: [__api_admin_charms_js_onRequestOptions],
    },
  {
      routePath: "/api/admin/charms",
      mountPath: "/api/admin",
      method: "PATCH",
      middlewares: [],
      modules: [__api_admin_charms_js_onRequestPatch],
    },
  {
      routePath: "/api/admin/charms",
      mountPath: "/api/admin",
      method: "POST",
      middlewares: [],
      modules: [__api_admin_charms_js_onRequestPost],
    },
  {
      routePath: "/api/admin/override",
      mountPath: "/api/admin",
      method: "OPTIONS",
      middlewares: [],
      modules: [__api_admin_override_js_onRequestOptions],
    },
  {
      routePath: "/api/admin/override",
      mountPath: "/api/admin",
      method: "POST",
      middlewares: [],
      modules: [__api_admin_override_js_onRequestPost],
    },
  {
      routePath: "/api/admin/products",
      mountPath: "/api/admin",
      method: "DELETE",
      middlewares: [],
      modules: [__api_admin_products_js_onRequestDelete],
    },
  {
      routePath: "/api/admin/products",
      mountPath: "/api/admin",
      method: "OPTIONS",
      middlewares: [],
      modules: [__api_admin_products_js_onRequestOptions],
    },
  {
      routePath: "/api/admin/products",
      mountPath: "/api/admin",
      method: "POST",
      middlewares: [],
      modules: [__api_admin_products_js_onRequestPost],
    },
  {
      routePath: "/api/shopify/draft-order",
      mountPath: "/api/shopify",
      method: "OPTIONS",
      middlewares: [],
      modules: [__api_shopify_draft_order_js_onRequestOptions],
    },
  {
      routePath: "/api/shopify/draft-order",
      mountPath: "/api/shopify",
      method: "POST",
      middlewares: [],
      modules: [__api_shopify_draft_order_js_onRequestPost],
    },
  {
      routePath: "/api/image/:key",
      mountPath: "/api/image",
      method: "GET",
      middlewares: [],
      modules: [__api_image__key__js_onRequestGet],
    },
  {
      routePath: "/api/preset/:handle",
      mountPath: "/api/preset",
      method: "GET",
      middlewares: [],
      modules: [__api_preset__handle__js_onRequestGet],
    },
  {
      routePath: "/api/preset/:handle",
      mountPath: "/api/preset",
      method: "POST",
      middlewares: [],
      modules: [__api_preset__handle__js_onRequestPost],
    },
  {
      routePath: "/api/catalog",
      mountPath: "/api",
      method: "GET",
      middlewares: [],
      modules: [__api_catalog_js_onRequestGet],
    },
  ]