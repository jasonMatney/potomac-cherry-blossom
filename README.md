# Potomac Cherry Blossom

A cinematic, single-file 3D scene: an electric launch cruising the Potomac through Washington, DC in cherry-blossom season. Built with three.js, no network needed at runtime; everything (models, textures, music) is embedded or synthesized.

**Play:** open [`docs/index.html`](docs/index.html) in a browser (Chrome recommended), or enable GitHub Pages from the `docs/` folder.

## What's in it

- The river from the Memorial Bridge past the Kennedy Center, Georgetown, the Key Bridge and Roosevelt Island up toward Fletcher's Cove
- Day/night cycle with a passing storm, fog, rain and lightning
- Interactive wake simulation: boats push real waves that other boats ride
- River traffic, rowing crews, the Odyssey, wildlife, joggers
- Docking stops with small interactions: ice cream in Georgetown, a beer at Thompson Boat Center, a stretch at Fletcher's Cove
- A three-storey home on the Virginia bluff with its own dock: fireplace, TV, kitchen, bedroom, bathroom, balcony telescope and a cat
- Synthesized soundtrack (selectable songs) and ambience: birds, geese, gulls, peepers, bells, crowd
- Automatic quality tiers for slower machines

## Controls

| Key | Action |
|---|---|
| W A S D / arrows | Steer the boat, or walk when ashore |
| Shift | Boost / sprint |
| E or Enter | Dock at a stop, or head back to the boat |
| T or F (hold) | Fast-forward time |
| 1–6 | Pick a song |
| M | Mute |
| P | Performance readout |
| Drag | Orbit the camera |

Leave the keys alone and it runs on autopilot, visiting the stops by itself.

## Build

```sh
npm install
npm run build      # minified -> dist/index.html
npm run build:dev  # readable build for debugging
```

To publish, copy `dist/index.html` to `docs/index.html`.

`src/` holds the scene modules (`main.js` is the entry); `template.html` is the page shell the bundle is injected into. `tools/prep.mjs` trims the source character packs into `assets/` (it expects the original Quaternius files locally).

## Tests

`test/multi.py` drives a headless Chromium (Playwright) through a JSON list of `[name, js]` steps against `dist/index.html` and saves screenshots to `shots/`. Run from the repo root.

## Credits

- Characters: [Quaternius](https://quaternius.com/) Universal Base Characters and Universal Animation Library (CC0)
- Rendering: [three.js](https://threejs.org/) (MIT)
