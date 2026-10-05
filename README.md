# Repeater Evidence Dumper

Extensão do Burp Suite que transforma cada *Send* do Repeater em um screenshot de
evidência pronto para report — com a cara da interface do Burp e com os segredos
já redigidos.

![Exemplo de saída](samples/demo.png)

Capturar evidência para um report de bug bounty ou pentest normalmente é manual:
dar print da tela do Burp, recortar, borrar o cookie, repetir para cada request.
Isso automatiza o ciclo inteiro — você só envia a request no Repeater, o PNG
aparece.

## Como funciona

Três peças, ligadas por um diretório:

```
Burp Repeater ──(cada Send)──▶ ~/burp-evidence/inbox/*.request.txt
                                                    *.response.txt
                                       │
                        watch.sh (polling de 3s)
                                       │
                                  shot.mjs  ──▶ HTML com o tema do Burp
                                       │        └▶ browser headless (--screenshot)
                                       │             └▶ crop.py (recorte + aviso)
                                       ▼
                               ~/burp-evidence/out/*.png
```

1. **`extension/`** — extensão Java (Montoya API). Registra um `HttpHandler` que
   grava, em texto cru, todo par request/response originado no Repeater.
2. **`watch.sh`** — observa o `inbox/` e renderiza cada par novo. Nunca
   sobrescreve um PNG existente (presume-se revisado) e marca falhas em
   `.failed/` para não ficar tentando em loop.
3. **`shot.mjs`** — monta um HTML que replica o visual do Burp (painéis Request /
   Response, numeração de linha, syntax highlight de JSON) e fotografa com um
   browser headless. `crop.py` limita a altura, adicionando uma faixa de aviso
   para que o corte nunca seja silencioso.

## Requisitos

| Componente | Necessário para |
|---|---|
| Burp Suite (Montoya API 2025.5) | a extensão |
| Java 17+ | compilar a extensão |
| Node.js | `shot.mjs` (sem dependências externas) |
| Python 3 + [Pillow](https://pypi.org/project/Pillow/) | `crop.py` (recorte de altura) |
| Chrome/Chromium/Edge/Vivaldi, Firefox ou Brave | renderizar o screenshot |

O renderizador tenta os browsers nessa ordem e usa o primeiro que funcionar.
Os caminhos são de macOS — em outro SO, ajuste as constantes `CHROMIUM`,
`FIREFOX` e `BRAVE` no topo do `shot.mjs`.

## Build

```bash
cd extension
./gradlew build
```

O jar sai em `extension/build/libs/repeater-evidence-dumper.jar`. A Montoya API
entra como `compileOnly` — quem fornece em runtime é o classloader do Burp, então
ela não vai no jar.

## Instalação

1. **Burp** → *Extensions* → *Add* → tipo *Java* → selecione o jar.
   O log deve mostrar `Repeater Evidence Dumper carregado`.
2. Copie os três scripts para o diretório de runtime:

```bash
mkdir -p ~/burp-evidence && cp shot.mjs crop.py watch.sh ~/burp-evidence/
```

3. Suba o watcher:

```bash
cd ~/burp-evidence && ./watch.sh &
```

> O caminho `~/burp-evidence/` é fixo: a extensão grava em
> `$HOME/burp-evidence/inbox` e o `watch.sh` espera o `shot.mjs` ao lado dele.
> Para mudar, edite a constante `INBOX` no Java e `HOME_DIR` no `watch.sh`.

## Uso

**Automático** — qualquer *Send* no Repeater grava o par e o watcher renderiza
em `~/burp-evidence/out/`, nomeado pelo id da mensagem, método e path:

```
00042-post-api-usuarios.png
```

**Manual** — botão direito dentro do editor de request/response de uma aba do
Repeater → **"Dump Repeater tab now (evidence)"**. Útil quando a aba ainda não
foi enviada (grava só o request) ou para forçar uma captura pontual. Esses saem
como `manual-00001-...`.

**Avulso** — o renderizador roda sozinho sobre qualquer par de arquivos:

```bash
node shot.mjs --request req.txt --response resp.txt --out evidencia.png
```

## Redação de segredos

Ligada por padrão. Os headers abaixo têm o valor substituído por `<REDACTED>`
antes de qualquer renderização:

`Cookie` · `Set-Cookie` · `Authorization` · `Proxy-Authorization` ·
`X-CSRF-Token` · `X-XSRF-Token` · `X-Auth-Token`

Cookies preservam o **nome** de cada par e redigem só o valor
(`app.sid=<REDACTED>`), o que mantém a evidência legível — dá para ver que havia
sessão sem expor a sessão. Em `Authorization`, o esquema é preservado
(`Bearer <REDACTED>`).

`--no-redact` desliga. Não use em evidência que vai para um report.

## Opções do `shot.mjs`

| Flag | Padrão | Efeito |
|---|---|---|
| `--request <arquivo>` | — | arquivo do request (obrigatório) |
| `--response <arquivo>` | — | arquivo do response |
| `--out <arquivo.png>` | — | PNG de saída (obrigatório) |
| `--width <px>` | `2000` | largura da imagem |
| `--scale <n>` | `1` | fator de escala do device (use `2` para retina) |
| `--max-height <px>` | `420` | altura máxima; acima disso recorta com aviso. `0` desliga |
| `--all-headers` | desligado | mostra todos os headers, não só os essenciais |
| `--no-redact` | desligado | desliga a redação de segredos |
| `--input <spec.json>` | — | lê os parâmetros de um JSON em vez da linha de comando |

Por padrão a renderização só mostra headers relevantes para o report (`Host`,
`Content-Type`, `Cookie`, `Location`, `Origin`, `Referer`, entre outros) e
anota quantos foram omitidos. Bodies acima de 300 linhas são truncados com a
contagem total de linhas e bytes. Nos dois casos o aviso fica visível na imagem —
o `.txt` cru no `inbox/` continua com o conteúdo completo.

Formato do `--input`:

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

## Limitação conhecida

A Montoya API 2025.5 não expõe um jeito de enumerar as abas abertas do Repeater
nem de ler o estado atual de uma aba — o pacote `burp.api.montoya.repeater` só
tem `Repeater.sendToRepeater(...)`. Por isso a captura é orientada a evento
(dispara a cada *Send* real) e não uma leitura passiva do estado das abas.

Na prática isso é equivalente ou melhor para o objetivo de gerar evidência
(zero atraso), mas significa que uma aba montada e nunca enviada só é capturada
pelo item de menu manual.

## Licença

MIT — veja [LICENSE](LICENSE).
