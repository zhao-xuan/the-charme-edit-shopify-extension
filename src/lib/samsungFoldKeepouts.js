const FOLD_PANEL_BOUNDS = {
  'galaxy-z-fold-3': { screenSide: 'right', creaseStart: 0.47, creaseEnd: 0.56 },
  'galaxy-z-fold-4': { screenSide: 'right', creaseStart: 0.478, creaseEnd: 0.535 },
  'galaxy-z-fold-5': { screenSide: 'right', creaseStart: 0.48, creaseEnd: 0.535 },
  'galaxy-z-fold-7': { screenSide: 'left', creaseStart: 0.495, creaseEnd: 0.52 },
}

const millimetres = (value) => +value.toFixed(1)

export function samsungFoldObstacles(modelId, widthMm, heightMm, insetMm = 4) {
  const panel = FOLD_PANEL_BOUNDS[modelId]
  if (!panel) return []

  const creaseStartMm = millimetres(widthMm * panel.creaseStart)
  const creaseEndMm = millimetres(widthMm * panel.creaseEnd)
  const topMm = insetMm
  const bottomMm = heightMm - insetMm
  const screenStartMm = panel.screenSide === 'left' ? insetMm : creaseEndMm
  const screenEndMm = panel.screenSide === 'left' ? creaseStartMm : widthMm - insetMm

  return [
    {
      type: 'roundedRect',
      xMm: screenStartMm,
      yMm: topMm,
      wMm: millimetres(screenEndMm - screenStartMm),
      hMm: millimetres(bottomMm - topMm),
      rMm: 2,
      label: 'screen',
    },
    {
      type: 'roundedRect',
      xMm: creaseStartMm,
      yMm: topMm,
      wMm: millimetres(creaseEndMm - creaseStartMm),
      hMm: millimetres(bottomMm - topMm),
      rMm: 1,
      label: 'crease',
    },
  ]
}