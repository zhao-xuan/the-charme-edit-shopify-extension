#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

const [sourcePath, outputPath] = process.argv.slice(2)

if (!sourcePath || !outputPath) {
  throw new Error('Usage: node scripts/build-shopify-charme-ordering-template.mjs <product.json> <output.json>')
}

const source = await readFile(sourcePath, 'utf8')
const jsonStart = source.indexOf('{')
if (jsonStart < 0) throw new Error(`No JSON object found in ${sourcePath}`)

const template = JSON.parse(source.slice(jsonStart))
const main = template.sections?.main
if (!main || main.type !== 'product-information') {
  throw new Error('Expected sections.main to use product-information')
}

const media = main.blocks?.['media-gallery']
const details = main.blocks?.['product-details']
if (media?.type !== '_product-media-gallery' || details?.type !== '_product-details') {
  throw new Error('Expected the standard media-gallery and product-details static blocks')
}

const detailOrder = details.block_order || []
const outerEntry = detailOrder.find((id) => details.blocks?.[id]?.type === 'group')
const faqEntry = detailOrder.find((id) => details.blocks?.[id]?.type === 'accordion')
if (!outerEntry || !faqEntry || detailOrder.length !== 2) {
  throw new Error('Expected product details to contain one content group and one accordion')
}

const outer = details.blocks[outerEntry]
const outerOrder = outer.block_order || []
const headingEntry = outerOrder.find((id) => outer.blocks?.[id]?.type === 'group')
const buyEntry = outerOrder.find((id) => outer.blocks?.[id]?.type === 'buy-buttons')
const headingIndex = outerOrder.indexOf(headingEntry)
const buyIndex = outerOrder.indexOf(buyEntry)
if (headingIndex !== 0 || buyIndex < 1) {
  throw new Error('Expected the heading first and buy-buttons later in the product content group')
}

const standardOrder = outerOrder.slice(headingIndex + 1, buyIndex + 1)
const afterOrder = outerOrder.slice(buyIndex + 1)
if (!standardOrder.length || !afterOrder.length) {
  throw new Error('Expected content both inside and after the standard order flow')
}

function pickBlocks(blocks, order) {
  return Object.fromEntries(order.map((id) => {
    if (!blocks[id]) throw new Error(`Missing block ${id}`)
    return [id, blocks[id]]
  }))
}

function withoutAcceleratedCheckout(block) {
  const blocks = Object.fromEntries(
    Object.entries(block.blocks || {}).filter(([, child]) => child.type !== 'accelerated-checkout'),
  )

  return {
    ...block,
    blocks,
    block_order: (block.block_order || []).filter((id) => blocks[id]),
  }
}

function titleOnlyHeading(block) {
  const titleEntry = (block.block_order || []).find((id) => {
    const child = block.blocks?.[id]
    return child?.type === 'text' && child.settings?.text?.includes('closest.product.title')
  })
  if (!titleEntry) throw new Error('Expected the product heading group to contain a product title text block')

  const title = block.blocks[titleEntry]
  return {
    ...block,
    settings: {
      ...groupSettings(block.settings || {}, 8),
      horizontal_alignment: 'center',
      horizontal_alignment_flex_direction_column: 'center',
    },
    blocks: {
      [titleEntry]: {
        ...title,
        settings: {
          ...title.settings,
          alignment: 'center',
        },
      },
    },
    block_order: [titleEntry],
  }
}

function groupSettings(settings, gap) {
  return {
    ...settings,
    content_direction: 'column',
    horizontal_alignment_flex_direction_column: 'flex-start',
    vertical_alignment_flex_direction_column: 'flex-start',
    gap,
    width: 'fill',
    custom_width: 100,
    width_mobile: 'fill',
    custom_width_mobile: 100,
    height: 'fit',
    'padding-block-start': 0,
    'padding-block-end': 0,
    'padding-inline-start': 0,
    'padding-inline-end': 0,
  }
}

function staticBlock(block, name, settings = block.settings || {}) {
  const { type, name: _name, static: _static, settings: _settings, ...rest } = block
  return { type, name, static: true, settings, ...rest }
}

const discardedRootBlocks = new Set()
const staleOxifyBlock = main.blocks?.oxify_product_options_app_block_zdeqBW
if (staleOxifyBlock?.type === 'shopify://apps/oxify-product-options/blocks/app-block/754246d8-64f3-43da-a65f-35409e2dbdcb') {
  discardedRootBlocks.add('oxify_product_options_app_block_zdeqBW')
}

const passthroughBlocks = Object.fromEntries(
  Object.entries(main.blocks || {}).filter(([id]) => (
    id !== 'media-gallery' && id !== 'product-details' && !discardedRootBlocks.has(id)
  )),
)
const standardBlocks = pickBlocks(outer.blocks, standardOrder)
standardBlocks[buyEntry] = withoutAcceleratedCheckout(standardBlocks[buyEntry])

main.type = 'charme-product-ordering'
main.blocks = {
  ...passthroughBlocks,
  'product-heading': staticBlock(
    titleOnlyHeading(outer.blocks[headingEntry]),
    'Product heading',
    titleOnlyHeading(outer.blocks[headingEntry]).settings,
  ),
  'media-gallery': {
    ...media,
    static: true,
    settings: {
      ...media.settings,
      media_presentation: 'carousel',
      aspect_ratio: '1/1.25',
      media_radius: 0,
    },
  },
  'standard-order': {
    type: 'group',
    name: 'Manual order form',
    static: true,
    settings: groupSettings(outer.settings || {}, 20),
    blocks: standardBlocks,
    block_order: standardOrder,
  },
  'after-order': {
    type: 'group',
    name: 'Product content',
    static: true,
    settings: groupSettings(outer.settings || {}, 24),
    blocks: pickBlocks(outer.blocks, afterOrder),
    block_order: afterOrder,
  },
  'product-faq': staticBlock(details.blocks[faqEntry], 'Product FAQ'),
}
const rootBlockOrder = (main.block_order || []).filter((id) => passthroughBlocks[id])
if (rootBlockOrder.length) main.block_order = rootBlockOrder
else delete main.block_order
main.settings = {
  order_heading: 'How to order a custom case?',
  order_subheading: 'Choose how you’d like to create your one-of-a-kind case.',
  design_badge: 'Option 1',
  design_heading: 'Design it yourself',
  design_text: 'Use our customiser to build your perfect case, your way.',
  design_button_label: 'Start designing',
  design_note: 'Full control over every detail',
  standard_badge: 'Option 2',
  standard_heading: 'Order manually',
  standard_text: 'We’ll design for you based on your charm selection',
  manual_step_one: 'Step 1: select your phone model and gel',
  manual_step_two: 'Step 2: choose 12-15 charms (we will design for you)',
  manual_button_label: 'Add charms',
  standard_note: 'Quick & guided process',
  content_width: 'content-center-aligned',
  equal_columns: false,
  gap: 24,
  color_scheme: main.settings?.color_scheme || 'scheme-1',
  'padding-block-start': 24,
  'padding-block-end': 48,
}

const header = `/*
 * ------------------------------------------------------------
 * IMPORTANT: The contents of this file are auto-generated.
 *
 * This file may be updated by the Shopify admin theme editor
 * or related systems. Please exercise caution as any changes
 * made to this file may be overwritten.
 * ------------------------------------------------------------
 */\n`

await mkdir(path.dirname(outputPath), { recursive: true })
await writeFile(outputPath, `${header}${JSON.stringify(template, null, 2)}\n`)

console.log(JSON.stringify({
  outputPath,
  sections: Object.keys(template.sections).length,
  sectionOrder: template.order.length,
  preservedRootBlocks: Object.keys(passthroughBlocks),
  discardedRootBlocks: [...discardedRootBlocks],
  standardOrder,
  afterOrder,
  faqEntry,
}, null, 2))