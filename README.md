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

## Characters (MakeHuman pipeline)

The skipper is a [MakeHuman](http://www.makehumancommunity.org/) character built headlessly, with no GUI:

```sh
pip install bpy   # Blender as a Python module; MPFB 2 installed as an extension, plus the MakeHuman CC0 system assets
python3 tools/make_character.py tools/specs/skipper.json /tmp/skipper_raw.glb   # body, face, hair, clothes, game_engine rig
node tools/pack_character.mjs /tmp/skipper_raw.glb /tmp/skipper.glb 1024        # webp textures, dedup, weld
node tools/retarget.mjs /tmp/skipper.glb assets/mh_skipper.glb                  # retarget the Quaternius clips onto the MH rig
```

A spec is JSON: phenotype sliders (gender, age, muscle, weight, height, proportions, race mix), skin, eyes, hair, eyebrows, proxy mesh and a list of clothes. `retarget.mjs` first poses the MH A-pose rest into the library's T-pose rest bone by bone, then transfers each frame's world-space rotation delta and scales pelvis motion by leg length. The in-game IK (helm grip, telescope, sink, bed) runs on top via `GRig`. Don't quantize the output: it splits the skin and breaks the mesh.

## Tests

`test/multi.py` drives a headless Chromium (Playwright) through a JSON list of `[name, js]` steps against `dist/index.html` and saves screenshots to `shots/`. Run from the repo root.

## Credits

- Skipper: [MakeHuman](http://www.makehumancommunity.org/) / MPFB 2 system assets (CC0)
- Other characters: [Quaternius](https://quaternius.com/) Universal Base Characters and Universal Animation Library (CC0)
- Rendering: [three.js](https://threejs.org/) (MIT)
