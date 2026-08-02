# Radical Performance — site

Site vitrine et console d'optimisation esport (Call of Duty compétitif), un outil WestLab.

Site **statique**, en un seul fichier `index.html` : HTML, CSS et JavaScript inline, polices
auto-hébergées en `data:`. Aucune dépendance, aucun build, aucune requête vers un service tiers,
aucun cookie, aucune collecte de données.

## Modifier le site

Tout tient dans `index.html`. Pour voir le rendu en local, il suffit d'ouvrir le fichier dans un
navigateur — pas de serveur nécessaire.

## Publier une mise à jour

Le site est déployé sur Netlify, connecté à ce dépôt GitHub. **Chaque `git push` sur la branche
`main` déclenche automatiquement un nouveau déploiement** — il n'y a rien d'autre à faire.

```powershell
git add .
git commit -m "Description de la modification"
git push
```

Netlify reconstruit et met le site en ligne en moins d'une minute. L'historique des déploiements
est consultable dans le tableau de bord Netlify, et chaque version précédente peut être restaurée
en un clic ("Rollback").

## Configuration

- `netlify.toml` — publication à la racine, sans commande de build, plus les en-têtes de sécurité
  (CSP stricte, anti-iframe, HSTS). La CSP autorise `'unsafe-inline'` parce que le site est
  volontairement écrit en fichier unique avec styles et scripts inline ; elle interdit en revanche
  toute connexion sortante (`connect-src 'none'`).

## À compléter avant la mise en ligne publique

Ces éléments sont marqués `[À COMPLÉTER]` dans la page « Mentions légales » du site et doivent être
renseignés pour être en conformité (LCEN) :

- Éditeur : nom ou raison sociale, statut, numéro SIRET, adresse, e-mail de contact
- Directeur de la publication
- Hébergeur : nom, adresse et téléphone (Netlify, Inc. — 512 2nd Street, Suite 200, San Francisco,
  CA 94107, États-Unis)

Il reste aussi à remplacer `https://VOTRE-DOMAINE` par l'URL réelle dans les balises Open Graph
(en-tête du fichier), et à fournir une image `og.png` si l'on souhaite un aperçu au partage.
