# Repeater Evidence Dumper

[English](README.md) · [Português (BR)](README.pt-BR.md) · **Español** · [简体中文](README.zh-CN.md) · [Русский](README.ru.md) · [Français](README.fr.md) · [Deutsch](README.de.md) · [日本語](README.ja.md)

Extensión de Burp Suite que convierte cada *Send* del Repeater en una captura de
evidencia lista para el informe, con el aspecto de la interfaz de Burp y con los
secretos ya redactados.

![Ejemplo de salida](samples/demo.png)

Capturar evidencia para un informe de bug bounty o de pentest suele ser un
trabajo manual: tomar la captura de la ventana de Burp, recortarla, difuminar la
cookie y repetir con cada petición. Esto automatiza el ciclo completo. Envías la
petición en el Repeater y el PNG aparece.

## Cómo funciona

Tres piezas, conectadas por un directorio:

```
Burp Repeater ──(cada Send)──▶ ~/burp-evidence/inbox/*.request.txt
                                                    *.response.txt
                                       │
                        watch.sh (sondeo de 3s)
                                       │
                                  shot.mjs  ──▶ HTML con el tema de Burp
                                       │        └▶ navegador headless (--screenshot)
                                       │             └▶ crop.py (recorte + aviso)
                                       ▼
                               ~/burp-evidence/out/*.png
```

1. **`extension/`** es la extensión Java (Montoya API). Registra un
   `HttpHandler` que escribe en texto plano cada par petición/respuesta
   originado en el Repeater.
2. **`watch.sh`** vigila `inbox/` y renderiza cada par nuevo. Nunca sobrescribe
   un PNG existente, que se presume revisado, y marca los fallos en `.failed/`
   para no reintentar en bucle.
3. **`shot.mjs`** arma un HTML que replica el aspecto de Burp (paneles Request y
   Response, numeración de líneas, resaltado de sintaxis JSON) y lo fotografía
   con un navegador headless. `crop.py` limita la altura y añade una franja de
   aviso para que el recorte nunca sea silencioso.

## Requisitos

| Componente | Necesario para |
|---|---|
| Burp Suite (Montoya API 2025.5) | la extensión |
| Java 17+ | compilar la extensión |
| Node.js | `shot.mjs` (sin dependencias externas) |
| Python 3 + [Pillow](https://pypi.org/project/Pillow/) | `crop.py` (recorte de altura) |
| Chrome/Chromium/Edge/Vivaldi, Firefox o Brave | renderizar la captura |

El renderizador prueba esos navegadores en ese orden y usa el primero que
funcione. Las rutas son de macOS. En otro sistema operativo, ajusta las
constantes `CHROMIUM`, `FIREFOX` y `BRAVE` al inicio de `shot.mjs`.

## Compilación

```bash
cd extension
./gradlew build
```

El jar queda en `extension/build/libs/repeater-evidence-dumper.jar`. La Montoya
API se declara como `compileOnly`, así que el classloader de Burp la provee en
tiempo de ejecución y nunca se empaqueta dentro del jar.

¿Prefieres no compilar? Descarga el jar ya construido desde la página de
[Releases](../../releases).

## Instalación

1. **Burp** → *Extensions* → *Add* → tipo *Java* → selecciona el jar.
   El log debe mostrar `Repeater Evidence Dumper loaded`.
2. Copia los tres scripts al directorio de ejecución:

```bash
mkdir -p ~/burp-evidence && cp shot.mjs crop.py watch.sh ~/burp-evidence/
```

3. Levanta el watcher:

```bash
cd ~/burp-evidence && ./watch.sh &
```

> La ruta `~/burp-evidence/` está fija: la extensión escribe en
> `$HOME/burp-evidence/inbox` y `watch.sh` espera encontrar `shot.mjs` a su
> lado. Para cambiarla, edita la constante `INBOX` en el código Java y
> `HOME_DIR` en `watch.sh`.

## Uso

**Automático.** Cualquier *Send* en el Repeater escribe el par, y el watcher lo
renderiza en `~/burp-evidence/out/`, con el nombre formado por el id del
mensaje, el método y la ruta:

```
00042-post-api-activity-categories.png
```

**Manual.** Clic derecho dentro del editor de petición/respuesta de una pestaña
del Repeater y elige **"Dump Repeater tab now (evidence)"**. Útil cuando la
pestaña todavía no se ha enviado, en cuyo caso captura solo la petición, o para
forzar una captura puntual. Estos salen como `manual-00001-...`.

**Suelto.** El renderizador funciona por su cuenta sobre cualquier par de
archivos:

```bash
node shot.mjs --request req.txt --response resp.txt --out evidencia.png
```

## Redacción de secretos

Activada por defecto. A las siguientes cabeceras se les reemplaza el valor por
`<REDACTED>` antes de cualquier renderizado:

`Cookie` · `Set-Cookie` · `Authorization` · `Proxy-Authorization` ·
`X-CSRF-Token` · `X-XSRF-Token` · `X-Auth-Token`

Las cookies conservan el **nombre** de cada par y solo se redacta el valor
(`app.sid=<REDACTED>`), lo que mantiene la evidencia legible. Se ve que había
sesión sin exponer la sesión. En `Authorization` se conserva el esquema
(`Bearer <REDACTED>`).

`--no-redact` lo desactiva. No lo uses en evidencia destinada a un informe.

## Opciones de `shot.mjs`

| Flag | Por defecto | Efecto |
|---|---|---|
| `--request <archivo>` | obligatorio | archivo de la petición |
| `--response <archivo>` | ninguno | archivo de la respuesta |
| `--out <archivo.png>` | obligatorio | PNG de salida |
| `--width <px>` | `2000` | ancho de la imagen |
| `--scale <n>` | `1` | factor de escala del dispositivo (usa `2` para retina) |
| `--max-height <px>` | `420` | altura máxima; por encima recorta con aviso. `0` lo desactiva |
| `--all-headers` | desactivado | muestra todas las cabeceras, no solo las esenciales |
| `--no-redact` | desactivado | desactiva la redacción de secretos |
| `--input <spec.json>` | ninguno | lee los parámetros de un JSON en vez de la línea de comandos |

Por defecto el renderizado solo muestra las cabeceras relevantes para el informe
(`Host`, `Content-Type`, `Cookie`, `Location`, `Origin`, `Referer`, entre otras)
y anota cuántas se omitieron. Los cuerpos de más de 300 líneas se truncan
indicando el total de líneas y bytes. En ambos casos el aviso queda visible en
la imagen, y el `.txt` crudo en `inbox/` conserva el contenido completo.

Formato de `--input`:

```json
{
  "request_file": "req.txt",
  "response_file": "resp.txt",
  "out": "evidencia.png",
  "width": 2000,
  "scale": 1,
  "redact": true
}
```

## Limitación conocida

La Montoya API 2025.5 no expone forma alguna de enumerar las pestañas abiertas
del Repeater ni de leer el estado actual de una pestaña. El paquete
`burp.api.montoya.repeater` solo ofrece `Repeater.sendToRepeater(...)`. Por eso
la captura está orientada a eventos, disparándose en cada *Send* real, en lugar
de ser una lectura pasiva del estado de las pestañas.

En la práctica eso resulta equivalente o mejor para generar evidencia, ya que no
hay retraso, pero implica que una pestaña redactada y nunca enviada solo se
captura mediante la opción manual del menú.

## Licencia

MIT. Consulta [LICENSE](LICENSE).
