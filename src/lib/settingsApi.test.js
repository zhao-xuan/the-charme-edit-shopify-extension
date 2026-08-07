import test from 'node:test'
import assert from 'node:assert/strict'
import { persistCrossSellImages } from '../../functions/api/settings.js'

test('popup photos are uploaded without changing the other option fields', async () => {
  const source = {
    enabled: true,
    options: [
      { label: 'Phone case', buttonLabel: 'Customise', image: 'data:image/png;base64,AAAA', group: 'apple' },
      { label: 'Photo frame', image: 'https://cdn.example/frame.png', group: 'frame' },
    ],
  }
  const uploads = []

  const result = await persistCrossSellImages(source, async (dataUrl, option, index) => {
    uploads.push({ dataUrl, label: option.label, index })
    return 'https://cdn.example/phone.png'
  })

  assert.deepEqual(uploads, [
    { dataUrl: 'data:image/png;base64,AAAA', label: 'Phone case', index: 0 },
  ])
  assert.deepEqual(result, {
    enabled: true,
    options: [
      { label: 'Phone case', buttonLabel: 'Customise', image: 'https://cdn.example/phone.png', group: 'apple' },
      { label: 'Photo frame', image: 'https://cdn.example/frame.png', group: 'frame' },
    ],
  })
  assert.equal(source.options[0].image, 'data:image/png;base64,AAAA')
})

test('popup photos reject non-image data URLs', async () => {
  await assert.rejects(
    persistCrossSellImages(
      { options: [{ label: 'Bad', image: 'data:text/plain;base64,AAAA' }] },
      async () => 'https://cdn.example/never.png',
    ),
    /popup photo must be an image/,
  )
})