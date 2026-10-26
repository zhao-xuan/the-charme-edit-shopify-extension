// Dimensions are editable starting points, never manufacturer-certified measurements.
export const PROCESSES = {
  assembly: { name: '实体装饰', accepts: ['motif'], overlap: false, deferred: [] },
  patch: { name: '贴片 / 热压', accepts: ['motif'], overlap: false, deferred: [] },
  print: { name: '平面印刷', accepts: ['text', 'image', 'motif'], overlap: true, deferred: ['印刷色彩管理与供应商原稿验收'] },
  engrave: { name: '刻字 / 雕刻', accepts: ['text', 'motif'], overlap: true, deferred: ['字体转曲与机器刀路'] },
  wrap: { name: '环绕印刷', accepts: ['text', 'image', 'motif'], overlap: true, deferred: ['3D 模型与曲面预览', '曲面生产文件适配'] },
  embroidery: { name: '刺绣', accepts: ['text', 'image', 'motif'], overlap: false, deferred: ['针法数字化 / DST、PES 机器文件'] },
  beads: { name: '串珠组装', accepts: ['bead'], overlap: false, deferred: [] },
  components: { name: '模块拼装', accepts: ['component'], overlap: false, deferred: ['组件库存与供应商装配规格'] },
}

export const WORKFLOWS = [
  { id: 'placement', name: '自由摆放', english: 'DRAG & DROP', symbol: '✳', description: '把贴片、装饰或图文拖到商品的设计面上。', detail: '适合包袋、服饰、铅笔盒、相框与手机壳。' },
  { id: 'typography', name: '文字定制', english: 'TYPE & STYLE', symbol: 'Aa', description: '输入内容，选择字体与颜色，直接预览成品位置。', detail: '适合贺卡、刻字牌与首饰镌刻。' },
  { id: 'jewelry3d', name: '3D 首饰设计', english: 'BUILD IN 3D', symbol: '◉', description: '挑选珠子、调整顺序，旋转查看参数化 3D 模型。', detail: '适合手串、项链与吊坠。' },
  { id: 'imageSwap', name: '一键换图', english: 'SWAP THE IMAGE', symbol: '▣', description: '只替换指定图片位，不需要摆放或拖动。', detail: '适合照片手机壳、相片框与照片卡。' },
  { id: 'components', name: '组件拼装', english: 'PICK THE PARTS', symbol: '▤', description: '像拼积木一样替换预设位置的商品部件。', detail: '适合模块包袋与可换配件的手机壳。' },
]

export const MATERIALS = [
  { id: 'heart', name: '爱心', shape: 'heart', width: 16, height: 16, color: '#c87374', processes: ['assembly', 'patch', 'print', 'wrap', 'engrave', 'embroidery'] },
  { id: 'star', name: '星星', shape: 'star', width: 18, height: 18, color: '#caa358', processes: ['assembly', 'patch', 'print', 'wrap', 'engrave', 'embroidery'] },
  { id: 'flower', name: '花朵', shape: 'flower', width: 20, height: 20, color: '#b4a0c9', processes: ['assembly', 'patch', 'print', 'wrap', 'embroidery'] },
  { id: 'disc', name: '圆片', shape: 'circle', width: 12, height: 12, color: '#83a9a1', processes: ['assembly', 'patch', 'print', 'wrap', 'engrave', 'embroidery'] },
  { id: 'pearl', name: '珍珠 · 8 mm', shape: 'circle', width: 8, height: 8, color: '#f3e7d4', processes: ['beads'] },
  { id: 'stone', name: '宝石珠 · 6 mm', shape: 'circle', width: 6, height: 6, color: '#8caaa4', processes: ['beads'] },
  { id: 'spacer', name: '隔珠 · 4 mm', shape: 'circle', width: 4, height: 4, color: '#caa358', processes: ['beads'] },
  { id: 'pendant', name: '金色吊坠', shape: 'star', width: 18, height: 18, color: '#caa358', processes: ['beads'] },
  { id: 'canvas-handle', name: '帆布提手', shape: 'circle', width: 24, height: 24, color: '#b89874', processes: ['components'] },
  { id: 'chain-handle', name: '金色链条', shape: 'circle', width: 24, height: 24, color: '#caa358', processes: ['components'] },
  { id: 'plain-pocket', name: '素面口袋', shape: 'circle', width: 24, height: 24, color: '#d9c9b0', processes: ['components'] },
  { id: 'quilted-pocket', name: '绗缝口袋', shape: 'star', width: 24, height: 24, color: '#9b8b7e', processes: ['components'] },
  { id: 'silver-hardware', name: '银色五金', shape: 'circle', width: 24, height: 24, color: '#a9b2b3', processes: ['components'] },
  { id: 'gold-hardware', name: '金色五金', shape: 'circle', width: 24, height: 24, color: '#caa358', processes: ['components'] },
  { id: 'plain-shell', name: '素色壳身', shape: 'circle', width: 24, height: 24, color: '#dfd4c4', processes: ['components'] },
  { id: 'dark-shell', name: '深绿壳身', shape: 'circle', width: 24, height: 24, color: '#36554b', processes: ['components'] },
]

const panel = (id, name, width, height, shape = 'rect', keepouts = []) => ({
  id, name, widthMm: width, heightMm: height, shape,
  zone: { x: 5, y: 5, width: width - 10, height: height - 10 }, keepouts,
})
const two = (width, height, shape) => [panel('front', '正面', width, height, shape), panel('back', '背面', width, height, shape)]
const make = (id, name, group, process, surfaces, description, extra = {}) => ({
  id, name, group, process, version: 1, schemaVersion: 1, enabled: false, calibrated: false,
  interaction: process === 'beads' ? 'jewelry3d' : process === 'engrave' ? 'typography' : process === 'components' ? 'components' : 'placement',
  description, surfaces, material: process === 'engrave' ? '不锈钢' : process === 'beads' ? '弹力线' : '待商家确认',
  finish: '#f4eadd', minElements: 1, maxElements: 80, maxTextLength: 40,
  minDpi: 150, minFeatureMm: process === 'engrave' ? 1 : 2,
  threadColors: ['#263f38', '#c87374', '#caa358', '#f1e9db'],
  circumferenceMm: process === 'beads' ? 180 : null, claspMm: process === 'beads' ? 15 : null,
  productionNotes: '', deferred: PROCESSES[process].deferred, ...extra,
})

export const PRODUCT_TEMPLATES = [
  make('phone-charms', '手机壳 · 饰品', '现有主品类', 'assembly', [panel('back', '背面', 78, 160, 'phone', [{ x: 8, y: 8, width: 32, height: 35, label: '镜头禁区' }])], '按真实尺寸摆放装饰，避开镜头与边缘。'),
  make('tote-patches', 'Tote · 双面贴片', '现有主品类', 'patch', two(380, 400, 'bag'), '双面独立布局，制作单合并统计贴片。'),
  make('frame-charms', '相框 · 饰品', '现有主品类', 'assembly', [panel('front', '框面', 180, 230, 'frame', [{ x: 30, y: 30, width: 120, height: 170, label: '照片开口' }])], '装饰只落在框边，保留照片开口。'),
  make('cosmetic-bag', '化妆包', '包袋与贴片', 'patch', two(220, 140, 'pouch'), '拉链区域保留，支持正背面贴片。'),
  make('pencil-case', '笔袋', '包袋与贴片', 'patch', two(200, 90, 'pouch'), '细长布局与边缘留白。'),
  make('small-bag', '小挎包', '包袋与贴片', 'patch', two(240, 220, 'bag'), '正背面独立设计，商家可设置五金禁区。'),
  make('notebook-cover', '笔记本封面', '封面与盒盖', 'assembly', [panel('front', '封面', 150, 210, 'book', [{ x: 0, y: 0, width: 15, height: 210, label: '装订边' }]), panel('back', '封底', 150, 210, 'book')], '装订边避让，封面与封底分别保存。'),
  make('storage-box', '收纳盒盖', '封面与盒盖', 'assembly', [panel('lid', '盒盖', 240, 160, 'box')], '平面装饰模板，尺寸与留边可配置。'),
  make('garment-patches', '服饰 · 实体贴片', '服饰', 'patch', [...two(300, 380, 'shirt'), panel('sleeve', '袖面', 100, 150)], '胸前、背后、袖面独立排布。', { material: '棉布', productionNotes: '热压温度、时长与面料须由制作方确认。' }),
  make('tshirt-print', 'T 恤 · 图案印刷', '印刷', 'print', [...two(300, 380, 'shirt'), panel('sleeve', '袖面', 100, 150)], '文字、图案与照片组合，检查图片有效分辨率。', { material: '棉布', minDpi: 200 }),
  make('poster-print', '海报', '印刷', 'print', [panel('front', '印刷面', 297, 420, 'poster')], 'A3 起始模板，带安全边距与分辨率检查。', { material: '纸张', minDpi: 300 }),
  make('phone-print', '手机壳 · 照片印刷', '印刷', 'print', [panel('back', '背面', 78, 160, 'phone', [{ x: 8, y: 8, width: 32, height: 35, label: '镜头禁区' }])], '照片槽一键替换，镜头区域始终避让。', { minDpi: 200, interaction: 'imageSwap' }),
  make('engraved-tag', '刻字牌', '刻字与雕刻', 'engrave', [panel('front', '正面', 60, 35, 'tag', [{ x: 2, y: 12, width: 8, height: 10, label: '挂孔' }]), panel('back', '背面', 60, 35, 'tag')], '字数与最小细节检查；导出供雕刻方审核。', { maxTextLength: 24 }),
  make('jewellery-engraving', '首饰 · 刻字', '刻字与雕刻', 'engrave', [panel('front', '吊牌正面', 40, 40, 'pendant')], '小尺寸刻字区，生产前需要字体转曲。', { maxTextLength: 12 }),
  make('greeting-card', '贺卡 · 文字', '文字与卡片', 'print', [panel('front', '封面', 140, 100, 'book'), panel('inside', '内页', 140, 100, 'book')], '输入祝福内容，选择字体与颜色，无需拖拽。', { interaction: 'typography', maxTextLength: 120, material: '卡纸' }),
  make('photo-card', '照片卡', '照片换图', 'print', [panel('front', '照片位', 100, 150, 'poster')], '替换照片位，位置与版式保持固定。', { interaction: 'imageSwap', minDpi: 300, material: '相纸' }),
  make('photo-frame', '照片相框', '照片换图', 'print', [panel('front', '照片位', 150, 200, 'frame')], '更换相框中的照片，不移动图片槽。', { interaction: 'imageSwap', minDpi: 200, material: '相纸 / 相框' }),
  make('mug-wrap', '马克杯', '杯瓶环绕', 'wrap', [panel('wrap', '展开面', 210, 90, 'wrap', [{ x: 0, y: 0, width: 12, height: 90, label: '把手 / 接缝' }, { x: 198, y: 0, width: 12, height: 90, label: '把手 / 接缝' }])], '可编辑 2D 展开面；3D 杯模暂缓。', { material: '陶瓷', minDpi: 200 }),
  make('bottle-wrap', '水瓶', '杯瓶环绕', 'wrap', [panel('wrap', '展开面', 230, 180, 'wrap', [{ x: 0, y: 0, width: 8, height: 180, label: '接缝' }, { x: 222, y: 0, width: 8, height: 180, label: '接缝' }])], '可编辑环绕区域，保留接缝；3D 与曲面输出暂缓。', { material: '不锈钢', minDpi: 200 }),
  make('embroidery', '刺绣 · 布章', '刺绣', 'embroidery', [panel('front', '绣区', 100, 100, 'hoop')], '图案、文字、线色与最小细节审核；机器打版暂缓。', { material: '刺绣底布', maxTextLength: 20, minFeatureMm: 3 }),
  make('bead-bracelet', '串珠手链', '串珠', 'beads', [panel('sequence', '珠串顺序', 200, 40, 'beads')], '珠子排序、线长、扣件余量与物料清单。'),
  make('bead-necklace', '串珠项链', '串珠', 'beads', [panel('sequence', '珠串顺序', 500, 40, 'beads')], '串联顺序与成品长度校验。', { circumferenceMm: 450, claspMm: 25, maxElements: 120 }),
  make('pendant-necklace', '吊坠项链', '首饰', 'beads', [panel('sequence', '珠串顺序', 500, 40, 'beads')], '珠链与金色吊坠的 3D 组合预览。', { circumferenceMm: 450, claspMm: 25, maxElements: 120 }),
  make('modular-bag', '模块包袋', '模块商品', 'components', [panel('front', '正面', 300, 330, 'bag')], '选择提手、口袋与五金组件，固定到预设位置。', { slots: [
    { id: 'handle', name: '提手', surfaceId: 'front', x: 150, y: 35, widthMm: 92, heightMm: 26, choices: ['canvas-handle','chain-handle'], defaultMaterialId: 'canvas-handle' },
    { id: 'pocket', name: '前袋', surfaceId: 'front', x: 150, y: 185, widthMm: 95, heightMm: 78, choices: ['plain-pocket','quilted-pocket'], defaultMaterialId: 'plain-pocket' },
    { id: 'hardware', name: '五金', surfaceId: 'front', x: 150, y: 140, widthMm: 28, heightMm: 28, choices: ['silver-hardware','gold-hardware'], defaultMaterialId: 'silver-hardware' },
  ] }),
  make('modular-phone', '模块手机壳', '模块商品', 'components', [panel('back', '背面', 78, 160, 'phone')], '选择壳身与镜头饰圈，组件不可任意拖动。', { slots: [
    { id: 'shell', name: '壳身', surfaceId: 'back', x: 39, y: 95, widthMm: 55, heightMm: 95, choices: ['plain-shell','dark-shell'], defaultMaterialId: 'plain-shell' },
    { id: 'camera', name: '镜头饰圈', surfaceId: 'back', x: 23, y: 24, widthMm: 25, heightMm: 25, choices: ['silver-hardware','gold-hardware'], defaultMaterialId: 'silver-hardware' },
  ] }),
]

for (const t of PRODUCT_TEMPLATES) {
  if (['cosmetic-bag', 'pencil-case'].includes(t.id)) for (const s of t.surfaces) s.keepouts.push({ x: 0, y: 0, width: s.widthMm, height: 15, label: '拉链区' })
  if (t.id === 'phone-print') t.surfaces[0].zone = { x: 5, y: 48, width: 68, height: 107 }
}
export const templateById = (id) => PRODUCT_TEMPLATES.find((template) => template.id === id)
export const interactionFor = (template) => template?.interaction || templateById(template?.id)?.interaction || 'placement'
