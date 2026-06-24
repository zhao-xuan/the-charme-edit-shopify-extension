/**
 * compile-categories.mjs
 * -------------------------------------------------------------------------
 * Turns the hand-reviewed montage decisions (cell-ordered, per source sheet)
 * into per-charm category records, a taxonomy summary, and patches them back
 * into reference/pieces-tracking.json:
 *   - taxonomy:           majors -> subs -> counts
 *   - cutoutCategories:   <cutoutId> -> { major, sub, label, name }
 *   - each tracked piece gets category/subcategory copied from its nearestCutout
 * Also writes reference/charm-categories.json (the clean per-cutout list the
 * catalog rebuild consumes).
 *
 * Run: node scripts/compile-categories.mjs
 * -------------------------------------------------------------------------
 */
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const REF = join(ROOT, 'reference')
const MONT = join(REF, '_montage')

// Decisions in CELL ORDER (cell 1..N) per montage sheet. Format: "major/sub" or
// "major/sub:label". label = the letter/number/zodiac value, or a variant tag.
const DECISIONS = {
  'sheet01-2075D4E3-C7DD-4C32-BBD0-38BC5DDFCF9B': [
    'gold/other:seahorse', 'gold/celestial:sun', 'gold/angel',
    'gold/letter:C', 'gold/letter:A', 'gold/letter:B', 'gold/letter:D', 'gold/letter:E',
    'gold/symbol:infinity', 'gold/letter:G', 'gold/letter:H', 'gold/letter:I', 'gold/letter:J', 'gold/letter:F',
    'gold/celestial:compass', 'gold/letter:K', 'gold/letter:L', 'gold/letter:M', 'gold/letter:N', 'gold/letter:O',
    'gold/number:2', 'gold/number:1', 'gold/number:0', 'gold/letter:P', 'gold/letter:Q', 'gold/letter:R',
    'gold/letter:S', 'gold/letter:T', 'gold/letter:U', 'gold/letter:V', 'gold/letter:W', 'gold/letter:X',
    'gold/letter:Y', 'gold/letter:Z', 'gold/celestial:moon', 'gold/number:5', 'gold/number:3', 'gold/number:4',
    'gold/zodiac:Leo', 'gold/zodiac:Cancer', 'gold/zodiac:Taurus', 'gold/zodiac:Aries',
    'gold/number:9', 'gold/number:8', 'gold/celestial:moon', 'gold/number:7', 'gold/number:6',
    'gold/zodiac:Pisces', 'gold/zodiac:Libra', 'gold/zodiac:Scorpio', 'gold/zodiac:Aquarius',
    'gold/symbol:branch', 'gold/angel', 'gold/celestial:sun',
    'gold/zodiac:Capricorn', 'gold/zodiac:Gemini', 'gold/zodiac:Sagittarius', 'gold/zodiac:Virgo',
  ],
  'sheet02-52E483C2-C80E-4920-998C-C7BF5AA59B8A': [
    'silver/celestial:sun', 'natural/flower', 'silver/symbol:fan', 'silver/shell', 'natural/pearl:flower', 'silver/bow',
    'silver/letter:A', 'silver/letter:B', 'silver/letter:C', 'silver/letter:D', 'natural/animal:dog', 'silver/flower:rose',
    'silver/shell:nautilus', 'silver/symbol:pin-heart', 'silver/letter:E', 'silver/letter:H', 'silver/letter:F', 'silver/letter:G',
    'silver/letter:I', 'natural/animal:rabbit', 'natural/bow:pearl', 'silver/letter:K', 'silver/letter:L', 'silver/letter:M',
    'silver/letter:J', 'silver/letter:O', 'silver/letter:N', 'silver/letter:P', 'silver/letter:Q', 'silver/letter:R',
    'natural/other:pin', 'natural/other:vial', 'natural/stone:amber', 'silver/celestial:moon', 'natural/animal:butterfly',
    'silver/letter:S', 'silver/letter:T', 'silver/letter:U', 'silver/letter:V', 'natural/pearl', 'silver/letter:Y',
    'silver/letter:W', 'silver/letter:X', 'silver/letter:Z', 'natural/pearl:baroque', 'silver/symbol:pin-heart',
    'silver/flower:rose', 'silver/bow', 'natural/flower', 'natural/angel',
  ],
  'sheet03-7561DD4B-DA89-4F19-A1FF-D75FF5B41698': [
    'gold/flower:rose', 'gold/shell', 'gold/shell:nautilus', 'gold/symbol:music', 'gold/star', 'gold/symbol:guitar',
    'gold/symbol:music-clef', 'gold/animal:dolphin', 'gold/shell:cowrie', 'gold/bow', 'gold/symbol:key', 'gold/symbol:violin',
    'gold/symbol:key', 'gold/animal:starfish', 'gold/gem:pearl', 'gold/celestial:moon', 'gold/shell:cowrie',
    'gold/symbol:medallion', 'gold/symbol:coin', 'gold/symbol:bow-arrow',
  ],
  'sheet04-B4066F7A-23C7-4C9C-9454-6D9D31133B23': [
    'natural/shell:cameo', 'natural/stone', 'natural/shell', 'natural/stone', 'natural/shell:abalone', 'natural/shell',
    'natural/stone', 'natural/shell', 'natural/shell', 'natural/pearl', 'natural/shell:scallop', 'natural/stone',
    'natural/shell:abalone', 'natural/stone:seaglass', 'natural/shell:scallop', 'natural/pearl', 'natural/pearl',
    'natural/shell', 'natural/shell:scallop', 'natural/coral', 'natural/pearl:abalone',
  ],
  'sheet05-DDCC0C89-AC31-4ABB-B784-1406F89C9BBB': [
    'gold/symbol:cross', 'gold/celestial:sun', 'gold/symbol:ring', 'gold/gem:pearl', 'gold/symbol:scales', 'gold/flower:rose',
    'gold/flower:cameo-rose', 'gold/heart', 'gold/bow', 'gold/celestial:sun', 'gold/celestial:sun', 'gold/angel',
    'gold/flower', 'gold/symbol:boot', 'gold/gem:stone', 'gold/symbol:card-ace', 'gold/symbol:goblet', 'gold/star',
    'gold/flower', 'gold/celestial:moon', 'gold/angel', 'gold/celestial:sun', 'gold/celestial:sun', 'gold/shell',
    'gold/celestial:moon', 'gold/celestial:sun', 'gold/symbol:racket', 'gold/flower:leaf', 'gold/star', 'gold/bow',
    'gold/star', 'gold/flower:grapes', 'gold/celestial:moon', 'gold/gem:pearl',
  ],
  'sheet06-E540AC60-3CA6-447F-833A-9234EEC3B235': [
    'natural/shell', 'natural/shell', 'natural/shell', 'natural/shell', 'natural/stone', 'natural/stone', 'natural/shell',
    'natural/pottery', 'natural/stone', 'natural/stone', 'natural/stone', 'natural/stone:seaglass', 'natural/stone',
    'natural/pottery', 'natural/stone', 'natural/shell', 'natural/stone', 'natural/shell', 'natural/stone:seaglass',
    'natural/stone:seaglass', 'natural/stone', 'natural/stone', 'natural/stone', 'natural/stone', 'natural/pottery',
    'natural/stone', 'natural/shell', 'natural/stone', 'natural/gem:amethyst', 'natural/stone', 'natural/pottery',
    'natural/stone', 'natural/stone', 'natural/stone', 'natural/stone:seaglass', 'natural/pottery', 'natural/shell',
    'natural/shell', 'natural/stone', 'natural/pottery',
  ],
  'sheet07-E7E403B5-CE76-47E7-808B-F552FDF2B7E9': [
    'colourful/symbol:boot', 'natural/shell', 'colourful/symbol:diamond', 'natural/shell', 'colourful/symbol:lips',
    'colourful/symbol:card-ace', 'colourful/symbol:card-sun', 'gold/symbol:cross', 'natural/moon', 'natural/star',
    'natural/other:cloud', 'colourful/symbol:tooth', 'colourful/symbol:card-flower', 'colourful/fruit:pomegranate',
    'natural/flower', 'natural/star', 'natural/star', 'silver/symbol:mirror', 'colourful/flower:cloisonne', 'natural/coral',
    'natural/stone:tortoise', 'colourful/symbol:card-flower', 'natural/stone:amber', 'natural/moon', 'natural/moon',
    'natural/star', 'natural/star', 'natural/moon', 'natural/moon', 'natural/coral', 'colourful/flower:cameo', 'gold/heart',
    'natural/stone', 'colourful/symbol:eye',
  ],
  'sheet08-image2': [
    'colourful/symbol:boot', 'colourful/heart', 'colourful/fruit:strawberry', 'colourful/fruit:chili', 'colourful/flower:rose',
    'colourful/flower:rose', 'colourful/flower:rose', 'natural/shell', 'colourful/shell', 'colourful/shell', 'colourful/heart',
    'colourful/flower:rose', 'colourful/fruit:cherry', 'colourful/symbol:eye', 'colourful/gem', 'colourful/bow', 'colourful/bow',
    'colourful/flower:daisy', 'silver/heart', 'natural/ceramic', 'natural/ceramic', 'natural/ceramic', 'natural/ceramic',
    'colourful/flower:porcelain', 'colourful/symbol:ornament', 'gold/symbol:filigree', 'gold/symbol:coil', 'gold/symbol:spiral',
    'colourful/heart', 'colourful/bow', 'colourful/heart:porcelain', 'colourful/heart:porcelain', 'colourful/heart:porcelain',
    'colourful/bow', 'colourful/heart:porcelain',
  ],
  'sheet09-image3': [
    'colourful/symbol:boot', 'colourful/flower:resin', 'colourful/flower:resin', 'colourful/flower:resin',
    'colourful/symbol:card-ace', 'colourful/symbol:card-suit', 'colourful/symbol:card-sun', 'colourful/symbol:lips',
    'colourful/flower:plumeria', 'natural/stone:marble', 'natural/stone:marble', 'colourful/flower:tulip',
    'colourful/flower:lily', 'colourful/flower:rose', 'colourful/symbol:tooth', 'colourful/fruit:pomegranate',
    'silver/symbol:mirror', 'natural/stone:amber', 'colourful/heart', 'colourful/heart', 'natural/stone:tortoise',
    'colourful/flower:rose', 'colourful/flower:cloisonne', 'colourful/flower:rose', 'natural/stone:amber',
    'colourful/flower:plumeria', 'colourful/flower:plumeria', 'colourful/flower:rose', 'colourful/bow', 'colourful/symbol:eye',
    'colourful/heart:porcelain', 'colourful/heart:porcelain', 'colourful/heart:porcelain',
  ],
  'sheet10-silver': [
    'silver/symbol:racket', 'silver/symbol:key', 'silver/heart', 'silver/symbol:bow-arrow', 'silver/gem:pearl',
    'silver/symbol:dress', 'silver/symbol:scales', 'silver/bow', 'silver/heart', 'silver/symbol:ballerina', 'silver/angel',
    'silver/symbol:ballet-shoes', 'silver/star', 'silver/symbol:key', 'silver/symbol:coin', 'silver/gem:pearl',
    'silver/gem:pearl', 'silver/symbol:key', 'silver/symbol:boot', 'silver/symbol:branch', 'silver/heart', 'silver/gem:stone',
    'silver/celestial:planet', 'silver/symbol:cards', 'silver/animal:leopard', 'silver/celestial:planet',
  ],
}

const MAJOR_LABEL = { gold: 'Gold', silver: 'Silver', natural: 'Natural', colourful: 'Colourful' }
const SUB_LABEL = {
  letter: 'Letters', number: 'Numbers', zodiac: 'Zodiac signs', celestial: 'Celestial', angel: 'Angels & cherubs',
  symbol: 'Symbols & icons', animal: 'Animals', flower: 'Flowers', heart: 'Hearts', star: 'Stars', moon: 'Moons',
  bow: 'Bows', fruit: 'Fruit', shell: 'Shells', pearl: 'Pearls', stone: 'Stones', gem: 'Crystals & gems',
  pottery: 'Sea pottery', ceramic: 'Ceramic', coral: 'Coral', other: 'One of a kind',
}
const title = (s) => s.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())

function makeName(major, sub, label) {
  const M = MAJOR_LABEL[major]
  if (sub === 'letter') return `${M} Letter ${label}`
  if (sub === 'number') return `${M} Number ${label}`
  if (sub === 'zodiac') return `${M} Zodiac · ${label}`
  const noun = {
    celestial: label ? title(label) : 'Celestial',
    angel: 'Angel', symbol: label ? title(label) : 'Charm', animal: label ? title(label) : 'Animal',
    flower: label && label !== 'resin' && label !== 'cameo' && label !== 'porcelain' ? title(label) : 'Flower',
    heart: label === 'porcelain' ? 'Porcelain Heart' : 'Heart', star: 'Star', moon: 'Moon',
    bow: label === 'pearl' ? 'Pearl Bow' : 'Bow', fruit: label ? title(label) : 'Fruit',
    shell: label && label !== 'cameo' ? `${title(label)} Shell` : (label === 'cameo' ? 'Shell Cameo' : 'Shell'),
    pearl: label === 'baroque' ? 'Baroque Pearl' : label === 'abalone' ? 'Abalone Pearl' : label === 'flower' ? 'Pearl Flower' : 'Pearl',
    stone: label === 'seaglass' ? 'Sea Glass' : label === 'amber' ? 'Amber' : label === 'marble' ? 'Marble' : label === 'tortoise' ? 'Tortoiseshell' : 'Stone',
    gem: label === 'amethyst' ? 'Amethyst' : label === 'pearl' ? 'Pearl' : label === 'stone' ? 'Gemstone' : 'Gem',
    pottery: 'Sea Pottery', ceramic: 'Ceramic', coral: 'Coral',
    other: label ? title(label) : 'Charm',
  }[sub] || title(sub)
  return `${M} ${noun}`
}

async function main() {
  const legend = JSON.parse(await readFile(join(MONT, 'legend.json'), 'utf8'))
  const manifestById = new Map(
    JSON.parse(await readFile(join(REF, '3-charms-each-piece', 'manifest.json'), 'utf8'))
      .pieces.map((p) => [p.id, p]),
  )

  const cutoutCategories = {}
  const records = []
  let total = 0
  for (const [sheet, decisions] of Object.entries(DECISIONS)) {
    const cells = legend[sheet]
    if (!cells) throw new Error(`No legend for ${sheet}`)
    if (cells.length !== decisions.length) {
      throw new Error(`${sheet}: legend ${cells.length} != decisions ${decisions.length}`)
    }
    for (let i = 0; i < cells.length; i++) {
      const id = cells[i].id
      const [majorSub, label = ''] = decisions[i].split(':')
      const [major, sub] = majorSub.split('/')
      if (!MAJOR_LABEL[major]) throw new Error(`bad major ${major} in ${sheet} cell ${i + 1}`)
      const name = makeName(major, sub, label)
      const rec = { id, major, sub, label: label || null, name, src: cells[i].src, pxW: cells[i].pxW, pxH: cells[i].pxH }
      cutoutCategories[id] = { major, sub, label: label || null, name }
      records.push(rec)
      total++
    }
  }

  // taxonomy summary
  const majors = {}
  for (const r of records) {
    majors[r.major] ??= { key: r.major, label: MAJOR_LABEL[r.major], count: 0, subs: {} }
    majors[r.major].count++
    const s = majors[r.major].subs
    s[r.sub] ??= { key: r.sub, label: SUB_LABEL[r.sub] || title(r.sub), count: 0 }
    s[r.sub].count++
  }
  const taxonomy = {
    generatedAt: new Date().toISOString(),
    majors: ['gold', 'silver', 'natural', 'colourful'].map((m) => ({
      ...majors[m],
      subs: Object.values(majors[m].subs).sort((a, b) => b.count - a.count),
    })),
  }

  // write the clean per-cutout list
  await writeFile(join(REF, 'charm-categories.json'),
    JSON.stringify({ generatedAt: taxonomy.generatedAt, count: total, taxonomy, charms: records }, null, 2))

  // patch pieces-tracking.json
  const trackingPath = join(REF, 'pieces-tracking.json')
  const tracking = JSON.parse(await readFile(trackingPath, 'utf8'))
  tracking.taxonomy = taxonomy
  tracking.cutoutCategories = cutoutCategories
  let linked = 0
  for (const p of tracking.pieces) {
    const cut = p.nearestCutout && p.nearestCutout.file
    const cutId = cut ? cut.replace(/\.png$/i, '') : null
    const cat = cutId && cutoutCategories[cutId]
    if (cat) {
      p.category = cat.major
      p.subcategory = cat.sub
      p.categoryName = cat.name
      linked++
    } else {
      p.category = p.category || null
      p.subcategory = p.subcategory || null
    }
  }
  await writeFile(trackingPath, JSON.stringify(tracking, null, 2))

  console.log(`categorized ${total} cutouts`) // eslint-disable-line
  console.log('majors:', taxonomy.majors.map((m) => `${m.key}:${m.count}`).join('  ')) // eslint-disable-line
  for (const m of taxonomy.majors) {
    console.log(`  ${m.key}:`, m.subs.map((s) => `${s.key}(${s.count})`).join(' ')) // eslint-disable-line
  }
  console.log(`tracked pieces linked to a category via nearestCutout: ${linked}/${tracking.pieces.length}`) // eslint-disable-line
}
main()
