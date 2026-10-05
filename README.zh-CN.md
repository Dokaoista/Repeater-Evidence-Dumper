# Repeater Evidence Dumper

[English](README.md) · [Português (BR)](README.pt-BR.md) · [Español](README.es.md) · **简体中文** · [Русский](README.ru.md) · [Français](README.fr.md) · [Deutsch](README.de.md) · [日本語](README.ja.md)

一个 Burp Suite 扩展，把 Repeater 里的每一次 *Send* 变成可以直接放进报告的证据截图，
外观与 Burp 界面一致，并且敏感信息已经打码。

![输出示例](samples/demo.png)

为漏洞赏金或渗透测试报告留证据通常是纯手工活：截 Burp 的窗口、裁剪、把 Cookie 涂掉，
每个请求都要重来一遍。这个工具把整个流程自动化。你在 Repeater 里发送请求，PNG 就出来了。

## 工作原理

三个部分，通过一个目录串起来：

```
Burp Repeater ──(每次 Send)──▶ ~/burp-evidence/inbox/*.request.txt
                                                    *.response.txt
                                       │
                          watch.sh (3 秒轮询)
                                       │
                                  shot.mjs  ──▶ 仿 Burp 主题的 HTML
                                       │        └▶ 无头浏览器 (--screenshot)
                                       │             └▶ crop.py (裁剪 + 提示)
                                       ▼
                               ~/burp-evidence/out/*.png
```

1. **`extension/`** 是 Java 扩展（Montoya API）。它注册一个 `HttpHandler`，把所有来自
   Repeater 的请求/响应对以纯文本写入磁盘。
2. **`watch.sh`** 监视 `inbox/` 并渲染每一个新的配对。它绝不覆盖已存在的 PNG（视为已经
   审阅过），并把失败记录在 `.failed/` 里，避免反复重试。
3. **`shot.mjs`** 生成一个复刻 Burp 外观的 HTML 页面（Request 与 Response 两栏、行号、
   JSON 语法高亮），再用无头浏览器截图。`crop.py` 限制高度，并加上一条提示栏，使裁剪
   永远不会悄无声息地发生。

## 环境要求

| 组件 | 用途 |
|---|---|
| Burp Suite（Montoya API 2025.5） | 运行扩展 |
| Java 17+ | 编译扩展 |
| Node.js | 运行 `shot.mjs`（无外部依赖） |
| Python 3 + [Pillow](https://pypi.org/project/Pillow/) | 运行 `crop.py`（高度裁剪） |
| Chrome/Chromium/Edge/Vivaldi、Firefox 或 Brave | 渲染截图 |

渲染器按上述顺序尝试这些浏览器，使用第一个可用的。脚本里的路径是 macOS 的。在其他操作
系统上，请修改 `shot.mjs` 顶部的 `CHROMIUM`、`FIREFOX` 和 `BRAVE` 常量。

## 编译

```bash
cd extension
./gradlew build
```

生成的 jar 位于 `extension/build/libs/repeater-evidence-dumper.jar`。Montoya API 声明为
`compileOnly`，运行时由 Burp 自己的 classloader 提供，因此不会被打进 jar 里。

不想自己编译？可以直接从 [Releases](../../releases) 页面下载编译好的 jar。

## 安装

1. **Burp** → *Extensions* → *Add* → 类型选 *Java* → 选择该 jar。
   日志里应当出现 `Repeater Evidence Dumper carregado`。
2. 把三个脚本复制到运行目录：

```bash
mkdir -p ~/burp-evidence && cp shot.mjs crop.py watch.sh ~/burp-evidence/
```

3. 启动监视器：

```bash
cd ~/burp-evidence && ./watch.sh &
```

> `~/burp-evidence/` 这个路径是写死的：扩展写入 `$HOME/burp-evidence/inbox`，而
> `watch.sh` 期望 `shot.mjs` 就在它旁边。要修改的话，请改 Java 源码里的 `INBOX` 常量和
> `watch.sh` 里的 `HOME_DIR`。

## 使用

**自动。** Repeater 中的任何一次 *Send* 都会写出配对文件，监视器随即渲染到
`~/burp-evidence/out/`，文件名由消息 id、方法和路径组成：

```
00042-post-api-usuarios.png
```

**手动。** 在 Repeater 标签页的请求/响应编辑器里点右键，选择
**"Dump Repeater tab now (evidence)"**。适用于标签页尚未发送的情况（此时只会抓到请求），
或者需要临时抓一张图的时候。这类文件名为 `manual-00001-...`。

**独立运行。** 渲染器可以单独对任意一对文件使用：

```bash
node shot.mjs --request req.txt --response resp.txt --out evidence.png
```

## 敏感信息打码

默认开启。以下请求头的值在任何渲染之前都会被替换为 `<REDACTED>`：

`Cookie` · `Set-Cookie` · `Authorization` · `Proxy-Authorization` ·
`X-CSRF-Token` · `X-XSRF-Token` · `X-Auth-Token`

Cookie 会保留每一对的**名称**，只对值打码（`app.sid=<REDACTED>`），这样证据仍然可读。
既能看出当时存在会话，又不会把会话本身暴露出去。对 `Authorization`，认证方案会被保留
（`Bearer <REDACTED>`）。

`--no-redact` 可以关闭它。要放进报告的证据请不要使用该选项。

## `shot.mjs` 选项

| 参数 | 默认值 | 作用 |
|---|---|---|
| `--request <文件>` | 必填 | 请求文件 |
| `--response <文件>` | 无 | 响应文件 |
| `--out <文件.png>` | 必填 | 输出的 PNG |
| `--width <px>` | `2000` | 图片宽度 |
| `--scale <n>` | `1` | 设备缩放比例（Retina 用 `2`） |
| `--max-height <px>` | `420` | 最大高度；超出则裁剪并加提示。`0` 表示关闭 |
| `--all-headers` | 关闭 | 显示全部请求头，而不只是关键的那些 |
| `--no-redact` | 关闭 | 关闭敏感信息打码 |
| `--input <spec.json>` | 无 | 从 JSON 文件读取参数，而不是命令行 |

默认渲染只显示对报告有意义的请求头（`Host`、`Content-Type`、`Cookie`、`Location`、
`Origin`、`Referer` 等），并注明省略了多少个。超过 300 行的 body 会被截断，并标出总行数
和字节数。这两种情况下提示都会显示在图片里，而 `inbox/` 中的原始 `.txt` 仍保留完整内容。

`--input` 的格式：

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

## 已知限制

Montoya API 2025.5 没有提供枚举已打开的 Repeater 标签页、或读取某个标签页当前状态的方法。
`burp.api.montoya.repeater` 包里只有 `Repeater.sendToRepeater(...)`。因此本工具采用事件
驱动的抓取方式，在每一次真实的 *Send* 时触发，而不是被动读取标签页状态。

就生成证据这个目的而言，实际效果相当甚至更好，因为完全没有延迟。但这也意味着，一个已经
写好却从未发送过的标签页，只能通过手动菜单项来抓取。

## 许可证

MIT。详见 [LICENSE](LICENSE)。
