# LINK CHECK icon

The app icon and featured illustrations are one mark: **two chain links joined by
a bold checkmark** — the app's subject (spot the suspicious link) drawn in the
Homeroom brand style: flat, three shapes only, no text, no gradients, no shadows.

## Glyph

- **Two chain links** — stadium (rounded-rectangle) outlines, stroke-only, both
  rotated -45° so the chain runs bottom-left to top-right. They sit side by side
  along that diagonal with a gap between them.
- **One bold checkmark** — a round-capped polyline laid over the junction between
  the links. Where it crosses a link, a wider stroke in the background colour
  (the knockout) is drawn under it, cutting a clean ~48px gap so the check reads
  separately from the cream.

The mark fits inside the central ~680px of the 1024px canvas (≈157px margin per
side), clear of the platform's rounded-corner crop.

## Colours (Homeroom brand palette only)

| Colour | Hex       | Used for |
| ------ | --------- | -------- |
| Black  | `#000000` | icon tile ground; dark featured ground, tile and links |
| Cream  | `#FFFEEA` | links on the icon and light featured; light featured ground |
| Yellow | `#FFEE6F` | checkmark; dark featured tile |

## Files

| File                     | Size      | What it is |
| ------------------------ | --------- | ---------- |
| `brand/icon.svg`         | 1024×1024 | source — full-bleed black square, square corners |
| `brand/icon.png`         | 1024×1024 | rendered app icon, wired as `icon.image` in `dapp.json` |
| `brand/featured-light.svg` | 1600×1000 | source — black rounded tile (22% corner radius) on cream ground |
| `brand/featured-light.png` | 1600×1000 | rendered light featured illustration |
| `brand/featured-dark.svg`  | 1600×1000 | source — yellow rounded tile on black ground; links and check flip to black with yellow knockout |
| `brand/featured-dark.png`  | 1600×1000 | rendered dark featured illustration |

The featured SVGs reuse the exact mark geometry from `icon.svg`, scaled 0.65
about its centre so the mark sits inside the 560px tile.

## Rendering the PNGs

No SVG rasterizer was available in the build sandbox, so the PNGs were rendered
with headless Chromium via the `playwright-core` module bundled with the
globally installed `@playwright/mcp` package (`/tmp/render.js`, outside the
repo — no dependency was added to the project). Each SVG is loaded as a
`file://` page whose viewport equals the SVG's exact pixel size, with
`deviceScaleFactor: 1`, and screenshotted. To re-render after editing a source
SVG, run that script from the repo root:

```sh
node /tmp/render.js   # re-renders brand/icon.png and both featured PNGs
```

## Checks done

- Valid PNG headers; sizes exactly 1024×1024 and 1600×1000; all ≤ 256KB.
- Only palette hex values appear in the SVG sources.
- Small-size legibility: at 32px and 64px with a 22% border-radius crop, on
  white and black pages, the checkmark and the two links are distinguishable.
- `npm test` (pure link analyser) unchanged and passing — the artwork touches
  no app code.