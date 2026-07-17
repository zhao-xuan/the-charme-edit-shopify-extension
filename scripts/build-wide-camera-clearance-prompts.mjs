import { mkdir, readFile, writeFile } from 'node:fs/promises'

const GUIDE = 'gpt-wide-camera-clearance-guide.png'
const SOURCE_MANIFESTS = [
  'reference/case-history/v2-prompts.json',
  'reference/case-history/iphone-16-17-standard-prompts.json',
]
const OUTPUT_PATH = 'reference/case-history/wide-camera-clearance-prompts.json'

const guideAuthority = `USER-APPROVED WIDE CAMERA CLEARANCE - HIGHEST PRIORITY: the additional attached ${GUIDE} is authoritative for camera-side DISTANCE and CURVE only. Its red line marks the nearest permitted gel edge around the complete camera group. Never render the red line, guide marks or any coloured outline. Map the same visual relationship onto IMAGE 1's real hardware without copying the guide phone, camera design, shell colour or material.`

const wideClearance = `WIDE CAMERA GAP SCALE LOCK - NON-NEGOTIABLE: measure from the OUTERMOST physical edge of the complete camera hardware group - camera island, outer lens ring, flash or sensor, whichever projects farthest - to the nearest gel edge. Target a bare-shell gap of approximately 5% of the case body width; 4%-6% is acceptable, and it must NEVER be less than 4% at any point. For a 1000-pixel-wide case this visually corresponds to about 40-60 pixels. This camera gap is intentionally much wider than the one-pixel-like outer shell hairline and much wider than every previous generated result.`

const cameraPath = `WIDE CAMERA-SIDE PATH LOCK: treat all camera hardware as ONE grouped keep-out. Beneath the complete group, sweep the gel edge outward as one broad, nearly horizontal bare-shell shoulder. Beside the group, make one large smooth outward-and-upward turn with a generous radius, matching ${GUIDE}. Keep the wide band continuous around the group's bottom, side and closest corner. Do not trace the island, lens rings, flash or sensors; do not make individual notches, keyholes, pinches, narrow channels or gel bridges between hardware. The wider user-approved boundary supersedes every earlier instruction containing "small", "compact" or "camera moat", and supersedes the camera boundary shown by any accepted Black geometry reference.`

function addGuideReference(prompt) {
  return {
    ...prompt,
    promptText: updatePrompt(prompt.promptText),
    referenceImages: [...new Set([...(prompt.referenceImages || []), GUIDE])],
    conversationUrl: '',
  }
}

function updatePrompt(value) {
  let prompt = String(value)
  const firstParagraphEnd = prompt.indexOf('\n\n')
  if (firstParagraphEnd < 0) throw new Error('Prompt is missing its opening reference paragraph')
  prompt = `${prompt.slice(0, firstParagraphEnd)} The additional attached user-approved guide (${GUIDE}) controls camera clearance only.${prompt.slice(firstParagraphEnd)}`

  prompt = prompt
    .replace(
      "copy IMAGE 4's exact outer phone silhouette, width/height ratio, phone scale, framing, gel footprint, outer hairline, camera moat and raised-rim path.",
      "copy IMAGE 4's exact outer phone silhouette, width/height ratio, phone scale, framing, outer hairline and raised-rim material language. Do NOT copy IMAGE 4's gel footprint or camera moat; its camera-side boundary is superseded by the user-approved wide camera-clearance guide.",
    )
    .replaceAll('one compact rounded-square keep-out', 'one generously expanded rounded-square keep-out')
    .replaceAll('one compact vertical rounded-capsule keep-out', 'one generously expanded vertical rounded-capsule keep-out')

  prompt = prompt.replace(
    /FIXED SMALL CAMERA CLEARANCE:[\s\S]*?This same small optical clearance is required for all three finishes\./,
    `${guideAuthority}\n\n${wideClearance}\n\n${cameraPath}`,
  )

  prompt = prompt.replace(
    /RED-LINE FOOTPRINT LOCK - COPY IMAGE 2:[\s\S]*?inside that path\./,
    `STANDARD-MODEL TOPOLOGY GUIDE - IMAGE 2: IMAGE 2 controls only the standard iPhone 16/17 path topology: one broad shoulder below the vertical camera group and one smooth upward turn to the right of the flash. Do not copy IMAGE 2's old camera distance; ${GUIDE} is the higher-priority spacing authority. Never render either red line or any guide marks. Make one continuous poured-gel slab covering the large lower and right-hand usable back.`,
  )

  if (!prompt.includes(guideAuthority)) {
    prompt = prompt.replace(
      '\n\nFORBIDDEN CAMERA GEOMETRY:',
      `\n\n${guideAuthority}\n\n${wideClearance}\n\n${cameraPath}\n\nFORBIDDEN CAMERA GEOMETRY:`,
    )
  }

  prompt = prompt
    .replace('one small uniform rounded camera moat', 'one wide, smooth, grouped camera exclusion band')
    .replace(
      "camera boundary follows IMAGE 2's broad under-camera shoulder and right-of-flash upward turn",
      `camera boundary follows IMAGE 2's topology at ${GUIDE}'s wider 4%-6% spacing`,
    )

  if (!prompt.includes(wideClearance) || !prompt.includes(cameraPath)) {
    throw new Error('Could not install the wide camera-clearance policy')
  }
  return prompt
}

const manifests = await Promise.all(SOURCE_MANIFESTS.map(async (filePath) => (
  JSON.parse(await readFile(filePath, 'utf8'))
)))
const prompts = manifests.flatMap((manifest) => manifest.prompts || []).map(addGuideReference)
const keys = new Set(prompts.map((prompt) => `${prompt.modelId}:${prompt.finish}`))
if (keys.size !== prompts.length) throw new Error('Source manifests contain duplicate model/finish keys')

await mkdir('reference/case-history', { recursive: true })
await writeFile(OUTPUT_PATH, `${JSON.stringify({
  schemaVersion: 1,
  conversationUrl: '',
  policy: {
    cameraGapTargetPercent: 5,
    cameraGapMinimumPercent: 4,
    cameraGapMaximumPercent: 6,
    guide: GUIDE,
  },
  prompts,
}, null, 2)}\n`)
console.log(`Wrote ${prompts.length} prompts to ${OUTPUT_PATH}`)