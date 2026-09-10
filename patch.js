const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, 'app/game/engine/textures.ts');
let code = fs.readFileSync(file, 'utf8');

const newCode = `
/* ------------------------------------------------------------------ */
/*  LEVEL 1: CONCRETE WAREHOUSE TEXTURES                              */
/* ------------------------------------------------------------------ */

export function makeConcreteWallMaps(seed: number): PBRMaps {
  const S = 1024;
  const n1 = new ValueNoise(seed + 11);
  const n2 = new ValueNoise(seed + 12);

  const { canvas, ctx } = makeCanvas(S, S);
  const img = ctx.createImageData(S, S);
  const d = img.data;
  const height = new Float32Array(S * S);
  const rough = new Float32Array(S * S);

  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = y * S + x;
      
      const grain = n1.fbm(x * 0.05, y * 0.05, 4);
      const mottle = n2.fbm(x * 0.008, y * 0.008, 3);
      
      const shade = 0.6 + grain * 0.2 + mottle * 0.2;
      const r = 120 * shade, g = 125 * shade, b = 130 * shade;

      d[i * 4] = r; d[i * 4 + 1] = g; d[i * 4 + 2] = b; d[i * 4 + 3] = 255;
      height[i] = grain * 0.4 + mottle * 0.6;
      rough[i] = 0.8 - mottle * 0.2;
    }
  }
  ctx.putImageData(img, 0, 0);

  const map = tex(canvas, { srgb: true });
  const norm = tex(normalFromHeight(height, S, S, 15), { srgb: false });
  const rf = tex(grayCanvas(rough, S, S), { srgb: false });
  return { map, normalMap: norm, roughnessMap: rf };
}

export function makeConcreteFloorMaps(seed: number): PBRMaps {
  const S = 1024;
  const n1 = new ValueNoise(seed + 21);

  const { canvas, ctx } = makeCanvas(S, S);
  const img = ctx.createImageData(S, S);
  const d = img.data;
  const height = new Float32Array(S * S);
  const rough = new Float32Array(S * S);

  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = y * S + x;
      
      const grain = n1.fbm(x * 0.1, y * 0.1, 4);
      
      const shade = 0.4 + grain * 0.15;
      const r = 90 * shade, g = 90 * shade, b = 95 * shade;

      d[i * 4] = r; d[i * 4 + 1] = g; d[i * 4 + 2] = b; d[i * 4 + 3] = 255;
      height[i] = grain * 0.2;
      rough[i] = 0.9;
    }
  }
  ctx.putImageData(img, 0, 0);

  const map = tex(canvas, { srgb: true });
  const norm = tex(normalFromHeight(height, S, S, 8), { srgb: false });
  const rf = tex(grayCanvas(rough, S, S), { srgb: false });
  return { map, normalMap: norm, roughnessMap: rf };
}
`;

fs.writeFileSync(file, code + newCode);
