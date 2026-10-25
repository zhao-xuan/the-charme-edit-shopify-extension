import { adminAuthHeaders } from '../lib/adminApi.js'

// Studio lives alongside its own Pages Functions; never silently write a preview to production.
const base = () => typeof window !== 'undefined' ? String(window.CharmeConfig?.studioApiBase || '').replace(/\/$/,'') : ''
export function studioPath(path, search = typeof window !== 'undefined' ? window.location.search : '') {
  const url = new URL(path, 'https://studio.invalid')
  const shop = new URLSearchParams(search).get('shop')
  if (shop) url.searchParams.set('shop', shop)
  return `${url.pathname}${url.search}`
}
async function request(path, {method='GET',body,secret,admin=false}={}) {
  const headers=admin ? await adminAuthHeaders() : {'content-type':'application/json'}
  if (secret) headers.authorization=`Design ${secret}`
  const response=await fetch(`${base()}${studioPath(path)}`,{method,headers,cache:'no-store',...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(20000)})
  const result=await response.json().catch(() => ({error:'后端尚未启动或返回格式不正确。'}))
  if (!response.ok || result.error) throw new Error(result.error || '请求失败。')
  return result
}
export const studioApi = {
  templates:() => request('/api/studio/templates'),
  adminTemplates:() => request('/api/admin/studio/templates',{admin:true}),
  publishedCustomizer:(id) => request(`/api/studio/customizers/${encodeURIComponent(id)}`),
  customizers:() => request('/api/admin/studio/customizers',{admin:true}),
  createCustomizer:(body) => request('/api/admin/studio/customizers',{method:'POST',body,admin:true}),
  updateCustomizer:(body) => request('/api/admin/studio/customizers',{method:'PATCH',body,admin:true}),
  deleteCustomizer:(id) => request(`/api/admin/studio/customizers?id=${encodeURIComponent(id)}`,{method:'DELETE',admin:true}),
  saveTemplate:(template) => request('/api/admin/studio/templates',{method:'POST',body:{template,revision:template.version},admin:true}),
  create:(id,secret,document,customizerId) => request('/api/studio/designs',{method:'POST',secret,body:{id,document,customizerId}}),
  load:(id,secret,admin=false) => request(`/api/studio/designs/${encodeURIComponent(id)}`,{secret,admin}),
  save:(record,secret,document,action='save') => request(`/api/studio/designs/${record.id}`,{method:'PATCH',secret,body:{revision:record.revision,document,action}}),
  deleteDesign:(id,secret,admin=false) => request(`/api/studio/designs/${encodeURIComponent(id)}`,{method:'DELETE',secret,admin}),
  requests:(before) => request(`/api/admin/studio/requests${before?`?before=${encodeURIComponent(before)}`:''}`,{admin:true}),
  review:(body) => request('/api/admin/studio/requests',{method:'POST',body,admin:true}),
  variants:(q) => request(`/api/admin/studio/variants?q=${encodeURIComponent(q)}`,{admin:true}),
  analytics:(days) => request(`/api/admin/studio/analytics?days=${days}`,{admin:true}),
  subscription:() => request('/api/admin/studio/subscription',{admin:true}),
  track:(event,sessionId,templateId,device,materialIds=[]) => request('/api/studio/analytics',{method:'POST',body:{event,sessionId,templateId,device,materialIds}}),
  trackBeacon:(event,sessionId,templateId,device) => {
    try {navigator.sendBeacon(`${base()}${studioPath('/api/studio/analytics')}`,new Blob([JSON.stringify({event,sessionId,templateId,device})],{type:'application/json'}))} catch { /* analytics must never block cart navigation */ }
  },
  quote:(record,secret,country) => request('/api/studio/checkout',{method:'POST',secret,body:{id:record.id,revision:record.revision,country}}),
}
export function designCredentials() {
  return {id:crypto.randomUUID(),secret:[...crypto.getRandomValues(new Uint8Array(32))].map((b) => b.toString(16).padStart(2,'0')).join('')}
}
export function downloadFile(name,content,type='application/json') {
  const url=URL.createObjectURL(new Blob([content],{type})),link=document.createElement('a')
  link.href=url;link.download=name;link.click();setTimeout(() => URL.revokeObjectURL(url),1000)
}
export async function readArtwork(file) {
  if (!['image/png','image/jpeg','image/webp'].includes(file.type) || file.size>12*1024*1024) throw new Error('请选择小于 12 MB 的 PNG、JPEG 或 WebP。')
  const image=await createImageBitmap(file)
  try {
    let scale=Math.min(1,1600/Math.max(image.width,image.height)),src=''
    for (let i=0;i<8;i++) {
      const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(image.width*scale));canvas.height=Math.max(1,Math.round(image.height*scale))
      canvas.getContext('2d').drawImage(image,0,0,canvas.width,canvas.height)
      src=canvas.toDataURL('image/png')
      if (src.length<=350000) return src
      scale*=0.75
    }
    throw new Error('图片过于复杂，请裁切或压缩后重试。')
  } finally { image.close() }
}
