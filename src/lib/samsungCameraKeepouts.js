const SAMSUNG_CAMERA_KEEPOUTS = {
  'galaxy-s24': [
    { type: 'roundedRect', x: 0.095, y: 0.04, w: 0.21, h: 0.325, r: 0.105 },
    { type: 'circle', cx: 0.38, cy: 0.145, r: 0.05 },
  ],
  'galaxy-s24-plus': [
    { type: 'roundedRect', x: 0.085, y: 0.035, w: 0.21, h: 0.325, r: 0.105 },
    { type: 'circle', cx: 0.38, cy: 0.145, r: 0.05 },
  ],
  'galaxy-s24-ultra': [
    { type: 'roundedRect', x: 0.1, y: 0.035, w: 0.22, h: 0.34, r: 0.11 },
    { type: 'roundedRect', x: 0.345, y: 0.055, w: 0.13, h: 0.19, r: 0.065 },
  ],
  'galaxy-s25': [
    { type: 'roundedRect', x: 0.06, y: 0.025, w: 0.27, h: 0.345, r: 0.135 },
    { type: 'circle', cx: 0.4, cy: 0.15, r: 0.05 },
  ],
  'galaxy-s25-plus': [
    { type: 'roundedRect', x: 0.055, y: 0.02, w: 0.27, h: 0.35, r: 0.135 },
    { type: 'circle', cx: 0.4, cy: 0.15, r: 0.05 },
  ],
  'galaxy-s25-ultra': [
    { type: 'roundedRect', x: 0.07, y: 0.025, w: 0.27, h: 0.36, r: 0.135 },
    { type: 'roundedRect', x: 0.33, y: 0.05, w: 0.16, h: 0.2, r: 0.08 },
  ],
  'galaxy-s26': [
    { type: 'roundedRect', x: 0.07, y: 0.02, w: 0.28, h: 0.36, r: 0.14 },
    { type: 'circle', cx: 0.42, cy: 0.15, r: 0.055 },
  ],
  'galaxy-s26-plus': [
    { type: 'roundedRect', x: 0.075, y: 0.02, w: 0.25, h: 0.335, r: 0.125 },
    { type: 'circle', cx: 0.4, cy: 0.145, r: 0.055 },
  ],
  'galaxy-s26-ultra': [
    { type: 'roundedRect', x: 0.075, y: 0.025, w: 0.25, h: 0.36, r: 0.125 },
    { type: 'roundedRect', x: 0.355, y: 0.055, w: 0.145, h: 0.195, r: 0.0725 },
  ],
}

const SAMSUNG_CAMERA_KEEPOUTS_BY_CASE_COLOUR = {
  'galaxy-s26-ultra': {
    black: [
      { type: 'roundedRect', x: 0.07, y: 0.025, w: 0.28, h: 0.43, r: 0.14 },
      { type: 'roundedRect', x: 0.32, y: 0.04, w: 0.2, h: 0.22, r: 0.1 },
    ],
  },
}

const millimetres = (value) => +value.toFixed(1)

export function samsungCameraObstacles(modelId, widthMm, heightMm) {
  const keepouts = SAMSUNG_CAMERA_KEEPOUTS[modelId]
  if (!keepouts) return null

  return keepouts.map((keepout) => {
    if (keepout.type === 'circle') {
      return {
        type: 'circle',
        cxMm: millimetres(widthMm * keepout.cx),
        cyMm: millimetres(heightMm * keepout.cy),
        rMm: millimetres(widthMm * keepout.r),
        label: 'camera',
      }
    }
    return {
      type: 'roundedRect',
      xMm: millimetres(widthMm * keepout.x),
      yMm: millimetres(heightMm * keepout.y),
      wMm: millimetres(widthMm * keepout.w),
      hMm: millimetres(heightMm * keepout.h),
      rMm: millimetres(widthMm * keepout.r),
      label: 'camera',
    }
  })
}

export function samsungCameraObstaclesByCaseColour(modelId, widthMm, heightMm) {
  const caseColours = SAMSUNG_CAMERA_KEEPOUTS_BY_CASE_COLOUR[modelId]
  if (!caseColours) return null

  return Object.fromEntries(
    Object.entries(caseColours).map(([caseColourId, keepouts]) => [
      caseColourId,
      keepouts.map((keepout) => {
        if (keepout.type === 'circle') {
          return {
            type: 'circle',
            cxMm: millimetres(widthMm * keepout.cx),
            cyMm: millimetres(heightMm * keepout.cy),
            rMm: millimetres(widthMm * keepout.r),
            label: 'camera',
          }
        }
        return {
          type: 'roundedRect',
          xMm: millimetres(widthMm * keepout.x),
          yMm: millimetres(heightMm * keepout.y),
          wMm: millimetres(widthMm * keepout.w),
          hMm: millimetres(heightMm * keepout.h),
          rMm: millimetres(widthMm * keepout.r),
          label: 'camera',
        }
      }),
    ]),
  )
}