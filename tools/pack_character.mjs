// Shrink a MakeHuman character GLB for the web: textures resized and re-encoded, geometry cleaned up.
// usage: node tools/pack_character.mjs in.glb out.glb [maxTex]
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { prune, dedup, weld, textureCompress, quantize } from '@gltf-transform/functions';
import sharp from 'sharp';
const [,, inp, out, maxTex = '1024'] = process.argv;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(inp);
// the skin, hair and clothes colour maps get the most pixels; normal/bump maps are small
await doc.transform(dedup(), prune(), weld(),
  textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [+maxTex, +maxTex], quality: 80, slots: /baseColor/ }),
  textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [512, 512], quality: 78, slots: /normal|occlusion|metallicRoughness/ }));
await io.write(out, doc);
const r = doc.getRoot();
console.log('packed', out, 'meshes', r.listMeshes().length, 'textures', r.listTextures().map((t) => t.getSize()?.join('x') + ':' + (t.getImage().length / 1024 | 0) + 'k').join(' '));
