import { mkdir, readFile, writeFile } from 'node:fs/promises'

const SOURCE_PATH = 'reference/case-history/wide-camera-clearance-prompts.json'
const OUTPUT_PATH = 'reference/case-history/ultra-close-outer-edge-prompts.json'
const OUTER_REFERENCE = 'gpt-iphone-14-ultra-close-outer-fit.png'

const outerAuthority = `USER-APPROVED iPHONE 14 OUTER-EDGE BENCHMARK - HIGHEST PRIORITY FOR OUTER SPACING: the additional attached ${OUTER_REFERENCE} supplies ONLY the left, bottom and right outer gel-to-shell spacing. Match that benchmark or place the gel even slightly CLOSER to the inner shell wall. Never copy its phone model, camera, shell colour or gel material. This benchmark supersedes any wider outer border in IMAGE 1, any same-model Black geometry reference and every earlier outer-clearance number.`

const outerScale = `ULTRA-CLOSE LEFT / BOTTOM / RIGHT GAP SCALE LOCK - NON-NEGOTIABLE: measure the shortest visible bare-shell line from the OUTERMOST edge of the raised glossy gel bead to the INNER edge of the silicone shell wall. Target only 0.15%-0.30% of case body width and NEVER exceed 0.35%. On a 1000-pixel-wide case this is approximately 1.5-3 pixels, with an absolute maximum of 3.5 pixels. Preserve at least one continuous anti-aliased shell-colour pixel plus a tiny contact shadow so gel and shell remain distinct, but do not leave a normal border. When uncertain, choose the CLOSER valid placement.`

const noShrink = `OUTER FIT IS INDEPENDENT FROM CAMERA CLEARANCE: the 4%-6% wide gap applies ONLY around the camera hardware group. Everywhere else - especially the complete LEFT edge below the camera shoulder, complete BOTTOM edge, complete RIGHT edge and top-right outer segment - expand the gel outward until it nearly meets the shell wall at the ultra-close scale above. Never shrink, centre or uniformly inset the whole gel slab to create the camera gap. Keep the outer gel edge parallel to the shell wall; do not let the gap widen at mid-sides or corners, form wedges, drift inward, touch the wall or climb onto it.`

function replaceOuterRule(value) {
  let prompt = String(value)
  const firstParagraphEnd = prompt.indexOf('\n\n')
  if (firstParagraphEnd < 0) throw new Error('Prompt is missing its opening reference paragraph')
  prompt = `${prompt.slice(0, firstParagraphEnd)} The additional attached iPhone 14 benchmark (${OUTER_REFERENCE}) controls outer spacing only.${prompt.slice(firstParagraphEnd)}`

  prompt = prompt.replace(
    /FIXED VERY-CLOSE OUTER CLEARANCE - NON-NEGOTIABLE:[\s\S]*?Do not let the gel touch, overlap or climb onto the shell wall\./,
    `${outerAuthority}\n\n${outerScale}\n\n${noShrink}`,
  )
  prompt = prompt.replace(
    /VERY-CLOSE OUTER FIT:[\s\S]*?touch the shell wall or climb onto it\./,
    `${outerAuthority}\n\n${outerScale}\n\n${noShrink}`,
  )
  prompt = prompt
    .replace('outer shell hairline close, visible and equal on all sides', 'left, bottom and right outer shell hairline at or tighter than the iPhone 14 benchmark')
    .replace('very-close equal outer hairline', 'ultra-close 0.15%-0.30% left/bottom/right outer hairline')

  if (!prompt.includes(outerAuthority) || !prompt.includes(outerScale) || !prompt.includes(noShrink)) {
    throw new Error('Could not install the ultra-close outer-edge policy')
  }
  return prompt
}

const source = JSON.parse(await readFile(SOURCE_PATH, 'utf8'))
const prompts = (source.prompts || []).map((prompt) => ({
  ...prompt,
  promptText: replaceOuterRule(prompt.promptText),
  referenceImages: [...new Set([...(prompt.referenceImages || []), OUTER_REFERENCE])],
  conversationUrl: '',
}))
const keys = new Set(prompts.map((prompt) => `${prompt.modelId}:${prompt.finish}`))
if (keys.size !== prompts.length) throw new Error('Source manifest contains duplicate model/finish keys')

await mkdir('reference/case-history', { recursive: true })
await writeFile(OUTPUT_PATH, `${JSON.stringify({
  schemaVersion: 1,
  conversationUrl: '',
  policy: {
    ...(source.policy || {}),
    outerEdgeReference: OUTER_REFERENCE,
    outerGapTargetMinimumPercent: 0.15,
    outerGapTargetMaximumPercent: 0.3,
    outerGapAbsoluteMaximumPercent: 0.35,
  },
  prompts,
}, null, 2)}\n`)
console.log(`Wrote ${prompts.length} prompts to ${OUTPUT_PATH}`)