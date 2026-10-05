# Repeater Evidence Dumper

[English](README.md) · [Português (BR)](README.pt-BR.md) · [Español](README.es.md) · [简体中文](README.zh-CN.md) · [Русский](README.ru.md) · [Français](README.fr.md) · **Deutsch** · [日本語](README.ja.md)

Eine Burp-Suite-Erweiterung, die jedes *Send* im Repeater in einen
berichtsfertigen Beweis-Screenshot verwandelt, im Look der Burp-Oberfläche und
mit bereits geschwärzten Geheimnissen.

![Beispielausgabe](samples/demo.png)

Beweise für einen Bug-Bounty- oder Pentest-Bericht zu sammeln ist normalerweise
Handarbeit: Burp-Fenster abfotografieren, zuschneiden, Cookie unkenntlich
machen, und das für jeden Request von vorn. Hier läuft der ganze Zyklus
automatisch. Du schickst den Request im Repeater ab und das PNG erscheint.

## Funktionsweise

Drei Teile, über ein Verzeichnis verbunden:

```
Burp Repeater ──(jedes Send)──▶ ~/burp-evidence/inbox/*.request.txt
                                                     *.response.txt
                                        │
                           watch.sh (3s-Polling)
                                        │
                                   shot.mjs  ──▶ HTML im Burp-Theme
                                        │        └▶ Headless-Browser (--screenshot)
                                        │             └▶ crop.py (Zuschnitt + Hinweis)
                                        ▼
                                ~/burp-evidence/out/*.png
```

1. **`extension/`** ist die Java-Erweiterung (Montoya API). Sie registriert
   einen `HttpHandler`, der jedes aus dem Repeater stammende Paar aus Request
   und Response als Rohtext wegschreibt.
2. **`watch.sh`** beobachtet `inbox/` und rendert jedes neue Paar. Ein bereits
   vorhandenes PNG wird nie überschrieben, da es als geprüft gilt, und Fehler
   landen in `.failed/`, damit nicht endlos neu versucht wird.
3. **`shot.mjs`** baut eine HTML-Seite, die das Aussehen von Burp nachbildet
   (Request- und Response-Bereich, Zeilennummern, JSON-Syntaxhervorhebung), und
   fotografiert sie mit einem Headless-Browser. `crop.py` begrenzt die Höhe und
   setzt einen Hinweisbalken darunter, damit ein Zuschnitt nie stillschweigend
   passiert.

## Voraussetzungen

| Komponente | Wird gebraucht für |
|---|---|
| Burp Suite (Montoya API 2025.5) | die Erweiterung |
| Java 17+ | das Bauen der Erweiterung |
| Node.js | `shot.mjs` (ohne externe Abhängigkeiten) |
| Python 3 + [Pillow](https://pypi.org/project/Pillow/) | `crop.py` (Höhenzuschnitt) |
| Chrome/Chromium/Edge/Vivaldi, Firefox oder Brave | das Rendern des Screenshots |

Der Renderer probiert diese Browser in dieser Reihenfolge und nimmt den ersten,
der funktioniert. Die Pfade sind macOS-Pfade. Auf einem anderen System passe die
Konstanten `CHROMIUM`, `FIREFOX` und `BRAVE` am Anfang von `shot.mjs` an.

## Bauen

```bash
cd extension
./gradlew build
```

Das Jar landet in `extension/build/libs/repeater-evidence-dumper.jar`. Die
Montoya API ist als `compileOnly` deklariert, sie wird also zur Laufzeit vom
Classloader von Burp bereitgestellt und kommt nie ins Jar.

Lieber nicht selbst bauen? Hol dir das fertige Jar von der Seite
[Releases](../../releases).

## Installation

1. **Burp** → *Extensions* → *Add* → Typ *Java* → das Jar auswählen.
   Im Log sollte `Repeater Evidence Dumper loaded` erscheinen.
2. Die drei Skripte ins Laufzeitverzeichnis kopieren:

```bash
mkdir -p ~/burp-evidence && cp shot.mjs crop.py watch.sh ~/burp-evidence/
```

3. Den Watcher starten:

```bash
cd ~/burp-evidence && ./watch.sh &
```

> Der Pfad `~/burp-evidence/` ist fest verdrahtet: Die Erweiterung schreibt nach
> `$HOME/burp-evidence/inbox`, und `watch.sh` erwartet `shot.mjs` direkt
> daneben. Zum Ändern die Konstante `INBOX` im Java-Code und `HOME_DIR` in
> `watch.sh` anpassen.

## Benutzung

**Automatisch.** Jedes *Send* im Repeater schreibt das Paar, und der Watcher
rendert es nach `~/burp-evidence/out/`, benannt nach Message-ID, Methode und
Pfad:

```
00042-post-api-activity-categories.png
```

**Manuell.** Rechtsklick im Request/Response-Editor eines Repeater-Tabs und dann
**"Dump Repeater tab now (evidence)"**. Nützlich, wenn der Tab noch nicht
abgeschickt wurde, dann wird nur der Request erfasst, oder um gezielt eine
einzelne Aufnahme zu erzwingen. Diese heißen `manual-00001-...`.

**Eigenständig.** Der Renderer läuft allein über jedes beliebige Dateipaar:

```bash
node shot.mjs --request req.txt --response resp.txt --out beweis.png
```

## Schwärzen von Geheimnissen

Standardmäßig aktiv. Bei den folgenden Headern wird der Wert vor jedem Rendern
durch `<REDACTED>` ersetzt:

`Cookie` · `Set-Cookie` · `Authorization` · `Proxy-Authorization` ·
`X-CSRF-Token` · `X-XSRF-Token` · `X-Auth-Token`

Cookies behalten den **Namen** jedes Paares, geschwärzt wird nur der Wert
(`app.sid=<REDACTED>`), wodurch der Beweis lesbar bleibt. Man sieht, dass eine
Session vorhanden war, ohne die Session preiszugeben. Bei `Authorization` bleibt
das Schema erhalten (`Bearer <REDACTED>`).

`--no-redact` schaltet das ab. Nicht bei Beweisen verwenden, die in einen
Bericht wandern.

## Optionen von `shot.mjs`

| Flag | Standard | Wirkung |
|---|---|---|
| `--request <Datei>` | Pflicht | Request-Datei |
| `--response <Datei>` | keine | Response-Datei |
| `--out <Datei.png>` | Pflicht | Ausgabe-PNG |
| `--width <px>` | `2000` | Bildbreite |
| `--scale <n>` | `1` | Geräte-Skalierungsfaktor (für Retina `2`) |
| `--max-height <px>` | `420` | maximale Höhe; darüber Zuschnitt mit Hinweis. `0` deaktiviert |
| `--all-headers` | aus | zeigt alle Header, nicht nur die wesentlichen |
| `--no-redact` | aus | deaktiviert das Schwärzen von Geheimnissen |
| `--input <spec.json>` | keine | liest die Parameter aus einer JSON-Datei statt von der Kommandozeile |

Standardmäßig zeigt das Rendering nur die für den Bericht relevanten Header
(`Host`, `Content-Type`, `Cookie`, `Location`, `Origin`, `Referer` und weitere)
und vermerkt, wie viele ausgelassen wurden. Bodies über 300 Zeilen werden
gekürzt, mit Angabe der Gesamtzahl an Zeilen und Bytes. In beiden Fällen ist der
Hinweis im Bild sichtbar, und das rohe `.txt` in `inbox/` enthält weiterhin den
vollständigen Inhalt.

Format von `--input`:

```json
{
  "request_file": "req.txt",
  "response_file": "resp.txt",
  "out": "beweis.png",
  "width": 2000,
  "scale": 1,
  "redact": true
}
```

## Bekannte Einschränkung

Die Montoya API 2025.5 bietet keine Möglichkeit, offene Repeater-Tabs
aufzuzählen oder den aktuellen Zustand eines Tabs zu lesen. Das Paket
`burp.api.montoya.repeater` enthält nur `Repeater.sendToRepeater(...)`. Die
Erfassung ist deshalb ereignisgesteuert und löst bei jedem echten *Send* aus,
statt den Zustand der Tabs passiv zu lesen.

Für das Erzeugen von Beweisen ist das in der Praxis gleichwertig oder besser, da
es keine Verzögerung gibt. Es bedeutet aber, dass ein Tab, der zusammengestellt
und nie abgeschickt wurde, nur über den manuellen Menüeintrag erfasst wird.

## Lizenz

MIT. Siehe [LICENSE](LICENSE).
