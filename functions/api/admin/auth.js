import { json, requireAdmin } from '../_lib.js'

const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,OPTIONS',
  'access-control-allow-headers': 'authorization,content-type',
}

export const onRequestOptions = () => new Response(null, { headers: cors })

export async function onRequestGet({ request, env }) {
  if (!(await requireAdmin(request, env))) {
    return json({ error: 'unauthorized' }, { status: 401, headers: cors })
  }
  return json({ ok: true }, { headers: cors })
}
