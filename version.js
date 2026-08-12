/* =====================================================================
   version.js — prépare une nouvelle version
   ---------------------------------------------------------------------
       node version.js 2.3.0

   Le numéro vit à deux endroits qui doivent rester d'accord :
     - desktop/package.json  : il est gravé dans l'installeur et dans
       latest.yml, c'est lui que les clients comparent
     - index.html            : la mention affichée sous le bouton de
       téléchargement du site

   check.js refuse un désaccord entre les deux, et le workflow de
   publication refuse une étiquette qui ne correspond pas au paquet.
   Ce script évite d'oublier l'un des deux.
   ===================================================================== */
const fs   = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const v = process.argv[2];
if (!v || !/^\d+\.\d+\.\d+$/.test(v)){
  console.error('\n  Usage : node version.js <majeur.mineur.correctif>\n  Exemple : node version.js 2.3.0\n');
  process.exit(1);
}

const D = f => path.join(__dirname, f);

/* ---- desktop/package.json ---- */
const pkgPath = D('desktop/package.json');
const pkgRaw  = fs.readFileSync(pkgPath, 'utf8');
const ancienne = JSON.parse(pkgRaw).version;
if (ancienne === v){
  console.log('\n  desktop/package.json est déjà en ' + v + '.\n');
} else {
  fs.writeFileSync(pkgPath, pkgRaw.replace(/"version":\s*"[\d.]+"/, `"version": "${v}"`), 'utf8');
  console.log('  desktop/package.json : ' + ancienne + ' -> ' + v);
}

/* ---- index.html : mention sous le bouton de téléchargement ---- */
const htmlPath = D('index.html');
let html = fs.readFileSync(htmlPath, 'utf8');
const avant = html.match(/Windows 10\/11 64 bits · version ([\d.]+)/);
if (!avant){
  console.error('  ECHEC : mention de version introuvable dans index.html');
  process.exit(1);
}
html = html.replace(/(Windows 10\/11 64 bits · version )[\d.]+/, '$1' + v);
fs.writeFileSync(htmlPath, html, 'utf8');
console.log('  index.html           : ' + avant[1] + ' -> ' + v);

/* ---- Contrôles ---- */
console.log('');
try {
  execFileSync(process.execPath, [D('check.js')], { stdio: 'inherit' });
} catch {
  console.error('\n  Les contrôles ont échoué — corrige avant de publier.\n');
  process.exit(1);
}

console.log(`
  Prêt. Pour publier :

      git add -A
      git commit -m "Version ${v}"
      git tag v${v}
      git push && git push --tags

  Le push met le site à jour, l'étiquette déclenche la construction et la
  publication de l'application. Rien d'autre à faire.
`);
