// Match the current merchant artwork exactly so later image replacements still win.
const repaired = {
  "patch-57e6e": { source: "https://cdn.shopify.com/s/files/1/0922/3857/8042/files/patch-57e6e.png?v=1789744139", src: '/assets/patches/letters/A.png', pxW: 242, pxH: 274 },
  "patch-aabzv": { source: "https://cdn.shopify.com/s/files/1/0922/3857/8042/files/patch-aabzv.png?v=1789744143", src: '/assets/patches/letters/B.png', pxW: 228, pxH: 273 },
  "patch-rfd68": { source: "https://cdn.shopify.com/s/files/1/0922/3857/8042/files/patch-rfd68.png?v=1789744150", src: '/assets/patches/letters/C.png', pxW: 239, pxH: 273 },
  "patch-9mgix": { source: "https://cdn.shopify.com/s/files/1/0922/3857/8042/files/patch-9mgix.png?v=1789744147", src: '/assets/patches/letters/D.png', pxW: 255, pxH: 270 },
  "patch-bstbf": { source: "https://cdn.shopify.com/s/files/1/0922/3857/8042/files/patch-bstbf_dee1607e-fbd3-47a3-b6cd-af2edaaf0d5a.png?v=1789945053", src: '/assets/patches/letters/E.png', pxW: 216, pxH: 274 },
  "patch-v3xa0": { source: "https://cdn.shopify.com/s/files/1/0922/3857/8042/files/patch-v3xa0_0be13c67-52e2-4dda-b84e-a2cd14f7dd78.png?v=1789945050", src: '/assets/patches/letters/F.png', pxW: 219, pxH: 278 },
  "patch-vs8pj": { source: "https://cdn.shopify.com/s/files/1/0922/3857/8042/files/patch-vs8pj.png?v=1789744160", src: '/assets/patches/letters/G.png', pxW: 249, pxH: 277 },
  "patch-s2ift": { source: "https://cdn.shopify.com/s/files/1/0922/3857/8042/files/patch-s2ift.png?v=1789744164", src: '/assets/patches/letters/H.png', pxW: 275, pxH: 272 },
  "patch-dex0f": { source: "https://cdn.shopify.com/s/files/1/0922/3857/8042/files/patch-dex0f_28375f77-4b2a-445e-9cab-f8b567b9c67a.png?v=1789945056", src: '/assets/patches/letters/I.png', pxW: 158, pxH: 270 },
  "patch-g2ggo": { source: "https://cdn.shopify.com/s/files/1/0922/3857/8042/files/patch-g2ggo_39c0df6d-f8b7-4d3a-9c0c-3e2b442746f8.png?v=1789945060", src: '/assets/patches/letters/J.png', pxW: 192, pxH: 276 },
  "patch-4u39i": { source: "https://cdn.shopify.com/s/files/1/0922/3857/8042/files/patch-4u39i.png?v=1789744173", src: '/assets/patches/letters/K.png', pxW: 256, pxH: 271 },
  "patch-oeskq": { source: "https://cdn.shopify.com/s/files/1/0922/3857/8042/files/patch-oeskq_7b0c77fa-d11f-49d6-be03-904cc1c6b5c5.png?v=1789945064", src: '/assets/patches/letters/L.png', pxW: 216, pxH: 274 },
  "patch-xebty": { source: "https://cdn.shopify.com/s/files/1/0922/3857/8042/files/patch-xebty.png?v=1789744180", src: '/assets/patches/letters/M.png', pxW: 311, pxH: 279 },
  "patch-js1rd": { source: "https://cdn.shopify.com/s/files/1/0922/3857/8042/files/patch-js1rd.png?v=1789744183", src: '/assets/patches/letters/N.png', pxW: 278, pxH: 278 },
  "patch-9jxa7": { source: "https://cdn.shopify.com/s/files/1/0922/3857/8042/files/patch-9jxa7.png?v=1789744185", src: '/assets/patches/letters/O.png', pxW: 262, pxH: 272 },
  "patch-fhbih": { source: "https://cdn.shopify.com/s/files/1/0922/3857/8042/files/patch-fhbih.png?v=1789744188", src: '/assets/patches/letters/P.png', pxW: 233, pxH: 276 },
  "patch-hw1zb": { source: "https://cdn.shopify.com/s/files/1/0922/3857/8042/files/patch-hw1zb.png?v=1789744195", src: '/assets/patches/letters/Q.png', pxW: 272, pxH: 273 },
  "patch-meu9d": { source: "https://cdn.shopify.com/s/files/1/0922/3857/8042/files/patch-meu9d.png?v=1789744191", src: '/assets/patches/letters/R.png', pxW: 242, pxH: 262 },
  "patch-z50lt": { source: "https://cdn.shopify.com/s/files/1/0922/3857/8042/files/patch-z50lt_1eb65606-f812-4c4b-a7f2-957de8f5244d.png?v=1789945067", src: '/assets/patches/letters/S.png', pxW: 207, pxH: 267 },
  "patch-w1vwj": { source: "https://cdn.shopify.com/s/files/1/0922/3857/8042/files/patch-w1vwj.png?v=1789744202", src: '/assets/patches/letters/T.png', pxW: 236, pxH: 268 },
  "patch-02cg7": { source: "https://cdn.shopify.com/s/files/1/0922/3857/8042/files/patch-02cg7.png?v=1789744205", src: '/assets/patches/letters/U.png', pxW: 273, pxH: 264 },
  "patch-pjz2l": { source: "https://cdn.shopify.com/s/files/1/0922/3857/8042/files/patch-pjz2l.png?v=1789744208", src: '/assets/patches/letters/V.png', pxW: 253, pxH: 267 },
  "patch-l4nxn": { source: "https://cdn.shopify.com/s/files/1/0922/3857/8042/files/patch-l4nxn.png?v=1789744212", src: '/assets/patches/letters/W.png', pxW: 345, pxH: 278 },
  "patch-teeez": { source: "https://cdn.shopify.com/s/files/1/0922/3857/8042/files/patch-teeez.png?v=1789744216", src: '/assets/patches/letters/X.png', pxW: 243, pxH: 266 },
  "patch-ux9r4": { source: "https://cdn.shopify.com/s/files/1/0922/3857/8042/files/patch-ux9r4.png?v=1789744220", src: '/assets/patches/letters/Y.png', pxW: 238, pxH: 264 },
  "patch-5bavs": { source: "https://cdn.shopify.com/s/files/1/0922/3857/8042/files/patch-5bavs_2ed0ab2d-ac17-4c88-883f-cd0b06d68b55.png?v=1789945071", src: '/assets/patches/letters/Z.png', pxW: 176, pxH: 217 },
}

export function letterPatchArtwork(patch) {
  const image = repaired[patch.id]
  if (!image || image.source !== patch.src) return patch
  return { ...patch, src: image.src, pxW: image.pxW, pxH: image.pxH }
}
