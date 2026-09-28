import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, resample, quantize, weld, textureCompress } from '@gltf-transform/functions';
import sharp from 'sharp';
import fs from 'fs';
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const A = '/home/claude/assets/';
async function texSmall(doc, sizes) {
  // normals / roughness smaller
  for (const t of doc.getRoot().listTextures()) {
    const n = (t.getName() + ' ' + t.getURI()).toLowerCase();
    const want = /hair/.test(n) ? 256 : /eye/.test(n) ? 128 : /normal|rough/.test(n) ? 512 : 1024;
    const img = t.getImage(); if (!img) continue;
    const keepAlpha = /hair/.test(n) && /base|color/.test(n);
    const out = keepAlpha ? await sharp(Buffer.from(img)).resize(want, want, { fit: 'fill' }).png({ compressionLevel: 9, palette: true }).toBuffer()
      : await sharp(Buffer.from(img)).resize(want, want, { fit: 'fill' }).jpeg({ quality: /normal/.test(n) ? 90 : 80 }).toBuffer();
    t.setImage(new Uint8Array(out)); t.setMimeType(keepAlpha ? 'image/png' : 'image/jpeg');
  }
}
async function run() {
  // male (light skin, buzzed hair) from the footballer
  let doc = await io.read(A + 'footballer.glb');
  await texSmall(doc); await doc.transform(dedup(), prune());
  await io.write('assets/male.glb', doc);
  // female
  doc = await io.read(A + 'Superhero_Female_FullBody.gltf');
  await texSmall(doc); await doc.transform(dedup(), prune());
  await io.write('assets/female.glb', doc);
  // dark-skin male skin texture only (for the groundskeeper)
  const dark = await sharp(A + 'T_Superhero_Male_Dark.png').resize(1024, 1024).jpeg({ quality: 80 }).toBuffer();
  fs.writeFileSync('assets/male_dark.jpg', dark);
  // animations: keep only what we use
  doc = await io.read(A + 'animations.glb');
  const keep = new Set(['Idle_Loop', 'Walk_Loop', 'Idle_Talking_Loop', 'Jog_Fwd_Loop', 'Sitting_Idle_Loop', 'Sprint_Loop']);
  for (const a of doc.getRoot().listAnimations()) if (!keep.has(a.getName())) a.dispose();
  await doc.transform(resample({ tolerance: 0.002 }), prune(), dedup());
  await io.write('assets/anims.glb', doc);
  for (const f of ['male.glb', 'female.glb', 'male_dark.jpg', 'anims.glb']) console.log(f, (fs.statSync('assets/' + f).size / 1024).toFixed(0) + ' KB');
}
run();
