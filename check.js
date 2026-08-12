/* =====================================================================
   check.js — contrôles d'intégrité de Radical Performance
   ---------------------------------------------------------------------
   À lancer après toute modification d'index.html, du manifest ou du SW.
   Node pur, aucune dépendance, multiplateforme.

       node check.js

   Sort en code 1 si un contrôle échoue (utilisable en pre-commit / CI).
   Ne remplace pas un test dans un vrai navigateur : la syntaxe et les
   données sont vérifiées, pas le rendu ni le comportement.
   ===================================================================== */
const fs   = require('fs');
const vm   = require('vm');
const path = require('path');

const DIR = __dirname;
const P   = f => path.join(DIR, f);
let fail  = 0;

const ok  = (label, cond, detail = '') => {
  if (!cond) fail++;
  console.log((cond ? '  ok   ' : '  ECHEC') + '  ' + label + (detail ? '  ' + detail : ''));
};
const info = (label, value) => console.log('  ---   ' + label + '  ' + value);

/* ================= index.html ================= */
console.log('\nindex.html');
const html   = fs.readFileSync(P('index.html'), 'utf8');
const blocks = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
info('taille', (html.length / 1024).toFixed(0) + ' Ko, ' + html.split('\n').length + ' lignes');
ok('blocs <script> trouvés', blocks.length === 6, blocks.length + ' (attendu 6)');

blocks.forEach((b, i) => {
  let err = null;
  try { new vm.Script(b); } catch (e) { err = e.message; }
  ok('bloc ' + (i + 1) + ' — syntaxe JS', !err, err || '');
});

/* ================= Données ================= */
console.log('\nDonnées');
const ctx = {};
vm.createContext(ctx);
vm.runInContext(blocks[0] + ';globalThis.__M=MODULES;globalThis.__S=SEGMENTS;', ctx);
const MODULES = ctx.__M, SEGMENTS = ctx.__S;
const all = MODULES.flatMap(m => m.tweaks);
const ids = all.map(t => t.id);

info('modules', MODULES.map(m => m.id + ':' + m.tweaks.length).join(' '));
info('total réglages', all.length);

const dup = [...new Set(ids.filter((x, i) => ids.indexOf(x) !== i))];
ok('ids uniques', dup.length === 0, dup.join(','));

const asym = all.filter(t => (t.cmd && !t.rev) || (t.rev && !t.cmd));
ok('cmd/rev symétriques', asym.length === 0, asym.map(t => t.id).join(','));

const segIds = new Set(SEGMENTS.map(s => s.id));
const badSeg = all.filter(t => t.seg && !segIds.has(t.seg));
ok('seg valides', badSeg.length === 0, badSeg.map(t => t.id + '->' + t.seg).join(','));

const badMyth = all.filter(t => t.v === 'myth' && (t.cmd || t.manual));
ok('aucun mythe armable', badMyth.length === 0, badMyth.map(t => t.id).join(','));

const noSteps = all.filter(t => t.manual && !t.manualSteps);
ok('manual → manualSteps', noSteps.length === 0, noSteps.map(t => t.id).join(','));

const verdicts = {};
all.forEach(t => verdicts[t.v] = (verdicts[t.v] || 0) + 1);
info('verdicts', JSON.stringify(verdicts));
info('armés par le profil tournoi / la démo', all.filter(t => t.v === 'real' || t.v === 'marginal').length);

/* ================= RGPD : aucune requête externe ================= */
console.log('\nRequêtes externes');
/* Ce qui compte pour le RGPD, c'est ce que la page CHARGE toute seule
   (polices, scripts, images), pas les liens que l'utilisateur choisit de
   suivre. On retire donc les <a href> avant de scanner : le bouton de
   téléchargement pointe légitimement vers GitHub Releases. */
const sansLiens = html.replace(/<a\b[^>]*>/gi, m => m.replace(/https?:\/\/[^"'\s>]+/g, ''));
/* Le domaine du site lui-même n'est pas un tiers : il n'apparaît que dans la
   balise canonique et les métadonnées Open Graph, qui ne chargent rien. */
const ALLOWED = ['http://www.w3.org', 'https://tlonchambon95-cpu.github.io', 'http://localhost'];
const urls = [...new Set([...sansLiens.matchAll(/https?:\/\/[a-zA-Z0-9.\-]+/g)].map(m => m[0]))];
const foreign = urls.filter(u => !ALLOWED.includes(u));
ok('aucune ressource chargée depuis un tiers', foreign.length === 0, foreign.join(' '));
const liens = [...new Set([...html.matchAll(/<a\b[^>]*href="(https?:\/\/[^"]+)"/gi)].map(m => new URL(m[1]).origin))];
info('liens sortants (clic utilisateur)', liens.length ? liens.join(' | ') : 'aucun');
info('domaines chargés', urls.join(' | '));

/* ================= PWA ================= */
console.log('\nPWA');
let man = null;
try { man = JSON.parse(fs.readFileSync(P('manifest.json'), 'utf8')); }
catch (e) { ok('manifest.json — JSON valide', false, e.message); }

if (man){
  ok('manifest.json — JSON valide', true);
  const need = ['name','short_name','start_url','scope','display','icons','background_color','theme_color'];
  const miss = need.filter(k => !(k in man));
  ok('champs requis présents', miss.length === 0, miss.join(','));
  ok('start_url = "./" (impose index.html)', man.start_url === './', man.start_url);
  ok('display = standalone', man.display === 'standalone', man.display);
  ok('une icône maskable', man.icons.some(i => (i.purpose || '').includes('maskable')));
  ok('une icône 512×512', man.icons.some(i => i.sizes === '512x512'));

  const assets = [...man.icons.map(i => i.src), ...(man.screenshots || []).map(s => s.src)];
  assets.forEach(f => ok('fichier présent : ' + f, fs.existsSync(P(f))));
}

let sw = null;
try { sw = fs.readFileSync(P('sw.js'), 'utf8'); new vm.Script(sw); ok('sw.js — syntaxe JS', true); }
catch (e) { ok('sw.js — syntaxe JS', false, e.message); }

if (sw){
  const v = sw.match(/const VERSION\s*=\s*'([^']+)'/);
  ok('sw.js — VERSION déclarée', !!v, v ? v[1] : '');
  info('rappel', 'incrémenter VERSION à chaque mise en ligne');
}

['manifest.json', 'apple-touch-icon.png', 'sw.js', 'btnInstall']
  .forEach(r => ok('index.html référence ' + r, html.includes(r)));

ok('CSS .btn[hidden] présent', /\.btn\[hidden\]/.test(html),
   'sinon inline-flex écrase l\'attribut hidden');

/* ================= Application de bureau ================= */
console.log('\nApplication de bureau (Electron)');
const D = f => path.join(DIR, 'desktop', f);

if (!fs.existsSync(D('package.json'))){
  console.log('  ---   dossier desktop/ absent — contrôles ignorés');
} else {
  ['main.js', 'preload.js', 'system.js', 'package.json'].forEach(f => {
    const present = fs.existsSync(D(f));
    ok('desktop/' + f + ' présent', present);
    if (present && f.endsWith('.js')){
      let err = null;
      try { new vm.Script(fs.readFileSync(D(f), 'utf8')); } catch (e) { err = e.message; }
      ok('desktop/' + f + ' — syntaxe JS', !err, err || '');
    }
  });

  const pkg = JSON.parse(fs.readFileSync(D('package.json'), 'utf8'));
  ok('icône NSIS déclarée', !!(pkg.build && pkg.build.win && pkg.build.win.icon));
  ok('desktop/build/icon.ico présent', fs.existsSync(D('build/icon.ico')),
     'régénérer avec : node make-icons.js');
  const extra = (pkg.build.extraResources || []).map(r => r.from);
  ok('index.html embarqué dans le paquet', extra.includes('../index.html'),
     'sinon l\'app installée n\'aura pas d\'interface');

  /* Piège vécu : probes.js absent de build.files. L'application fonctionnait
     en développement et affichait une fenêtre vide une fois installée.
     On vérifie que tout module require() localement est bien empaqueté. */
  const packaged = pkg.build.files || [];
  const localeReq = new Set();
  ['main.js', 'preload.js', 'system.js', 'probes.js'].forEach(f => {
    if (!fs.existsSync(D(f))) return;
    const src = fs.readFileSync(D(f), 'utf8');
    for (const m of src.matchAll(/require\(['"]\.\/([\w.-]+)['"]\)/g)){
      localeReq.add(m[1].endsWith('.js') ? m[1] : m[1] + '.js');
    }
  });
  const absents = [...localeReq].filter(f => !packaged.includes(f));
  ok('tous les modules requis sont empaquetés', absents.length === 0,
     absents.length ? 'absent(s) de build.files : ' + absents.join(', ') : [...localeReq].join(', '));

  /* Le contrat entre les deux couches : ce que preload expose doit être
     ce que le bloc 6 consomme, et ce que main.js écoute. */
  const pre  = fs.existsSync(D('preload.js')) ? fs.readFileSync(D('preload.js'), 'utf8') : '';
  const main = fs.existsSync(D('main.js'))    ? fs.readFileSync(D('main.js'), 'utf8')    : '';
  ['rp:apply', 'rp:machine', 'rp:openLog', 'rp:confirm'].forEach(ch => {
    ok('canal ' + ch + ' : preload ↔ main', pre.includes(ch) && main.includes(ch));
  });
  ok('canal rp:log : main → preload', main.includes('rp:log') && pre.includes('rp:log'));

  ['RP.apply', 'RP.machine', 'RP.confirm', 'RP.onLog'].forEach(api => {
    const m = api.split('.')[1];
    ok('index.html utilise ' + api, html.includes(api), '');
    ok('preload expose ' + m, new RegExp('\\b' + m + '\\s*:').test(pre));
  });

  ok('bloc natif conditionné à window.RP', /if\s*\(!window\.RP/.test(html),
     'sinon le mode natif s\'activerait aussi sur le web');

  /* Lien de téléchargement du site : le fichier doit exister et le numéro
     de version doit suivre celui du package, sinon le bouton renvoie une 404. */
  /* Distribution par GitHub Releases : le lien du site doit viser
     releases/latest/download/<nom exact de l'asset>. Un nom versionné
     casserait ce lien à chaque publication. */
  const pubCfg = (pkg.build.publish || [])[0] || {};
  const art = (pkg.build.win || {}).artifactName || '';
  ok('nom d\'artefact fixe (non versionné)', !art.includes('${version}'),
     'sinon releases/latest/download/<nom> renvoie 404 à chaque version — ' + art);

  const dl = html.match(/href="(https:\/\/github\.com\/[^"]+\/releases\/latest\/download\/[^"]+)"/);
  ok('lien de téléchargement vers GitHub Releases', !!dl, dl ? dl[1].replace(/^https:\/\/github\.com\//, '') : 'absent');
  if (dl && pubCfg.owner){
    ok('le lien vise le dépôt de publication', dl[1].includes(pubCfg.owner + '/' + pubCfg.repo),
       'publish : ' + pubCfg.owner + '/' + pubCfg.repo);
    const asset = art.replace('${ext}', 'exe');
    ok('le lien vise le bon nom d\'asset', dl[1].endsWith('/' + asset), 'attendu : ' + asset);
  }
  const verNote = html.match(/Windows 10\/11 64 bits · version ([\d.]+)/);
  ok('version affichée sur le site = version du package', !!verNote && verNote[1] === pkg.version,
     verNote ? 'site : ' + verNote[1] + ' | package : ' + pkg.version : 'mention de version introuvable');

  /* Les trois fichiers à joindre à la publication GitHub. Sans latest.yml
     aucun client ne détecte rien ; sans le .blockmap chaque mise à jour
     repart pour 95 Mo au lieu des seuls blocs modifiés. */
  const distFiles = ['latest.yml', 'RadicalPerformance-Setup.exe', 'RadicalPerformance-Setup.exe.blockmap'];
  const prets = distFiles.filter(f => fs.existsSync(D('dist/' + f)));
  if (prets.length === 0){
    info('publication', 'aucun artefact dans desktop/dist — lancer « npm run dist »');
  } else {
    distFiles.forEach(f => ok('desktop/dist/' + f + ' prêt à publier', fs.existsSync(D('dist/' + f))));
    if (fs.existsSync(D('dist/latest.yml'))){
      const y = fs.readFileSync(D('dist/latest.yml'), 'utf8');
      const mv = y.match(/^version:\s*(.+)$/m);
      ok('latest.yml annonce la version du package', !!mv && mv[1].trim() === pkg.version,
         mv ? 'latest.yml : ' + mv[1].trim() + ' | package : ' + pkg.version : '');
    }
  }
  ok('sw.js n\'archive pas l\'installeur', !!sw && /\\.\(exe\|/.test(sw),
     'sinon 95 Mo partent dans le cache du service worker');
  ok('contextIsolation activé', /contextIsolation:\s*true/.test(main));
  ok('nodeIntegration désactivé', /nodeIntegration:\s*false/.test(main));

  /* Chaque réglage scriptable doit avoir une sonde, sinon l'application
     afficherait « non appliqué » sur un réglage qu'elle ne sait pas lire. */
  if (fs.existsSync(D('probes.js'))){
    const { PROBES, NEEDS_ADMIN } = require(D('probes.js'));
    const scriptable = all.filter(t => t.cmd);
    const sansSonde  = scriptable.filter(t => !(t.id in PROBES));
    ok('une sonde par réglage scriptable', sansSonde.length === 0,
       sansSonde.length ? 'manquant : ' + sansSonde.map(t => t.id).join(',') : scriptable.length + ' réglages');
    const orphelines = Object.keys(PROBES).filter(id => !all.some(t => t.id === id));
    ok('aucune sonde orpheline', orphelines.length === 0, orphelines.join(','));
    const mythes = Object.keys(PROBES).filter(id => (all.find(t => t.id === id) || {}).v === 'myth');
    ok('aucune sonde sur un mythe', mythes.length === 0, mythes.join(','));
    info('sondes totales', Object.keys(PROBES).length + ' (dont ' + NEEDS_ADMIN.size + ' exigeant l\'admin)');

    /* Une sonde qui écrit ne serait plus une sonde. */
    const src = fs.readFileSync(D('probes.js'), 'utf8');
    const ecrit = /\b(Set-ItemProperty|New-Item|Remove-Item|Set-Service|Stop-Service|bcdedit\s+\/set|netsh\s+int\s+tcp\s+set|Set-NetAdapter|Set-Dns)/i.test(src);
    ok('sondes en lecture seule', !ecrit, ecrit ? 'une commande d\'écriture est présente dans probes.js' : '');
  }

  /* ---- Mises à jour ---- */
  const pub = (pkg.build.publish || [])[0];
  ok('cible de publication déclarée', !!pub,
     pub ? pub.provider + ' → ' + (pub.url || (pub.owner + '/' + pub.repo)) : 'build.publish absent');
  ok('electron-updater en dependencies', !!(pkg.dependencies || {})['electron-updater'],
     'en devDependencies il ne serait pas empaqueté');
  ok('node_modules empaqueté', (pkg.build.files || []).some(f => f.startsWith('node_modules')),
     'sinon electron-updater manquerait à l\'exécution');
  ['rp:updateCheck', 'rp:updateDownload', 'rp:updateInstall', 'rp:version'].forEach(ch => {
    ok('canal ' + ch + ' : preload ↔ main', pre.includes(ch) && main.includes(ch));
  });
  ok('flux rp:update : main → interface', main.includes("'rp:update'") && pre.includes('rp:update') && html.includes('RP.onUpdate'));
  ok('téléchargement non automatique', /autoDownload\s*=\s*false/.test(main),
     'une mise à jour ne doit jamais se télécharger sans clic');
  if (pub && /VOTRE-DOMAINE/.test(pub.url || '')){
    info('à faire', 'remplacer VOTRE-DOMAINE dans build.publish.url par l\'URL réelle');
  }

  const deps = fs.existsSync(D('node_modules/electron'));
  ok('dépendances installées', deps, deps ? '' : 'lancer : cd desktop && npm install');
}

/* ================= Déploiement =================
   Ces points restent ouverts pendant tout le développement : ce sont de
   simples avertissements. Ils ne deviennent bloquants qu'avec --deploy,
   à lancer juste avant une mise en ligne. */
const DEPLOY = process.argv.includes('--deploy');
console.log('\nDéploiement' + (DEPLOY ? ' (bloquant)' : ' (informatif — ajouter --deploy pour bloquer)'));

const warn = (label, cond, detail = '') => {
  if (!cond && DEPLOY) fail++;
  console.log((cond ? '  ok   ' : (DEPLOY ? '  ECHEC' : '  todo ')) + '  ' + label + (detail ? '  ' + detail : ''));
};

/* Les mentions légales viennent du site en ligne : structure complète, mais
   les coordonnées de l'éditeur restent à renseigner (obligation légale pour
   un site professionnel français). */
const perso = (html.match(/\[PRÉNOM NOM\]|\[ADRESSE[^\]]*\]|\[14 CHIFFRES\]/g) || []).length;
warn('coordonnées de l\'éditeur renseignées', perso === 0,
     perso ? perso + ' champ(s) à compléter dans les mentions légales' : '');
warn('URL Open Graph réelle', !html.includes('VOTRE-DOMAINE'),
     html.includes('VOTRE-DOMAINE') ? 'https://VOTRE-DOMAINE encore présent' : '');
warn('balise canonique présente', /rel="canonical"/.test(html));

console.log('\n' + (fail === 0
  ? 'Tout est vert.'
  : fail + ' contrôle(s) en échec.') + '\n');
process.exit(fail === 0 ? 0 : 1);
