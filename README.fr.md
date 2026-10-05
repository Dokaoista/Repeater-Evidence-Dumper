# Repeater Evidence Dumper

[English](README.md) · [Português (BR)](README.pt-BR.md) · [Español](README.es.md) · [简体中文](README.zh-CN.md) · [Русский](README.ru.md) · **Français** · [Deutsch](README.de.md) · [日本語](README.ja.md)

Extension Burp Suite qui transforme chaque *Send* du Repeater en capture de
preuve prête pour le rapport, avec l'apparence de l'interface de Burp et les
secrets déjà masqués.

![Exemple de sortie](samples/demo.png)

Constituer les preuves d'un rapport de bug bounty ou de pentest est
habituellement une corvée manuelle : capturer la fenêtre de Burp, recadrer,
flouter le cookie, recommencer pour chaque requête. Ici tout le cycle est
automatisé. Vous envoyez la requête dans le Repeater et le PNG apparaît.

## Fonctionnement

Trois pièces, reliées par un répertoire :

```
Burp Repeater ──(chaque Send)──▶ ~/burp-evidence/inbox/*.request.txt
                                                      *.response.txt
                                         │
                            watch.sh (scrutation 3s)
                                         │
                                    shot.mjs  ──▶ HTML au thème de Burp
                                         │        └▶ navigateur headless (--screenshot)
                                         │             └▶ crop.py (recadrage + mention)
                                         ▼
                                 ~/burp-evidence/out/*.png
```

1. **`extension/`** est l'extension Java (Montoya API). Elle enregistre un
   `HttpHandler` qui écrit en texte brut chaque paire requête/réponse issue du
   Repeater.
2. **`watch.sh`** surveille `inbox/` et génère chaque nouvelle paire. Il
   n'écrase jamais un PNG existant, considéré comme déjà relu, et consigne les
   échecs dans `.failed/` pour ne pas réessayer en boucle.
3. **`shot.mjs`** construit une page HTML qui reproduit l'allure de Burp
   (panneaux Request et Response, numérotation des lignes, coloration
   syntaxique JSON) et la photographie avec un navigateur headless. `crop.py`
   plafonne la hauteur en ajoutant un bandeau d'avertissement, pour qu'un
   recadrage ne soit jamais silencieux.

## Prérequis

| Composant | Nécessaire pour |
|---|---|
| Burp Suite (Montoya API 2025.5) | l'extension |
| Java 17+ | compiler l'extension |
| Node.js | `shot.mjs` (sans dépendance externe) |
| Python 3 + [Pillow](https://pypi.org/project/Pillow/) | `crop.py` (recadrage en hauteur) |
| Chrome/Chromium/Edge/Vivaldi, Firefox ou Brave | générer la capture |

Le moteur de rendu essaie ces navigateurs dans cet ordre et prend le premier qui
fonctionne. Les chemins sont ceux de macOS. Sur un autre système, ajustez les
constantes `CHROMIUM`, `FIREFOX` et `BRAVE` en haut de `shot.mjs`.

## Compilation

```bash
cd extension
./gradlew build
```

Le jar arrive dans `extension/build/libs/repeater-evidence-dumper.jar`. La
Montoya API est déclarée `compileOnly` : c'est le classloader de Burp qui la
fournit à l'exécution, elle n'est donc jamais embarquée dans le jar.

Vous préférez ne pas compiler ? Récupérez le jar déjà construit sur la page
[Releases](../../releases).

## Installation

1. **Burp** → *Extensions* → *Add* → type *Java* → sélectionnez le jar.
   Le journal doit afficher `Repeater Evidence Dumper loaded`.
2. Copiez les trois scripts dans le répertoire d'exécution :

```bash
mkdir -p ~/burp-evidence && cp shot.mjs crop.py watch.sh ~/burp-evidence/
```

3. Lancez le watcher :

```bash
cd ~/burp-evidence && ./watch.sh &
```

> Le chemin `~/burp-evidence/` est codé en dur : l'extension écrit dans
> `$HOME/burp-evidence/inbox` et `watch.sh` s'attend à trouver `shot.mjs` à côté
> de lui. Pour le changer, modifiez la constante `INBOX` dans le code Java et
> `HOME_DIR` dans `watch.sh`.

## Utilisation

**Automatique.** N'importe quel *Send* dans le Repeater écrit la paire, et le
watcher la génère dans `~/burp-evidence/out/`, nommée d'après l'id du message,
la méthode et le chemin :

```
00042-post-api-activity-categories.png
```

**Manuel.** Clic droit dans l'éditeur de requête/réponse d'un onglet Repeater
puis **"Dump Repeater tab now (evidence)"**. Utile quand l'onglet n'a pas encore
été envoyé, auquel cas seule la requête est capturée, ou pour forcer une capture
ponctuelle. Ces fichiers s'appellent `manual-00001-...`.

**Autonome.** Le moteur de rendu fonctionne seul sur n'importe quelle paire de
fichiers :

```bash
node shot.mjs --request req.txt --response resp.txt --out preuve.png
```

## Masquage des secrets

Actif par défaut. La valeur des en-têtes ci-dessous est remplacée par
`<REDACTED>` avant tout rendu :

`Cookie` · `Set-Cookie` · `Authorization` · `Proxy-Authorization` ·
`X-CSRF-Token` · `X-XSRF-Token` · `X-Auth-Token`

Les cookies conservent le **nom** de chaque paire et seule la valeur est masquée
(`app.sid=<REDACTED>`), ce qui garde la preuve lisible. On voit qu'une session
existait sans exposer la session. Pour `Authorization`, le schéma est préservé
(`Bearer <REDACTED>`).

`--no-redact` désactive le masquage. Ne l'utilisez pas sur des preuves destinées
à un rapport.

## Options de `shot.mjs`

| Option | Par défaut | Effet |
|---|---|---|
| `--request <fichier>` | obligatoire | fichier de la requête |
| `--response <fichier>` | aucun | fichier de la réponse |
| `--out <fichier.png>` | obligatoire | PNG de sortie |
| `--width <px>` | `2000` | largeur de l'image |
| `--scale <n>` | `1` | facteur d'échelle de l'écran (`2` pour du retina) |
| `--max-height <px>` | `420` | hauteur maximale ; au-delà, recadrage avec mention. `0` désactive |
| `--all-headers` | désactivé | affiche tous les en-têtes, pas seulement les essentiels |
| `--no-redact` | désactivé | désactive le masquage des secrets |
| `--input <spec.json>` | aucun | lit les paramètres depuis un JSON plutôt que la ligne de commande |

Par défaut le rendu n'affiche que les en-têtes utiles au rapport (`Host`,
`Content-Type`, `Cookie`, `Location`, `Origin`, `Referer`, entre autres) et
indique combien ont été omis. Les corps de plus de 300 lignes sont tronqués avec
le nombre total de lignes et d'octets. Dans les deux cas la mention reste
visible sur l'image, et le `.txt` brut dans `inbox/` conserve le contenu
complet.

Format de `--input` :

```json
{
  "request_file": "req.txt",
  "response_file": "resp.txt",
  "out": "preuve.png",
  "width": 2000,
  "scale": 1,
  "redact": true
}
```

## Limite connue

La Montoya API 2025.5 n'expose aucun moyen d'énumérer les onglets Repeater
ouverts ni de lire l'état courant d'un onglet. Le paquet
`burp.api.montoya.repeater` ne propose que `Repeater.sendToRepeater(...)`. La
capture est donc pilotée par événement, déclenchée à chaque *Send* réel, plutôt
qu'une lecture passive de l'état des onglets.

En pratique c'est équivalent voire préférable pour produire des preuves,
puisqu'il n'y a aucun délai. Mais cela signifie qu'un onglet composé et jamais
envoyé n'est capturé que via l'entrée de menu manuelle.

## Licence

MIT. Voir [LICENSE](LICENSE).
