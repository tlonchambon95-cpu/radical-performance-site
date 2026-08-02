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

## Obligations légales

> Ces informations décrivent le cadre général du droit français. Elles ne remplacent pas l'avis
> d'un juriste, en particulier sur la question de la responsabilité (voir plus bas).

### La règle qui décide de tout : gratuit ou payant ?

**Tant que le projet est intégralement gratuit** — aucune vente, aucun don, aucune publicité,
aucun sponsor, aucune version payante — il s'agit d'une publication **non professionnelle**.
Aucun SIRET n'est nécessaire. L'article 6 III-2 de la LCEN permet même à l'éditeur non
professionnel de rester anonyme sur le site, à condition d'avoir communiqué son identité à
l'hébergeur (ce qui est fait automatiquement en créant un compte Netlify) et d'afficher les
coordonnées de cet hébergeur.

**Dès le premier euro encaissé**, l'activité devient professionnelle. Il faut alors être immatriculé
**avant** de percevoir quoi que ce soit : encaisser sans être déclaré constitue du travail dissimulé.
Cela vaut aussi pour les dons récurrents (Tipeee, Ko-fi, Patreon), les revenus publicitaires et les
partenariats rémunérés.

### Obtenir un SIRET (micro-entreprise)

Gratuit, entièrement en ligne, une quinzaine de minutes.

1. Aller sur **formalites.entreprises.gouv.fr** (le guichet unique de l'INPI ; depuis 2023, c'est
   le seul point d'entrée valable — les anciens sites URSSAF y redirigent)
2. Créer un compte, puis « Déposer une formalité de création d'entreprise »
3. Personne physique → entrepreneur individuel → régime micro-entreprise
4. Activité : développement/édition de logiciels (code APE généralement 62.01Z)
5. Le SIRET arrive par courrier ou courriel sous une à quatre semaines

Points à connaître :

- **Aucune charge tant qu'il n'y a aucun revenu**, mais il faut déclarer le chiffre d'affaires
  (même à 0 €) tous les mois ou trimestres, sous peine de pénalité.
- **La TVA ne s'applique pas** sous les seuils de franchise en base. La mention
  « TVA non applicable, article 293 B du CGI » est alors **obligatoire** sur le site et sur
  chaque facture — elle figure déjà dans les mentions légales.
- **L'adresse déclarée devient publique** sur la base SIRENE de l'INSEE et doit figurer dans les
  mentions légales. Pour éviter d'exposer son domicile : demander la non-diffusion des données sur
  le site de l'INSEE (cela masque l'annuaire, pas les mentions légales), ou passer par une société
  de domiciliation (environ 10 à 30 € par mois).

### À ajouter le jour où le site vend quelque chose

- **Conditions générales de vente (CGV)** : obligatoires en vente à distance aux particuliers.
- **Droit de rétractation** : 14 jours en principe. Pour un contenu numérique téléchargé
  immédiatement, il peut être écarté, mais uniquement si le client renonce expressément et en est
  informé avant l'achat.
- **Médiateur de la consommation** : tout professionnel vendant à des particuliers doit adhérer à
  un dispositif de médiation et en afficher les coordonnées. C'est une obligation souvent ignorée,
  et sanctionnable.

### Responsabilité : le point le plus sensible

L'application modifie le registre, les services Windows et les plans d'alimentation, et certains
réglages classés « Compromis » réduisent volontairement des protections de sécurité du système.
Une clause de non-responsabilité **ne protège pas d'une action pour produit défectueux**, et le
statut professionnel augmente le niveau d'exigence. Trois précautions concrètes :

- ne jamais appliquer un réglage à risque sans confirmation explicite (déjà le cas dans
  l'application comme dans les scripts générés) ;
- conserver la sauvegarde et le script de retour arrière (déjà le cas) ;
- si le projet devient payant, envisager une assurance responsabilité civile professionnelle et
  faire relire les CGV.

### Divers

Remplacer `https://VOTRE-DOMAINE` par l'URL réelle dans les balises Open Graph (en-tête du fichier),
et fournir une image `og.png` pour l'aperçu au partage.
