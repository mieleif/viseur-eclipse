# Voir l'éclipse

Application web mobile qui superpose la **trajectoire du Soleil éclipsé** sur le
flux de la caméra du téléphone, pour répondre à une seule question : *depuis
l'endroit où je serai, mon horizon est-il dégagé dans la bonne direction, à la
bonne heure ?*

Elle combine le GPS, le gyroscope/magnétomètre et la caméra. Tout le calcul
astronomique est fait sur l'appareil : aucune donnée ne sort, et l'app
fonctionne hors ligne — ce qui est le cas d'usage réel, en général loin d'une
bonne couverture réseau.

> ⚠️ **Ne regarde jamais le Soleil, même éclipsé à 99 %, sans lunettes
> d'éclipse certifiées ISO 12312-2.** Les lunettes de soleil ordinaires ne
> protègent pas. Cette app sert à repérer *où* regarder, pas à remplacer une
> protection oculaire.

## Ce qu'elle fait

- **Trouve les éclipses toute seule.** Donne ta position : l'app balaie les huit
  prochaines années et liste celles réellement observables depuis ce point.
  Aucune date n'est codée en dur ; n'importe quelle date passée ou future peut
  aussi être saisie à la main.
- **Distingue le maximum théorique de ce qui est visible.** Une éclipse dont le
  pic tombe sous l'horizon ne vaut que ce qu'on en voit avant. L'app calcule le
  meilleur instant *au-dessus de l'horizon* et affiche celui-là.
- **Projette la trajectoire en réalité augmentée**, avec les heures clés, pour
  la confronter à la vraie ligne d'horizon : immeubles, crête, arbres.
- **Rejoue l'éclipse** minute par minute, avec la phase dessinée à l'orientation
  correcte par rapport à l'horizon.
- **Vue carte** en azimut/hauteur quand les capteurs manquent, ou sur ordinateur.

## Utilisation

1. Ouvrir l'app sur le téléphone (**HTTPS obligatoire** — voir déploiement).
2. « Utiliser ma position », puis choisir l'éclipse dans la liste.
3. « Activer la caméra et la boussole », accepter les autorisations.
4. **Caler la boussole** : de jour, viser le Soleil réel, le centrer dans le
   viseur, appuyer sur « Caler ». C'est l'étape la plus importante — le
   magnétomètre d'un téléphone se trompe couramment de 10 à 20°, et le calage
   corrige d'un coup la déclinaison magnétique et le biais du capteur.
5. Pointer dans la direction annoncée : la courbe jaune est la trajectoire du
   Soleil pendant l'éclipse. Si elle passe derrière un obstacle, tu as ta
   réponse — et tu peux aller chercher un meilleur poste d'observation.

Ajouter l'app à l'écran d'accueil la rend disponible hors ligne.

## Exemple : 12 août 2026

Éclipse **totale** en Islande et dans le nord de l'Espagne, **partielle**
ailleurs en Europe. Circonstances calculées par cette app (heure suisse) :

| Lieu | Début | Maximum | Soleil couvert | Hauteur au max | Azimut | Coucher |
|---|---|---|---|---|---|---|
| Genève | 19:26 | 20:20 | 92.8 % | 4.1° | 287° (ONO) | ~20:49 |
| Lausanne | 19:26 | 20:20 | 92.2 % | 4.0° | 288° (ONO) | ~20:49 |
| Berne | 19:25 | 20:19 | 91.5 % | 3.7° | 288° (ONO) | ~20:47 |
| Zurich | 19:24 | 20:18 | 90.6 % | 3.3° | 289° (ONO) | ~20:43 |
| Lugano | 19:27 | 20:20 | 91.9 % | 2.4° | 289° (ONO) | ~20:38 |

Le point critique n'est pas la date mais la **hauteur** : 3–4° au-dessus de
l'horizon, soit deux doigts tendus à bout de bras. Un immeuble ou une crête à
l'ouest-nord-ouest suffit à tout masquer, et la fin théorique (~21:10) n'est de
toute façon pas observable puisque le Soleil se couche avant.

Attention : les heures de coucher ci-dessus sont celles de l'horizon
**théorique**. Le relief réel les avance — c'est précisément ce que la vue en
réalité augmentée permet de vérifier sur place.

## Déploiement

La caméra, la boussole et le GPS exigent un contexte sécurisé : l'app doit être
servie en **HTTPS** (ou depuis `localhost`). C'est un site statique sans build,
les fichiers sont servis tels quels. Sur GitHub Pages : *Settings → Pages →
Deploy from a branch → main / (root)*.

L'app utilise uniquement des chemins relatifs et fonctionne donc aussi bien à la
racine d'un domaine que dans un sous-chemin (`exemple.com/eclipse/`). Dans ce
cas, prévoir une redirection de `/eclipse` vers `/eclipse/` : sans la barre
oblique finale, les chemins relatifs se résolvent à la racine.

En local :

```bash
npx serve -l 5174 .
```

## Précision

Les éphémérides sont validées contre les exemples de référence de Jean Meeus,
*Astronomical Algorithms* (2ᵉ éd.) et contre les données NASA :

```bash
node tools/verify.mjs
```

| Contrôle | Écart mesuré |
|---|---|
| Lune, longitude apparente (ex. 47.a) | 3 × 10⁻⁷ ° |
| Lune, distance (ex. 47.a) | 0.015 km |
| Soleil, longitude apparente (ex. 25.b) | 8 × 10⁻⁶ ° |
| Instant de plus grande éclipse (réf. NASA) | 9.5 s |
| Magnitude au maximum (réf. NASA 1.039) | 7.6 × 10⁻⁵ |

La recherche d'éclipses se vérifie aussi de l'extérieur : depuis Sydney elle
retrouve la totale du 22 juillet 2028, depuis Quito la partielle du 14 novembre
2031.

Choix qui comptent pour ce niveau de précision :

- **Parallaxe traitée vectoriellement.** On soustrait le vecteur géocentrique de
  l'observateur, ce qui donne direction *et* distance topocentriques. Le
  demi-diamètre lunaire varie de ~2 % entre le centre de la Terre et la surface,
  ce qui déplace les instants de contact de plusieurs minutes.
- **ΔT tabulé, pas extrapolé.** Les polynômes d'Espenak-Meeus prédisaient ~75 s
  pour 2026 ; la valeur observée stagne autour de 69 s depuis 2016. Les 6 s
  d'écart valent ~12 s sur les contacts.
- **Réfraction atmosphérique** (formule de Bennett), qui vaut ~0.15° à 4° de
  hauteur — non négligeable quand toute la question est « au-dessus ou en
  dessous de l'obstacle ».

Le facteur limitant n'est donc pas l'astronomie mais le magnétomètre du
téléphone, d'où l'importance du calage sur le Soleil.

## Structure

```
index.html            écran unique
js/astro.js           éphémérides Soleil/Lune, circonstances locales,
                      recherche des éclipses à venir (sans dépendance)
js/ar.js              capteurs d'orientation, projection ciel -> écran
js/app.js             état, interface, rendu canvas
sw.js                 hors ligne (réseau d'abord, cache en secours)
tools/verify.mjs      validation des éphémérides
tools/make-icons.mjs  génération des icônes PNG
```

## Licence

MIT.
