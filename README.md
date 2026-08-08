# Éclipse sur mon toit

Application web mobile qui superpose la **trajectoire du Soleil éclipsé** sur le
flux de la caméra du téléphone, pour répondre à une seule question : *est-ce que
mon horizon est dégagé dans la bonne direction, à la bonne heure ?*

Elle combine le GPS, le gyroscope/magnétomètre et la caméra. Aucune donnée ne
sort de l'appareil, et tout le calcul astronomique est fait en local — donc
l'app fonctionne hors ligne, ce qui est le cas d'usage réel (sur un toit).

> ⚠️ **Ne regarde jamais le Soleil, même éclipsé à 99 %, sans lunettes
> d'éclipse certifiées ISO 12312-2.** Les lunettes de soleil ordinaires ne
> protègent pas. Cette app sert à repérer *où* regarder, pas à remplacer une
> protection oculaire.

## Le cas du 12 août 2026

Éclipse **totale** en Islande et dans le nord de l'Espagne ; **partielle** ailleurs
en Europe. Circonstances calculées par cette app (heure suisse) :

| Lieu | Début | Maximum | Soleil couvert | Hauteur au max | Azimut | Coucher |
|---|---|---|---|---|---|---|
| Genève | 19:26 | 20:20 | 92.8 % | 4.1° | 287° (ONO) | ~20:49 |
| Lausanne | 19:26 | 20:20 | 92.2 % | 4.0° | 288° (ONO) | ~20:49 |
| Neuchâtel | 19:25 | 20:19 | 91.7 % | 4.1° | 288° (ONO) | ~20:50 |
| Berne | 19:25 | 20:19 | 91.5 % | 3.7° | 288° (ONO) | ~20:47 |
| Bâle | 19:24 | 20:18 | 90.8 % | 4.0° | 288° (ONO) | ~20:45 |
| Zurich | 19:24 | 20:18 | 90.6 % | 3.3° | 289° (ONO) | ~20:43 |
| Lugano | 19:27 | 20:20 | 91.9 % | 2.4° | 289° (ONO) | ~20:38 |

**Le point critique n'est pas la date, c'est la hauteur.** Le maximum a lieu
avec le Soleil à seulement 3–4° au-dessus de l'horizon, soit environ la largeur
de deux doigts tendus à bout de bras. Un immeuble, une colline ou une rangée
d'arbres à l'ouest-nord-ouest suffit à tout masquer. La fin théorique de
l'éclipse (~21:10) n'est pas observable : le Soleil se couche avant, vers 20:45.

C'est exactement ce que l'app permet de vérifier à l'avance, depuis l'endroit
précis où tu comptes t'installer.

## Utilisation

1. Ouvrir l'app sur le téléphone (**HTTPS obligatoire** — voir déploiement).
2. « Activer la caméra et la boussole », accepter les autorisations.
3. Réglages → « Utiliser ma position GPS ».
4. **Caler la boussole** : de jour, viser le Soleil réel, le centrer dans le
   viseur, appuyer sur « Caler ». C'est l'étape la plus importante — le
   magnétomètre d'un téléphone se trompe couramment de 10 à 20°, et le calage
   corrige d'un coup la déclinaison magnétique et le biais du capteur.
5. Pointer vers l'ouest-nord-ouest : la courbe jaune est la trajectoire du
   Soleil pendant l'éclipse, avec les heures clés. Si elle passe derrière un
   toit, tu as ta réponse.
6. Le curseur du bas rejoue l'éclipse minute par minute ; « Maximum » saute à
   l'instant le plus couvert.

Sans capteurs (ou sur ordinateur), la **vue carte** trace la même trajectoire en
azimut/hauteur et reste entièrement utilisable.

Ajouter l'app à l'écran d'accueil la rend disponible hors ligne.

## Déploiement

La caméra, la boussole et le GPS exigent un contexte sécurisé : l'app doit être
servie en **HTTPS** (ou depuis `localhost`). Le plus simple est GitHub Pages :

```bash
git push -u origin main
```

Puis dans le dépôt : *Settings → Pages → Source: Deploy from a branch → main /
(root)*. L'app est un site statique sans build — les fichiers sont servis tels
quels.

En local :

```bash
npx serve -l 5174 .
```

## Précision

Les éphémérides sont validées contre les exemples de référence de Jean Meeus,
*Astronomical Algorithms* (2ᵉ éd.) et contre les données NASA de l'éclipse :

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
  dessous du toit ».

Le facteur limitant n'est donc pas l'astronomie mais le magnétomètre du
téléphone, d'où l'importance du calage sur le Soleil.

## Structure

```
index.html            écran unique
js/astro.js           éphémérides Soleil/Lune, circonstances locales (sans dépendance)
js/ar.js              capteurs d'orientation, projection ciel -> écran
js/app.js             état, interface, rendu canvas
sw.js                 hors ligne (réseau d'abord, cache en secours)
tools/verify.mjs      validation des éphémérides
tools/make-icons.mjs  génération des icônes PNG
```

L'app fonctionne pour n'importe quelle éclipse solaire et n'importe quel lieu :
changer la date et la position dans les réglages. `findEclipse` balaie la
journée et renvoie `null` s'il n'y a rien à voir depuis cet endroit.

## Licence

MIT.
