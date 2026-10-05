#!/usr/bin/env node
import { existsSync, mkdtempSync, readFileSync, writeFileSync, rmSync, unlinkSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf('--' + n); return i > -1 ? argv[i + 1] : d; };
const flag = n => argv.includes('--' + n);

const fail = msg => { console.error('error: ' + msg); process.exit(1); };

let request = '', response = '', out = '', width = 2000, scale = 1;
let redactOn = !flag('no-redact');

const input = opt('input');
if (input) {
  const spec = JSON.parse(readFileSync(input, 'utf8'));
  request = spec.request ?? (spec.request_file ? readFileSync(spec.request_file, 'utf8') : '');
  response = spec.response ?? (spec.response_file ? readFileSync(spec.response_file, 'utf8') : '');
  out = spec.out || out;
  width = Number(spec.width) || width;
  scale = Number(spec.scale) || scale;
  if (spec.redact === false) redactOn = false;
} else {
  const rf = opt('request'), sf = opt('response');
  out = opt('out') || out;
  if (!rf || !out) {
    fail('usage: node shot.mjs --request req.txt --response resp.txt --out output.png [--width 2000] [--scale 1] [--no-redact]\n       or: node shot.mjs --input spec.json');
  }
  request = readFileSync(rf, 'utf8');
  if (sf) response = readFileSync(sf, 'utf8');
  width = Number(opt('width', 2000)) || 2000;
  scale = Number(opt('scale', 1)) || 1;
}
if (!out) fail('--out is required');
const maxHeight = Number(opt('max-height', 420)) || 420;

const SENSITIVE = /^(cookie|set-cookie|authorization|proxy-authorization|x-csrf-token|x-xsrf-token|x-auth-token)$/i;
function redactSecrets(text) {
  // Normalize CRLF first: real Burp captures come with \r\n and the regex below
  // uses (.*)$ -- '.' does not match \r, so redaction failed silently.
  return text.replace(/\r\n?/g, '\n').split('\n').map(line => {
    const m = line.match(/^([A-Za-z0-9-]+):[ \t]*(.*)$/);
    if (!m || !SENSITIVE.test(m[1])) return line;
    const name = m[1], value = m[2];
    if (/^(set-)?cookie$/i.test(name)) {
      return name + ': ' + value.split(';').map(p => {
        const i = p.indexOf('=');
        return i > -1 ? p.slice(0, i) + '=<REDACTED>' : p;
      }).join(';');
    }
    const sp = value.indexOf(' ');
    return name + ': ' + (sp > -1 ? value.slice(0, sp + 1) : '') + '<REDACTED>';
  }).join('\n');
}

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const ESSENTIAL_HEADERS = new Set([
  'host', 'accept', 'accept-language', 'content-type', 'content-length',
  'cookie', 'set-cookie', 'authorization', 'location', 'www-authenticate',
  'retry-after', 'allow', 'origin', 'referer', 'user-agent',
]);
const showAllHeaders = flag('all-headers');
const MAX_BODY_LINES = 300;

function headerName(line) {
  const m = line.match(/^([A-Za-z0-9-]+):/);
  return m ? m[1].toLowerCase() : null;
}

function headerLine(line) {
  const m = line.match(/^([A-Za-z0-9-]+):([ \t]*)(.*)$/);
  if (!m) return esc(line);
  const valCls = /^cookie$/i.test(m[1]) ? 'cval' : 'hval';
  return `<span class="hname">${esc(m[1])}</span>:<span class="${valCls}">${esc(m[2] + m[3])}</span>`;
}

function highlightJson(body) {
  return esc(body).replace(
    /("(?:\\.|[^"\\])*")([\t ]*:)?|\b(true|false|null)\b|(-?\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g,
    (m, str, colon, konst, num) => {
      if (str != null && colon != null) return `<span class="jkey">${str}</span>${colon}`;
      if (str != null) return `<span class="jstr">${str}</span>`;
      if (konst != null) return `<span class="jconst">${konst}</span>`;
      return `<span class="jnum">${num}</span>`;
    }
  );
}

function renderLines(raw, firstCls) {
  const lines = String(raw).replace(/\r\n?/g, '\n').split('\n');
  const outLines = [];
  let i = 0;
  if (lines.length && lines[0] !== '') {
    outLines.push(`<span class="${firstCls}">${esc(lines[0])}</span>`);
    i = 1;
  }
  const headerLines = [];
  for (; i < lines.length; i++) {
    if (lines[i].trim() === '') { i++; break; }
    headerLines.push(lines[i]);
  }
  let shown = headerLines;
  let omitted = 0;
  if (!showAllHeaders) {
    shown = headerLines.filter(l => ESSENTIAL_HEADERS.has(headerName(l)));
    omitted = headerLines.length - shown.length;
  }
  for (const l of shown) outLines.push(headerLine(l));
  if (omitted > 0) {
    outLines.push(`<span class="dim">&#8942; ${omitted} header(s) omitted -- use --all-headers to show them all</span>`);
  }
  outLines.push('');
  const body = lines.slice(i).join('\n');
  if (body.trim() !== '') {
    const isJson = /^\s*[\[{]/.test(body);
    const highlighted = (isJson ? highlightJson(body) : esc(body)).split('\n');
    if (highlighted.length > MAX_BODY_LINES) {
      const totalBytes = Buffer.byteLength(body, 'utf8');
      outLines.push(...highlighted.slice(0, MAX_BODY_LINES));
      outLines.push(`<span class="dim">&#8942; body truncated: ${MAX_BODY_LINES} of ${highlighted.length} lines (${totalBytes.toLocaleString('en-US')} bytes total) -- see the raw .request.txt/.response.txt for the full content</span>`);
    } else {
      outLines.push(...highlighted);
    }
  }
  return outLines;
}

const linesHtml = htmlLines => htmlLines
  .map((l, n) => `<div class="line"><span class="ln">${n + 1}</span><span class="code">${l === '' ? ' ' : l}</span></div>`)
  .join('');

const ICONS = `<svg width="20" height="20" viewBox="0 0 20 20"><rect x="1" y="1" width="18" height="18" rx="4" fill="#3b74c4"/><path d="M5 7h10M5 10h10M5 13h6" stroke="#eaf1fb" stroke-width="1.6" stroke-linecap="round"/></svg><svg width="20" height="20" viewBox="0 0 20 20"><path d="M3 6h14M3 10h14M3 14h9" stroke="#8a8a8a" stroke-width="1.6" stroke-linecap="round"/></svg>`;

const pane = (title, lines, isReq) => `
<section class="pane">
  <header class="pane-header"><h1 class="pane-title">${title}</h1></header>
  <div class="tabs">
    <span class="tab active">Pretty</span><span class="tab">Raw</span><span class="tab">Hex</span>${isReq ? '' : '<span class="tab disabled">Render</span>'}
    <div class="icons">${ICONS}</div>
  </div>
  <div class="content">${linesHtml(lines)}</div>
</section>`;

if (redactOn) {
  request = redactSecrets(request);
  response = redactSecrets(response);
}

const reqLines = request.trim() === '' ? ['<span class="dim">(no request)</span>'] : renderLines(request, 'reqline');
const respLines = response.trim() === '' ? ['<span class="dim">(no response captured)</span>'] : renderLines(response, 'statusline');

const maxLines = Math.max(reqLines.length, respLines.length, 1);
const height = Math.min(Math.max(420, 124 + maxLines * 24), 10000);

const html = `<!doctype html>
<html><head><meta charset="utf-8"><style>
* { box-sizing: border-box; margin: 0; padding: 0; }
html, body { background: #1e1e1e; height: 100%; }
/* min-height makes the panes fill the whole image: without it, short content
   left a dark strip of the page background at the bottom. */
.wrap { display: flex; gap: 8px; min-height: 100vh; align-items: stretch; }
.pane { flex: 1 1 50%; min-width: 0; background: #2b2b2b; display: flex; flex-direction: column; }
.pane-title { color: #eaeaea; font: 700 15px/1.4 -apple-system, "SF Pro Text", "Helvetica Neue", sans-serif; padding: 14px 16px 2px; }
.tabs { display: flex; align-items: center; gap: 18px; padding: 6px 16px 8px; border-bottom: 1px solid #383838; }
.tab { font: 400 13.5px/1 -apple-system, "SF Pro Text", "Helvetica Neue", sans-serif; color: #9a9a9a; }
.tab.active { color: #d7c07a; }
.tab.disabled { color: #5f5f5f; }
.icons { margin-left: auto; display: flex; align-items: center; gap: 10px; }
.content { font: 13.5px/24px ui-monospace, "SF Mono", Menlo, Monaco, Consolas, monospace; padding: 6px 0 18px; white-space: pre-wrap; overflow-wrap: anywhere; }
.line { display: flex; }
.ln { flex: 0 0 34px; text-align: right; padding-right: 10px; color: #6e7681; }
.code { flex: 1 1 auto; white-space: pre-wrap; overflow-wrap: anywhere; padding-right: 14px; color: #d4d4d4; }
.reqline { color: #e06c5a; }
.statusline { color: #d4d4d4; }
.hname { color: #98c379; }
.hval { color: #d4d4d4; }
.cval { color: #d7ba7d; }
.jkey { color: #9cdcfe; }
.jstr { color: #98c379; }
.jnum { color: #d19a66; }
.jconst { color: #569cd6; }
.dim { color: #8a8a8a; font-style: italic; }
</style></head><body>
<div class="wrap">
${pane('Request', reqLines, true)}
${pane('Response', respLines, false)}
</div>
</body></html>`;

const outAbs = resolve(out);
const htmlAbs = outAbs.replace(/\.png$/i, '') + '.html';
writeFileSync(htmlAbs, html);

const CHROMIUM = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/Applications/Vivaldi.app/Contents/MacOS/Vivaldi',
  '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
].find(existsSync);
const BRAVE = '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser';
const FIREFOX = '/Applications/Firefox.app/Contents/MacOS/firefox';
const profile = mkdtempSync(join(tmpdir(), 'burp-shot-'));
const ffProfile = mkdtempSync(join(tmpdir(), 'burp-shot-ff-'));

// Temporary browser profiles leaked ~6MB per render (1.5GB piled up).
process.on('exit', () => {
  for (const dir of [profile, ffProfile]) {
    try { rmSync(dir, { recursive: true, force: true }); } catch {}
  }
});
const url = pathToFileURL(htmlAbs).href;

function run(cmd, args, ms = 25000) {
  try { execFileSync(cmd, args, { stdio: 'ignore', timeout: ms }); } catch {}
  return existsSync(outAbs);
}

const chromiumArgs = [
  '--disable-gpu', '--hide-scrollbars', '--no-first-run', '--no-default-browser-check',
  `--user-data-dir=${profile}`, `--force-device-scale-factor=${scale}`, '--force-color-profile=srgb',
  `--window-size=${width},${Math.round(height)}`, `--screenshot=${outAbs}`,
  '--virtual-time-budget=1500', url,
];

let done = false;
if (CHROMIUM) {
  done = run(CHROMIUM, ['--headless=new', ...chromiumArgs]) || run(CHROMIUM, ['--headless', ...chromiumArgs]);
}
if (!done && existsSync(FIREFOX)) {
  done = run(FIREFOX, ['--headless', '--no-remote', '--profile', ffProfile, '--window-size', `${width},${Math.round(height)}`, '--screenshot', outAbs, url], 45000);
}
if (!done && existsSync(BRAVE)) {
  done = run(BRAVE, ['--headless=new', ...chromiumArgs], 15000) || run(BRAVE, ['--headless', ...chromiumArgs], 15000);
}
if (!done) fail('no browser managed to produce the screenshot (Chromium and Firefox both failed). HTML left at ' + htmlAbs);

if (maxHeight > 0) {
  try {
    const scriptDir = fileURLToPath(new URL('.', import.meta.url));
    execFileSync('python3', [join(scriptDir, 'crop.py'), outAbs, String(Math.round(maxHeight * scale))], { stdio: 'ignore', timeout: 15000 });
  } catch (e) {
    console.error('warning: height crop failed (' + (e && e.message) + '), the PNG kept its rendered size.');
  }
}

// The .html is only a debug artifact for when the render fails.
try { unlinkSync(htmlAbs); } catch {}

console.log(`ok -> ${outAbs}`);
