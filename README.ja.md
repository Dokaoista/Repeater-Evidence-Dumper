# Repeater Evidence Dumper

[English](README.md) · [Português (BR)](README.pt-BR.md) · [Español](README.es.md) · [简体中文](README.zh-CN.md) · [Русский](README.ru.md) · [Français](README.fr.md) · [Deutsch](README.de.md) · **日本語**

Repeater の *Send* ごとに、レポートへそのまま貼れる証跡スクリーンショットを生成する
Burp Suite 拡張です。見た目は Burp の UI に揃えてあり、機密情報は最初から伏せられます。

![出力例](samples/demo.png)

バグバウンティやペネトレーションテストのレポート用に証跡を残す作業は、普通は手作業です。
Burp のウィンドウをスクリーンショットし、切り取り、Cookie をぼかし、リクエストごとに同じ
ことを繰り返す。この拡張はその一連の流れを自動化します。Repeater でリクエストを送れば、
PNG ができあがります。

## しくみ

3 つの部品が、1 つのディレクトリを介してつながっています。

```
Burp Repeater ──(Send のたび)──▶ ~/burp-evidence/inbox/*.request.txt
                                                      *.response.txt
                                         │
                            watch.sh (3秒ごとのポーリング)
                                         │
                                    shot.mjs  ──▶ Burp 風テーマの HTML
                                         │        └▶ ヘッドレスブラウザ (--screenshot)
                                         │             └▶ crop.py (切り詰め + 注記)
                                         ▼
                                 ~/burp-evidence/out/*.png
```

1. **`extension/`** が Java 拡張（Montoya API）です。`HttpHandler` を登録し、Repeater
   を起点とするリクエスト／レスポンスの組をすべて生テキストで書き出します。
2. **`watch.sh`** は `inbox/` を監視し、新しい組をそのつどレンダリングします。既存の
   PNG は確認済みとみなして決して上書きせず、失敗は `.failed/` に記録して無限に再試行
   しないようにします。
3. **`shot.mjs`** は Burp の見た目を再現した HTML（Request と Response のペイン、行番号、
   JSON のシンタックスハイライト）を組み立て、ヘッドレスブラウザで撮影します。`crop.py`
   が高さに上限を設け、注記バーを添えることで、切り詰めが黙って起きないようにしています。

## 必要なもの

| 構成要素 | 用途 |
|---|---|
| Burp Suite（Montoya API 2025.5） | 拡張の実行 |
| Java 17+ | 拡張のビルド |
| Node.js | `shot.mjs` の実行（外部依存なし） |
| Python 3 + [Pillow](https://pypi.org/project/Pillow/) | `crop.py`（高さの切り詰め） |
| Chrome/Chromium/Edge/Vivaldi、Firefox、Brave のいずれか | スクリーンショットの描画 |

レンダラーはこの順にブラウザを試し、最初に動いたものを使います。パスは macOS のものです。
他の OS では `shot.mjs` 冒頭の `CHROMIUM`、`FIREFOX`、`BRAVE` 定数を書き換えてください。

## ビルド

```bash
cd extension
./gradlew build
```

jar は `extension/build/libs/repeater-evidence-dumper.jar` に出力されます。Montoya API は
`compileOnly` として宣言しているため、実行時には Burp 自身のクラスローダーが提供し、jar
には同梱されません。

ビルドしたくない場合は、[Releases](../../releases) ページからビルド済みの jar を
取得してください。

## インストール

1. **Burp** → *Extensions* → *Add* → 種別 *Java* → 当該の jar を選択します。
   ログに `Repeater Evidence Dumper loaded` と表示されるはずです。
2. 3 つのスクリプトを実行用ディレクトリにコピーします。

```bash
mkdir -p ~/burp-evidence && cp shot.mjs crop.py watch.sh ~/burp-evidence/
```

3. ウォッチャーを起動します。

```bash
cd ~/burp-evidence && ./watch.sh &
```

> `~/burp-evidence/` というパスは固定です。拡張は `$HOME/burp-evidence/inbox` に書き込み、
> `watch.sh` は同じ場所に `shot.mjs` があることを前提にしています。変更する場合は Java
> 側の `INBOX` 定数と `watch.sh` の `HOME_DIR` を書き換えてください。

## 使い方

**自動。** Repeater での *Send* はすべて組として書き出され、ウォッチャーが
`~/burp-evidence/out/` にレンダリングします。ファイル名はメッセージ id、メソッド、パス
から作られます。

```
00042-post-api-activity-categories.png
```

**手動。** Repeater タブのリクエスト／レスポンスエディタ内で右クリックし、
**"Dump Repeater tab now (evidence)"** を選びます。タブをまだ送信していない場合
（このときはリクエストだけが保存されます）や、その場で一枚だけ撮りたいときに便利です。
これらは `manual-00001-...` という名前になります。

**単体実行。** レンダラーは任意のファイルの組に対して単独でも動きます。

```bash
node shot.mjs --request req.txt --response resp.txt --out evidence.png
```

## 機密情報の伏字化

既定で有効です。以下のヘッダーは、描画される前に値が `<REDACTED>` に置き換えられます。

`Cookie` · `Set-Cookie` · `Authorization` · `Proxy-Authorization` ·
`X-CSRF-Token` · `X-XSRF-Token` · `X-Auth-Token`

Cookie は各組の**名前**を残し、値だけを伏せます（`app.sid=<REDACTED>`）。そのため証跡は
読めるままです。セッションが存在したことは分かり、セッションそのものは露出しません。
`Authorization` では認証スキームが保持されます（`Bearer <REDACTED>`）。

`--no-redact` で無効にできます。レポートに載せる証跡には使わないでください。

## `shot.mjs` のオプション

| フラグ | 既定値 | 効果 |
|---|---|---|
| `--request <ファイル>` | 必須 | リクエストのファイル |
| `--response <ファイル>` | なし | レスポンスのファイル |
| `--out <ファイル.png>` | 必須 | 出力する PNG |
| `--width <px>` | `2000` | 画像の幅 |
| `--scale <n>` | `1` | デバイスの拡大率（Retina なら `2`） |
| `--max-height <px>` | `420` | 高さの上限。超えた分は注記付きで切り詰め。`0` で無効 |
| `--all-headers` | 無効 | 主要なものだけでなく全ヘッダーを表示 |
| `--no-redact` | 無効 | 機密情報の伏字化を無効化 |
| `--input <spec.json>` | なし | コマンドラインではなく JSON からパラメータを読む |

既定では、レポートに関係するヘッダー（`Host`、`Content-Type`、`Cookie`、`Location`、
`Origin`、`Referer` など）だけを表示し、いくつ省略したかを注記します。300 行を超える
ボディは、総行数とバイト数を添えて切り詰められます。どちらの場合も注記は画像内に残り、
`inbox/` にある生の `.txt` には全文がそのまま保存されています。

`--input` の形式は次のとおりです。

```json
{
  "request_file": "req.txt",
  "response_file": "resp.txt",
  "out": "evidence.png",
  "width": 2000,
  "scale": 1,
  "redact": true
}
```

## 既知の制約

Montoya API 2025.5 には、開いている Repeater タブを列挙する手段も、タブの現在の状態を
読む手段もありません。`burp.api.montoya.repeater` パッケージにあるのは
`Repeater.sendToRepeater(...)` だけです。そのため取得はイベント駆動で、実際の *Send* の
たびに発火します。タブの状態を受動的に読んでいるわけではありません。

証跡を生成するという目的に対しては、遅延がない分、実質的に同等かむしろ有利です。ただし、
組み立てただけで一度も送信していないタブは、手動のメニュー項目からしか取得できません。

## ライセンス

MIT。[LICENSE](LICENSE) を参照してください。
