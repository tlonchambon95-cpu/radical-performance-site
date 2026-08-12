/* =====================================================================
   make-icons.js — génère les icônes PWA de Radical Performance
   ---------------------------------------------------------------------
   Outil ponctuel : à relancer uniquement si la marque change.
   Node pur (zlib de la stdlib), aucune dépendance à installer.

       node make-icons.js

   Produit à la racine : icon-192.png, icon-512.png,
                         icon-maskable-512.png, apple-touch-icon.png

   Le dessin reprend le favicon SVG inline du <head> : carré arrondi
   sombre, liseré en dégradé, monogramme R. Le R est ici construit
   géométriquement (fût + panse + jambe) plutôt qu'avec une police,
   pour éviter toute dépendance de rendu de texte.
   ===================================================================== */
const zlib = require('zlib');
const fs   = require('fs');

/* ---------- Palette (identique aux variables CSS du site) ---------- */
const BG    = [5, 7, 13];        // fond du favicon (#05070D)
const GRAD0 = [255, 59, 69];     // --volt  #FF3B45
const GRAD1 = [212, 12, 34];     // --cyan  #D40C22

/* ---------- Encodeur PNG (RGBA8, non entrelacé) ---------- */
const CRC_T = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++){
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c;
  }
  return t;
})();

function crc32(buf){
  let c = ~0;
  for (let i = 0; i < buf.length; i++) c = CRC_T[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (~c) >>> 0;
}

function chunk(type, data){
  const len  = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc  = Buffer.alloc(4); crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function encodePNG(size, rgba){
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;   // profondeur 8 bits
  ihdr[9] = 6;   // RGBA
  // 10,11,12 = compression/filtre/entrelacement = 0

  // une ligne = 1 octet de filtre (0 = None) + size*4 octets
  const raw = Buffer.alloc(size * (1 + size * 4));
  for (let y = 0; y < size; y++){
    const o = y * (1 + size * 4);
    raw[o] = 0;
    rgba.copy(raw, o + 1, y * size * 4, (y + 1) * size * 4);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

/* ---------- Champs de distance signés (repère 64×64) ---------- */
const sdRoundRect = (px, py, cx, cy, hw, hh, r) => {
  const qx = Math.abs(px - cx) - (hw - r);
  const qy = Math.abs(py - cy) - (hh - r);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
};

/* capsule : segment [a,b] épaissi de r */
const sdCapsule = (px, py, ax, ay, bx, by, r) => {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy)) - r;
};

/* demi-anneau droit : arc de cercle x >= cx, épaisseur 2*w */
const sdArcRight = (px, py, cx, cy, R, w) => {
  const dx = px - cx, dy = py - cy;
  if (dx >= 0) return Math.abs(Math.hypot(dx, dy) - R) - w;
  return Math.min(Math.hypot(dx, dy - R), Math.hypot(dx, dy + R)) - w;
};

/* Monogramme R monoline, boîte x∈[22.6,41.6] y∈[16,48], centré sur (32,32).
   Panse : rayon 8 pour une épaisseur 2.4 → contrepoinçon de 5.6, bien ouvert
   même à 32 px. Le haut de la panse est aligné sur le haut du fût (y=16). */
function sdR(px, py){
  const stem = sdCapsule(px, py, 25, 18.4, 25, 45.6, 2.4);    // fût vertical
  const bowl = sdArcRight(px, py, 25, 26.4, 8,   2.4);        // panse
  const leg  = sdCapsule(px, py, 27.5, 34, 39.2, 45.6, 2.4);  // jambe oblique
  return Math.min(stem, bowl, leg);
}

/* ---------- Rendu ---------- */
function mixGrad(u, v){
  // dégradé linéaire coin haut-gauche -> coin bas-droit, comme le SVG (x1,y1=0 -> x2,y2=1)
  const t = Math.max(0, Math.min(1, (u / 64 + v / 64) / 2));
  return [
    Math.round(GRAD0[0] + (GRAD1[0] - GRAD0[0]) * t),
    Math.round(GRAD0[1] + (GRAD1[1] - GRAD0[1]) * t),
    Math.round(GRAD0[2] + (GRAD1[2] - GRAD0[2]) * t)
  ];
}

/**
 * @param {number}  size    côté en pixels
 * @param {object}  opt
 * @param {boolean} opt.rounded  coins arrondis transparents (icône "any"), sinon fond pleine page
 * @param {boolean} opt.border   dessiner le liseré en dégradé
 * @param {number}  opt.scale    échelle du monogramme autour du centre
 */
function render(size, opt){
  const { rounded = true, border = true, scale = 1 } = opt || {};
  const SS  = 4;                       // suréchantillonnage 4×4
  const out = Buffer.alloc(size * size * 4);

  for (let y = 0; y < size; y++){
    for (let x = 0; x < size; x++){
      let aBg = 0, aArt = 0, gu = 0, gv = 0;

      for (let sy = 0; sy < SS; sy++){
        for (let sx = 0; sx < SS; sx++){
          // coordonnées dans le repère 64×64
          const u = 64 * (x + (sx + 0.5) / SS) / size;
          const v = 64 * (y + (sy + 0.5) / SS) / size;

          if (rounded ? sdRoundRect(u, v, 32, 32, 32, 32, 15) <= 0 : true) aBg++;

          // le monogramme (et le liseré) subissent l'échelle autour du centre
          const su = 32 + (u - 32) / scale;
          const sv = 32 + (v - 32) / scale;

          let d = sdR(su, sv);
          if (border){
            const ring = Math.abs(sdRoundRect(su, sv, 32, 32, 26.5, 26.5, 12)) - 1.5;
            d = Math.min(d, ring);
          }
          if (d <= 0){ aArt++; gu += su; gv += sv; }
        }
      }

      const N   = SS * SS;
      const i   = (y * size + x) * 4;
      const cov = aArt / N;
      const bg  = aBg / N;

      let r = BG[0], g = BG[1], b = BG[2];
      if (cov > 0){
        const [gr, gg, gb] = mixGrad(gu / aArt, gv / aArt);
        r = Math.round(BG[0] + (gr - BG[0]) * cov);
        g = Math.round(BG[1] + (gg - BG[1]) * cov);
        b = Math.round(BG[2] + (gb - BG[2]) * cov);
      }
      out[i] = r; out[i + 1] = g; out[i + 2] = b;
      out[i + 3] = Math.round(255 * Math.max(bg, cov));
    }
  }
  return encodePNG(size, out);
}

/* ---------- Sortie ---------- */
const targets = [
  // "any" : carré arrondi, liseré + R
  ['icon-192.png',          192, { rounded: true,  border: true,  scale: 1    }],
  ['icon-512.png',          512, { rounded: true,  border: true,  scale: 1    }],
  // "maskable" : fond pleine page, liseré retiré (les coins seraient rognés
  // par le masque de l'OS), R agrandi mais contenu dans la zone sûre (cercle 80 %)
  // demi-diagonale du R = 18.6 ; à 1.3 elle vaut 24.2, sous le rayon sûr de 25.6
  ['icon-maskable-512.png', 512, { rounded: false, border: false, scale: 1.3 }],
  // iOS applique son propre masque : fond opaque, pas de transparence
  ['apple-touch-icon.png',  180, { rounded: false, border: true,  scale: 1    }]
];

for (const [name, size, opt] of targets){
  const png = render(size, opt);
  fs.writeFileSync(__dirname + '/' + name, png);
  console.log(name.padEnd(28), size + '×' + size, (png.length / 1024).toFixed(1) + ' Ko');
}

/* ---------- icon.ico pour l'installeur Windows (electron-builder) ----------
   Format ICO « moderne » : un seul enregistrement contenant un PNG 256×256.
   Accepté depuis Windows Vista, et c'est la taille exigée par
   electron-builder. Largeur/hauteur valent 0 dans l'en-tête : c'est ainsi
   que le format code la valeur 256, qui ne tient pas sur un octet. */
{
  const png = render(256, { rounded: true, border: true, scale: 1 });

  const dir = Buffer.alloc(6);
  dir.writeUInt16LE(0, 0);   // réservé
  dir.writeUInt16LE(1, 2);   // type 1 = icône
  dir.writeUInt16LE(1, 4);   // nombre d'images

  const entry = Buffer.alloc(16);
  entry[0] = 0;                          // largeur  : 0 => 256
  entry[1] = 0;                          // hauteur  : 0 => 256
  entry[2] = 0;                          // palette  : 0 => sans
  entry[3] = 0;                          // réservé
  entry.writeUInt16LE(1,  4);            // plans
  entry.writeUInt16LE(32, 6);            // bits par pixel
  entry.writeUInt32LE(png.length, 8);    // taille des données
  entry.writeUInt32LE(6 + 16, 12);       // décalage des données

  const outDir = __dirname + '/desktop/build';
  fs.mkdirSync(outDir, { recursive: true });
  const ico = Buffer.concat([dir, entry, png]);
  fs.writeFileSync(outDir + '/icon.ico', ico);
  console.log('desktop/build/icon.ico'.padEnd(28), '256×256', (ico.length / 1024).toFixed(1) + ' Ko');
}
