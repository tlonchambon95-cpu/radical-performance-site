# Radical Performance

Console d'optimisation esport pour joueurs Call of Duty compétitifs. Mesure un budget de latence « du clic au pixel », propose 51 réglages Windows/GPU/réseau chacun assorti d'un verdict honnête, et génère un script PowerShell commenté et réversible.

Application web installable (PWA) : elle s'ajoute au menu Démarrer, s'ouvre dans sa propre fenêtre et fonctionne hors ligne.

Un outil **WestLab**.

---

## 1. Démarrage rapide

L'application est un fichier HTML unique et autonome — aucun build, aucune dépendance au runtime.

**Il faut la servir en HTTP, pas l'ouvrir en `file://`.** Trois fonctions exigent un contexte sécurisé (`http://localhost` ou `https://`) : le service worker, l'invite d'installation, et le bouton *Copier* (`navigator.clipboard`). En `file://` la page s'affiche et la console fonctionne, mais elle n'est ni installable ni disponible hors ligne.

Dans VS Code, avec l'extension **Live Server** (recommandée) :
1. Installer l'extension `ritwickdey.LiveServer`
2. Clic droit sur `index.html` → **Open with Live Server**

Ou sans extension, avec Node :

```bash
npx --yes serve .          # puis ouvrir l'URL http://localhost:… affichée
```

Pour vérifier l'installation en local : ouvrir dans Edge ou Chrome, le bouton **« Installer l'app »** apparaît dans la barre de navigation dès que le navigateur juge les critères PWA remplis (manifest valide + service worker actif + contexte sécurisé).

---

## 2. Structure du fichier

Tout tient dans `index.html` (~290 Ko, ~1650 lignes), organisé en zones franches :

```
<head>
  ├─ Polices auto-hébergées (base64, bloc <style id="webfonts">)
  ├─ Meta / Open Graph / favicon SVG inline
  └─ Manifest PWA + icônes Apple + métas application

<body>
  ├─ Fonds animés (halos, grille, bruit) — <div class="orb">, .gridbg, .noise
  ├─ <nav>            barre flottante glassmorphism
  ├─ <header class="hero">
  │    ├─ .hero-title      titre "Radical Performance" (texte réel, dégradé + ombre)
  │    ├─ h1 + .sub + .cta accroche, description, boutons
  │    └─ .gauge-wrap      jauge circulaire de latence (SVG) + .seg-card
  ├─ #methode          section "3 étapes"
  ├─ #verdicts         section "4 verdicts" (cartes)
  ├─ #console          la console : .tabs (7 modules) + #moduleArea (cartes de réglages)
  ├─ <footer>          mentions, lien vers le modal légal
  ├─ .demo-bar         jauge de progression du mode démo (filet 3 px en haut d'écran)
  ├─ .dock             barre flottante inférieure (stats + actions)
  ├─ #ovl              modal script PowerShell généré
  └─ #ovlLegal         modal mentions légales

<script>  bloc 1 — DONNÉES  : SEGMENTS + MODULES (les 51 réglages)
<script>  bloc 2 — LOGIQUE  : jauge, tabs, cartes, mode démo, génération du .ps1, modal
<script>  bloc 3 — 3D       : tilt au survol des cartes + icosaèdre + sol animé
<script>  bloc 4 — pause hero hors écran (perf)
<script>  bloc 5 — PWA      : service worker + bouton « Installer l'app »
<script>  bloc 6 — NATIF    : coque application (barre latérale, tableau de bord,
                      état vérifié, application directe) — inactif sur le web
```

Pas de framework, pas de dépendance externe au runtime (les polices sont embarquées). Tout le CSS est dans une seule balise `<style>` en tête de fichier, organisée par grandes zones commentées (`/* ---- NAV ---- */`, `/* ---- CONSOLE ---- */`, etc.).

---

## 3. Modèle de données — comment ajouter/modifier un réglage

Tout le contenu vit dans le tableau `MODULES` (bloc script 1). Un module :

```js
{
  id:'cpu', name:'CPU', title:'Processeur',
  intro:"Texte d'intro du module…",
  note:{t:"Titre de l'encart", p:"Texte de l'encart"},
  tweaks:[ /* … */ ]
}
```

Un réglage (`tweak`) :

```js
{
  id:'cpu-plan',                 // identifiant unique, format "module-nom"
  v:'real',                      // verdict : 'real' | 'marginal' | 'tradeoff' | 'myth'
  seg:'pc', ms:1.5,              // segment de latence impacté + gain estimé (ms) — omis si sans effet direct
  manual:true,                   // présent = action manuelle (pas de script), sinon commande scriptée
  t:"Titre affiché",
  d:"Description courte (1 phrase)",
  why:"Le pourquoi, le verdict expliqué",
  cmd:`commande PowerShell...`,  // si scriptable
  rev:`commande de retour arrière...`,  // symétrique de cmd, obligatoire si cmd existe
  manualSteps:"Étapes numérotées\nséparées par \\n"  // si manual:true
}
```

**Règles à respecter en ajoutant un réglage :**
- `id` unique dans tout le fichier (vérifié par les tests, voir §8)
- Tout réglage avec `cmd` doit avoir un `rev` symétrique — sinon le script de retour arrière sera incomplet
- Tout réglage avec `v:'myth'` n'a ni `cmd`, ni `manual`, ni interrupteur (il est affiché à titre pédagogique, non armable — voir `card()` dans le bloc logique)
- `seg` doit correspondre à un `id` du tableau `SEGMENTS` (`input`, `pc`, `net`, `display`)
- Les chemins de registre Windows dans les template literals JS doivent être échappés (`\\` devant chaque backslash) — piège classique, voir §9

État actuel : **51 réglages** répartis sur 7 modules (CPU 8, GPU 8, RAM 6, Réseau 9, Windows 8, Alimentation 6, In-game 6) — 30 gains mesurés, 7 marginaux, 3 compromis sécurité, 11 mythes démontés.

---

## 4. Système de verdicts (ne pas casser la sémantique)

| Verdict | Couleur | Sens |
|---|---|---|
| `real` | Rouge (`--real`) | Gain mesuré et reproductible |
| `marginal` | Acier (`--marginal`) | Gratuit, sans risque, effet faible |
| `tradeoff` | Ambre (`--tradeoff`) | Gain réel contre une baisse de sécurité — jamais armé par défaut |
| `myth` | Gris (`--myth`) | Sans effet ou nuisible — affiché mais non applicable |

Le profil **« Profil tournoi »** (bouton du dock) arme automatiquement tous les `real` + `marginal`, jamais les `tradeoff` ni les `myth`. Si le script généré contient des `tradeoff`, une confirmation manuelle (`Taper OUI`) est exigée en tête du `.ps1` — ce garde-fou est dans `buildScript()`, ne pas le retirer.

---

## 5. Mode démo (présentation vidéo / salon)

Bouton **« Mode démo »** du dock. Arme exactement la même sélection que le profil tournoi (`real` + `marginal`, 37 réglages), mais **carte par carte en séquence** : l'onglet bascule de module en module, chaque carte s'arme avec un flash, défile dans la zone lisible, et la jauge de latence, les compteurs du dock et les pastilles d'onglet montent en direct. Durée ≈ 17 s.

Bloc `MODE DÉMO` du script 2. Points à connaître :

- **Réglages du rythme** : `DEMO_STEP` (320 ms entre deux cartes) et `DEMO_MOD` (700 ms au changement de module). Ce sont les seuls curseurs à toucher pour rallonger/raccourcir la séquence.
- **`demoArm()` mute la carte existante** au lieu d'appeler `renderModule()` : re-rendre le DOM casserait le défilement et l'animation. C'est pour ça que `card()` pose désormais `c.dataset.tw = t.id` — le sélecteur `#grid [data-tw="…"]` en dépend, ne pas retirer cet attribut.
- **Interruption** : bouton, `Échap`, clic sur un onglet ou sur un interrupteur. Le mécanisme est un jeton (`DEMO.token`) incrémenté à l'arrêt ; la boucle `async` compare son jeton local après chaque `await` et sort. Pendant la démo, `btnPreset` et `btnClear` sont désactivés. Ce qui a été armé avant l'arrêt est conservé.
- **`prefers-reduced-motion`** : la séquence n'est pas jouée, le bouton retombe sur un `btnPreset.click()` — même état final, sans animation.
- La démo n'ouvre jamais le modal ni ne génère de script : elle ne fait qu'armer.

---

## 6. Application installable (PWA)

Trois fichiers à la racine, aucun build :

| Fichier | Rôle |
|---|---|
| `manifest.webmanifest` | Nom, icônes, couleurs, `display: standalone`, `start_url: "./"` |
| `sw.js` | Service worker : cache de la coquille, fonctionnement hors ligne |
| `make-icons.js` | Générateur des icônes PNG — outil ponctuel, voir plus bas |

Le bloc script 5 d'`index.html` enregistre le service worker et pilote le bouton **« Installer l'app »** de la barre de navigation.

**Points à connaître :**

- **`VERSION` en tête de `sw.js` doit être incrémentée à chaque mise en ligne.** C'est le seul déclencheur du renouvellement du cache : sans ça, les utilisateurs déjà installés gardent l'ancienne version indéfiniment. C'est l'erreur classique des PWA, et elle est silencieuse.
- **`start_url` vaut `"./"`**, donc le fichier principal *doit* s'appeler `index.html`. C'est pour ça qu'il a été renommé.
- **Le bouton d'installation n'apparaît pas toujours.** Il dépend de l'événement `beforeinstallprompt`, que Firefox et Safari desktop n'implémentent pas, et que Chrome/Edge ne déclenchent pas si l'application est déjà installée. Le bouton reste `hidden` par défaut : son absence n'est pas un bug. Sur Safari/iOS, l'installation passe par *Partager → Sur l'écran d'accueil*.
- **`.btn[hidden]{display:none}`** est nécessaire dans le CSS : `.btn` pose `display:inline-flex`, qui l'emporterait sur l'attribut `hidden`.
- **La stratégie de cache** est réseau-d'abord pour les navigations (une nouvelle version est prise dès qu'elle est en ligne) et cache-d'abord avec revalidation en arrière-plan pour les ressources. La coquille est mise en cache entrée par entrée, pas via `addAll()` : celui-ci est atomique et une seule 404 annulerait toute l'installation.

### Régénérer les icônes

Seulement si la marque change :

```bash
node make-icons.js
```

Produit `icon-192.png`, `icon-512.png`, `icon-maskable-512.png` et `apple-touch-icon.png`. Node pur (encodeur PNG + rendu par champs de distance signés dans la stdlib `zlib`), aucune dépendance à installer, aucun outil graphique requis. Le dessin reprend le favicon SVG inline du `<head>` : carré arrondi sombre, liseré en dégradé, monogramme R construit géométriquement plutôt qu'avec une police.

L'icône `maskable` est volontairement différente : liseré retiré (ses coins seraient rognés par le masque de l'OS) et monogramme agrandi à 1,3× pour rester dans la zone sûre — le cercle central de 80 %. Si tu modifies le dessin, vérifie que la demi-diagonale du monogramme reste sous 25,6 unités dans le repère 64×64.

---

## 7. Application de bureau (Electron)

C'est la seule forme du produit qui **applique réellement** les réglages. La version web ne le peut pas : un navigateur n'a aucun accès au registre, au plan d'alimentation ou à la pile réseau, quelle que soit la manière dont on l'installe. Une PWA reste une page web dans une fenêtre.

```bash
cd desktop
npm install        # une seule fois
npm start          # lancer en développement
npm run dist       # produire l'installeur Windows
```

### Architecture

Quatre fichiers, et l'interface n'est pas dupliquée :

| Fichier | Rôle |
|---|---|
| `desktop/main.js` | Processus principal : fenêtre, IPC, cycle de vie |
| `desktop/preload.js` | Pont `window.RP` — 6 appels, surface volontairement minuscule |
| `desktop/system.js` | **Le seul endroit qui écrit sur Windows** : élévation, lecture machine, lecture d'état |
| `desktop/probes.js` | Les sondes de lecture, une par réglage — **strictement en lecture seule** |

L'application charge `../index.html`, **le même fichier que le site**. Le bloc script 6 détecte `window.RP` et reconstruit l'interface en mode application ; sur le web ce bloc sort immédiatement. Une seule source de vérité pour les 51 réglages.

### Le principe : état vérifié, pas cases cochées

C'est la différence de fond avec la version web. Le site affiche ce que l'utilisateur a coché ; l'application affiche ce qui est **réellement en place**, relu sur Windows réglage par réglage par `probes.js`.

Trois réponses possibles par réglage, et la troisième compte autant que les autres :

| État | Sens |
|---|---|
| `true` | Appliqué, vérifié sur la machine |
| `false` | Vérifié comme absent |
| `null` | **Non vérifiable** — lecture impossible (droits, matériel absent) |

Afficher « non appliqué » sur un réglage qu'on n'a pas su lire serait exactement le mensonge que le produit reproche aux autres outils. Le `null` est une valeur de premier rang, pas un cas d'erreur.

**La jauge de latence découle de cet état vérifié** : `computeChain()` est remplacé en mode natif pour n'additionner que les gains réellement en place.

### Ce que le mode natif change dans l'interface

- **Barre latérale** avec un compteur par module (`4/6`), au lieu des onglets du site
- **Tableau de bord** : jauge, segments, bandeau « Mode compétition », tuiles machine
- **Chaque carte affiche son état** — Appliqué / Non appliqué / Non vérifiable
- **Les interrupteurs appliquent directement** un réglage, ou l'annulent
- **Barre d'état** en bas : statut administrateur, appliqués, latence récupérée, non vérifiables
- Après chaque exécution, **la machine est relue** : l'application ne croit pas son propre script sur parole
- Sections vitrine (hero, méthode, verdicts, téléchargement) et bouton « Installer l'app » masqués

### Points à connaître

- **`system.js` ne réimplémente aucun réglage.** Il exécute le script que `buildScript()` produit déjà, en forçant temporairement la sélection (`scriptFor()`). Corriger une commande dans `MODULES` la corrige partout, web et bureau. Choix structurant : ne pas créer une seconde source de vérité pour les 51 réglages.
- **`probes.js` ne doit jamais écrire.** C'est ce qui rend le fichier testable sans risque sur une vraie machine. `check.js` refuse toute commande d'écriture qui s'y glisserait.
- **Les éléments 3D du hero sont déplacés, pas supprimés.** La jauge, l'icosaèdre (`#ico`) et le sol animé (`#floor`) vivaient dans `.hero`, masqué en mode natif. Le bloc 6 les déplace dans le tableau de bord, retire la classe `rv` de `.gauge-wrap` (sinon elle resterait à `opacity:0`, son observateur de révélation ne se déclenchant plus) et émet un `resize` pour que les canvas se redimensionnent — ils se mesurent via `getBoundingClientRect()` au chargement, alors qu'ils étaient encore dans le hero.
- **`window.__heroLive` est redéfini en propriété avec un setter vide.** L'observateur du bloc 4 surveille `.hero` : masqué, il forcerait la variable à `false` en permanence et figerait les deux canvas. Le bloc 6 neutralise ses écritures et pilote l'animation depuis la visibilité réelle de la jauge — la mise en pause hors écran est donc conservée.
- **Ne jamais utiliser `querySelector('.main')`** dans le bloc 6 : la carte mise en avant de la section téléchargement portait la classe `.main` et était attrapée à la place du `<main>` de la coque. Elle s'appelle désormais `.feature`, et la coque a l'identifiant `#appMain`.
- **Une seule invite UAC** par exécution, pas une par réglage. La console élevée reste **visible** : c'est volontaire, le garde-fou « Taper OUI » des réglages à compromis exige une saisie, et voir défiler les commandes fait partie du contrat du produit.
- **`rp:elevate`** relance l'application en administrateur puis ferme l'instance courante. Sans élévation, deux sondes (`cpu-tick`, `win-vbs`, toutes deux via `bcdedit`) restent illisibles.
- **`ELECTRON_RUN_AS_NODE`** : si cette variable est définie, Electron démarre en simple Node, sans fenêtre, et `require('electron')` renvoie le chemin du binaire au lieu de l'API. **VS Code la pose pour ses sous-processus**, donc `npm start` depuis son terminal intégré tombe dedans. Le script `start` la nettoie et `main.js` affiche un message explicite si le cas se présente quand même. Piège coûteux à diagnostiquer : l'erreur est `Cannot read properties of undefined (reading 'app')`, qui ne pointe pas du tout vers la cause.
- **Une seule instance** à la fois : deux fenêtres pourraient appliquer des réglages concurrents. Le second lancement ramène la fenêtre existante au premier plan.
- **`contextIsolation: true`, `nodeIntegration: false`.** L'interface n'a aucun accès à Node ni au disque : elle ne peut que soumettre un script et lire l'état machine.
- L'installeur produit est **non signé** — voir la mise en garde SmartScreen en §10.

### Mises à jour automatiques

Les clients sont notifiés dans l'application, sans rien avoir à faire. La distribution passe par **GitHub Releases** (`tlonchambon95-cpu/radical-performance-downloads`), déjà utilisé par le site : bande passante illimitée sur un dépôt public, là où Netlify plafonne à 100 Go/mois — soit environ 1 000 téléchargements de 95 Mo.

**Le cycle de publication :**

1. Développer, puis monter le numéro dans `desktop/package.json`
2. Mettre à jour la mention de version dans la section « L'application » d'`index.html` (`check.js` vérifie qu'elles concordent)
3. `npm run dist`
4. Créer une publication GitHub taguée `v<version>` et y joindre **les trois fichiers** de `desktop/dist` :

| Fichier | Rôle | Si absent |
|---|---|---|
| `RadicalPerformance-Setup.exe` | L'installeur | rien à télécharger |
| `latest.yml` | Le manifeste que l'application interroge | **aucun client ne détecte la mise à jour** |
| `RadicalPerformance-Setup.exe.blockmap` | Carte des blocs | chaque mise à jour repart pour 95 Mo au lieu des seuls blocs modifiés |

```bash
cd desktop
gh release create v2.2.0 --title "Radical Performance v2.2.0" \
  dist/RadicalPerformance-Setup.exe dist/latest.yml dist/RadicalPerformance-Setup.exe.blockmap
```

**Points à connaître :**

- **`artifactName` doit rester sans numéro de version** (`RadicalPerformance-Setup.${ext}`). Le lien du site vise `releases/latest/download/RadicalPerformance-Setup.exe` : un nom versionné le casserait à chaque publication. `check.js` refuse un nom contenant `${version}`.
- **`autoDownload = false`** : rien ne se télécharge sans clic de l'utilisateur. Ne pas l'activer — le produit repose sur le fait que rien ne se fait dans son dos.
- **Le dépôt mélange deux générations** : les publications `v1.x` viennent de l'ancienne application .NET et n'ont pas de `latest.yml`. Tant que la plus récente est une `v2.x` correctement publiée, tout fonctionne. Une `v1.x` redevenue la plus récente casserait la détection.
- **Les erreurs sont traduites** avant affichage : `electron-updater` renvoie une trace d'appel de 2 000 caractères, illisible dans un bandeau. Le bloc 6 n'en garde que la première ligne et reformule les deux cas courants (aucun `latest.yml`, serveur injoignable).
- **Une version déjà installée sans ce système ne se mettra jamais à jour seule.** Le passage à la première version dotée de l'auto-update se fait forcément à la main.

### Ajouter une sonde

Un réglage qui a un `cmd` **doit** avoir une sonde, sinon l'application afficherait « non appliqué » sur un réglage qu'elle ne sait pas lire. `check.js` refuse ce cas.

Dans `desktop/probes.js`, ajouter une entrée `'<id du réglage>': \`<expression PowerShell>\`` renvoyant vrai/faux. Trois aides sont disponibles :

| Aide | Rôle |
|---|---|
| `RegVal $chemin $nom` | Valeur de registre, ou `$null` si absente |
| `AcIdx $sousGroupe $paramètre` | Index d'alimentation **secteur** du plan actif |
| `ActiveNic` | Carte réseau portant la route par défaut |

Ajouter l'id à `NEEDS_ADMIN` si la lecture exige l'élévation (`bcdedit`, typiquement) : sans ça, la sonde renverrait « absent » au lieu de « inconnu » pour un simple manque de droits.

Deux pièges rencontrés en écrivant les 24 sondes :

- **`AcIdx` ne parse pas les libellés de `powercfg`**, qui sont traduits. Il prend l'avant-dernière valeur hexadécimale de la sortie : l'ordre min / max / incrément / secteur / batterie est stable quelle que soit la langue.
- **`ActiveNic` passe par la route par défaut**, pas par « première carte active ». Les cartes virtuelles (VMware, VirtualBox, Hyper-V, VPN) sont « Up » elles aussi et passent souvent en premier. Ce défaut existait dans les commandes `net-dns` et `net-nic` d'origine : elles posaient le DNS sur une carte VMware, où il ne servait à rien. Corrigé dans `MODULES` également.

Tester une sonde sans lancer l'application :

```bash
cd desktop
node -e "require('./system').readState().then(r => console.log(r))"
```

Puis **vérifier le résultat contre la valeur brute** (`Get-ItemProperty`, `powercfg /query`). Une sonde qui répond « appliqué » à tout est pire que pas de sonde.

---

## 8. Vérifications avant toute modification

Le projet n'a pas de suite de tests packagée, mais un script de contrôle à lancer après toute modification (nécessite Node.js, aucune dépendance) :

```bash
node check.js             # après chaque modification
node check.js --deploy    # juste avant une mise en ligne
```

Il vérifie :

- **index.html** — 5 blocs `<script>` présents, syntaxe JS valide sur chacun
- **Données** — ids uniques, `cmd`/`rev` symétriques, `seg` existants, aucun `myth` armable, tout `manual` a ses `manualSteps`, répartition des verdicts
- **RGPD** — aucun domaine tiers dans le fichier (les polices sont auto-hébergées)
- **PWA** — manifest JSON valide et complet, `start_url` cohérent avec `index.html`, icône `maskable` et 512×512 présentes, fichiers réellement sur le disque, syntaxe de `sw.js`, `VERSION` déclarée, références croisées depuis le HTML, règle `.btn[hidden]`
- **Déploiement** — champs `[À COMPLÉTER]` des mentions légales, URL Open Graph réelle

Les contrôles de déploiement sont de simples `todo` en usage courant ; ils ne deviennent bloquants qu'avec `--deploy`. Le script sort en code 1 en cas d'échec, il est donc utilisable en pre-commit ou en CI.

Ce script ne teste ni le rendu ni le comportement : il valide la syntaxe et les données. **Un passage dans un vrai navigateur reste indispensable**, en particulier pour le mode démo, l'invite d'installation et le fonctionnement hors ligne.

---

## 9. Pièges connus / historique des choix

- **Chemins registre Windows dans les template literals JS** : `HKLM:\SYSTEM\...` doit s'écrire `HKLM:\\SYSTEM\\...` dans le code source, sinon `\S`, `\C` etc. sont interprétés comme des séquences d'échappement invalides par endroits. Toujours revalider avec `node --check` après édition d'une commande.
- **Le titre du hero est du texte réel**, pas un canvas — plusieurs itérations en 3D (glyphes dessinés à la main, extrusion, tri de profondeur) ont été tentées et abandonnées : rendu jugé peu convaincant. Le choix final est volontairement simple : Space Grotesk + dégradé + `drop-shadow`. Ne pas réintroduire de moteur 3D custom pour le titre sans une vraie bibliothèque (three.js ou équivalent) si le besoin revient.
- **L'icosaèdre et le sol animés (canvas, bloc script 3)** sont conservés et fonctionnent bien — ils se mettent en pause automatiquement via `window.__heroLive` (IntersectionObserver) quand le hero sort de l'écran, pour ne pas consommer de GPU inutilement pendant qu'on utilise la console plus bas.
- **Polices** : embarquées en base64 (fontsource, licence OFL) pour zéro requête externe. Si vous ajoutez une graisse ou une famille, régénérer le bloc avec `@fontsource/<police>` via npm plutôt que copier depuis Google Fonts (repasserait par un CDN externe).

---

## 10. Prochaines pistes évoquées (non développées)

- Panneau de résultats après génération : récapitulatif imprimable de la configuration armée, à joindre à une prestation WestLab
- Boucle de démo : rejouer la séquence indéfiniment pour un écran de salon laissé sans surveillance (aujourd'hui elle s'arrête à la fin et laisse le profil armé)
- **Portage Tauri**, si le besoin d'une vraie application native se confirme. Ce que ça débloquerait et que la PWA ne fera jamais : exécuter le script avec élévation depuis l'interface, et surtout **lire l'état réel de la machine** — plan d'alimentation actif, valeurs de registre déjà posées, fréquence de rafraîchissement, GPU. La jauge afficherait la configuration réelle au lieu du modèle théorique actuel (240 Hz, RTT 30 ms), avec un avant/après mesuré. C'est le seul argument sérieux en faveur du natif ; le confort d'installation, lui, est déjà couvert par la PWA.

  À budgéter avant de s'y engager : un `.exe` non signé qui demande les droits administrateur et modifie le registre et la pile réseau sera bloqué par SmartScreen et remonté par les antivirus — les heuristiques comportementales visent exactement ces gestes. Un certificat de signature de code coûte ~200–400 €/an et sa réputation SmartScreen se construit sur plusieurs semaines de téléchargements. La PWA contourne entièrement ce problème, c'est pourquoi elle a été faite en premier.

---

## 11. Déploiement

Avant mise en ligne publique :

1. Compléter les champs `[À COMPLÉTER]` du modal mentions légales (éditeur, SIRET, hébergeur) — footer du site
2. Remplacer `https://VOTRE-DOMAINE` dans les balises Open Graph (`<head>`) par l'URL réelle
3. Incrémenter `VERSION` dans `sw.js`
4. Lancer `node check.js --deploy` — doit sortir en code 0
5. **Uploader tous les fichiers à la racine**, au même niveau : `index.html`, `manifest.webmanifest`, `sw.js`, les 4 PNG d'icônes et `og.png`. Le service worker et le manifest utilisent des chemins relatifs (`./`), un déploiement en sous-dossier fonctionne, mais tout doit rester groupé.
6. **Servir en HTTPS** — obligatoire pour le service worker, l'installation et `navigator.clipboard`
7. **Tester chaque script généré sur une VM Windows 11 en français** avant de le proposer à qui que ce soit — aucune commande n'a été exécutée sur un Windows réel à ce stade, seulement validée syntaxiquement

**Piège d'hébergement :** certains serveurs ne connaissent pas l'extension `.webmanifest` et la servent en `text/plain`, ce qui fait silencieusement échouer l'installation. Le type attendu est `application/manifest+json`. Vérifier après mise en ligne :

```bash
curl -sI https://VOTRE-DOMAINE/manifest.webmanifest | grep -i content-type
```

Si l'hébergeur ne permet pas de configurer les types MIME, renommer le fichier en `manifest.json` et ajuster le `<link rel="manifest">` — ce nom est reconnu partout.

Sur Netlify, Vercel, Cloudflare Pages ou GitHub Pages, HTTPS et le type MIME sont corrects par défaut : un simple dépôt du dossier suffit.

---

## 12. Fichiers du projet

| Fichier | Rôle |
|---|---|
| `index.html` | L'application complète |
| `manifest.webmanifest` | Manifest PWA — nom, icônes, couleurs, mode d'affichage |
| `sw.js` | Service worker — cache et fonctionnement hors ligne |
| `icon-192.png` · `icon-512.png` | Icônes d'application (`any`) |
| `icon-maskable-512.png` | Icône `maskable` (masque de l'OS Android) |
| `apple-touch-icon.png` | Icône iOS / Safari, 180×180 |
| `og.png` | Image de partage (Open Graph), 1200×630 — sert aussi de capture au manifest |
| `desktop/main.js` · `preload.js` · `system.js` | Application de bureau — voir §7 |
| `desktop/probes.js` | Sondes de lecture d'état, une par réglage — lecture seule |
| `RadicalPerformance-Setup-*.exe` | Installeur Windows, produit par `npm run dist` puis copié ici |
| `check.js` | Contrôles d'intégrité — voir §8 |
| `make-icons.js` | Générateur d'icônes — outil ponctuel, voir §6 |
| `README.md` | Ce fichier |
