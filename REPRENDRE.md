# Reprendre le projet sur une autre machine

Ce dossier contient **tout le projet, historique Git compris**. Il n'y manque que
`desktop/node_modules` et `desktop/dist`, régénérés par une commande.

---

## 1. Ce qu'il faut installer d'abord

| Outil | Version | Où |
|---|---|---|
| Node.js | **22** ou plus | nodejs.org |
| Git | n'importe laquelle | git-scm.com |
| VS Code | — | code.visualstudio.com |

Vérifier ensuite dans un terminal : `node -v` doit afficher `v22` ou plus.

---

## 2. Mettre le dossier en place

Décompresser l'archive où tu veux, par exemple `C:\Users\<toi>\radical-performance`,
puis ouvrir ce dossier dans VS Code (**Fichier → Ouvrir le dossier**).

Ne pas le laisser dans `Téléchargements` ni dans un dossier synchronisé par
Proton Drive : la synchronisation en arrière-plan entre en conflit avec Git et
avec les constructions.

---

## 3. Réinstaller les dépendances

```bash
cd desktop
npm install
```

Environ 450 Mo téléchargés, deux à trois minutes. C'est tout ce qui manque.

---

## 4. Vérifier qu'on repart bien à l'identique

Depuis la racine du projet :

```bash
node check.js     # structure, données, application, publication
node audit.js     # symétrie des annulations
```

`check.js` doit afficher **Tout est vert** — sauf la ligne des mentions légales,
qui reste en `todo` tant que le SIRET manque. `audit.js` doit afficher
**À CORRIGER : 0**.

Si c'est le cas, tu es exactement là où tu t'étais arrêté.

---

## 5. Lancer l'application

```bash
cd desktop
npm start
```

> **Piège du terminal VS Code.** VS Code définit la variable
> `ELECTRON_RUN_AS_NODE` pour ses sous-processus. Electron démarre alors sans
> fenêtre, avec une erreur qui ne désigne pas la cause. Le script `npm start`
> nettoie déjà cette variable, et `main.js` affiche un message explicite si le
> cas se présente quand même. Voir §7 du README.

---

## 6. Publier une nouvelle version

```bash
node version.js 3.6.0
git add -A
git commit -m "Version 3.6.0"
git tag v3.6.0
git push && git push --tags
```

Le `push` met le site à jour. L'étiquette déclenche la construction et la
publication sur GitHub, qui notifie les clients dans l'application.

**Au premier `git push`**, GitHub demandera de t'authentifier : VS Code propose
une connexion, accepte-la. Le dépôt distant est déjà configuré, rien à ajouter.

Le secret `RELEASE_TOKEN` vit **sur GitHub**, pas sur une machine : il fonctionne
depuis n'importe quel poste.

---

## 7. Éprouver les réglages sur une machine cliente

```bash
node selftest.js            # aperçu, ne lance rien
node selftest.js --lancer   # exécute réellement, demande l'élévation
```

Applique chaque réglage, interroge sa sonde, annule, réinterroge — puis remet
la machine dans l'état où elle a été trouvée. Deux minutes.

**À faire sur la première machine cliente** : certains défauts dépendent de la
langue de Windows ou du matériel, et ne se voient que là.

---

## Ce qui reste à faire

1. **SIRET et adresse de déclaration** dans les mentions légales.
   `check.js --deploy` refuse la mise en ligne tant qu'ils manquent. La page
   annonce déjà « micro-entreprise » : ne rien facturer avant l'immatriculation.
2. **Le site** décrit encore un générateur de script, sans un mot des modules
   Processus, Diagnostic matériel, BIOS ni du rapport client.
3. **Le README** s'arrête à la version 2.x.

---

## Adresses utiles

- Site : https://tlonchambon95-cpu.github.io/radical-performance-site/
- Dépôt : https://github.com/tlonchambon95-cpu/radical-performance-site
- Publications : https://github.com/tlonchambon95-cpu/radical-performance-downloads/releases
