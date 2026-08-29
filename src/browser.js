// ブラウザの起動を一箇所にまとめる。
// 付属のChromiumが起動できない環境(例: Windowsの side-by-side 構成エラー)では、
// パソコンに入っている Chrome / Edge に自動で切り替えて続行する。
import { chromium } from 'playwright';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { writeLog } from './logger.js';

// 一度見つけた代替ブラウザは覚えておき、以後は最初からそれを使う
let fallbackPath = null;

// パソコンに入っていそうなブラウザの場所(見つかった順に使う)
function systemBrowserCandidates() {
  if (process.platform === 'win32') {
    const roots = [
      process.env['PROGRAMFILES'],
      process.env['PROGRAMFILES(X86)'],
      process.env['LOCALAPPDATA'],
    ].filter(Boolean);
    const rels = [
      join('Google', 'Chrome', 'Application', 'chrome.exe'),
      join('Microsoft', 'Edge', 'Application', 'msedge.exe'),
    ];
    return roots.flatMap((root) => rels.map((rel) => join(root, rel)));
  }
  if (process.platform === 'darwin') {
    return [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    ];
  }
  return ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'];
}

function findSystemBrowser() {
  return systemBrowserCandidates().find((p) => existsSync(p)) ?? null;
}

// chromium.launch の代わりに使う。CHROMIUM_PATH 指定が最優先。
export async function launchBrowser(options = {}) {
  const envPath = process.env.CHROMIUM_PATH;
  if (envPath) return chromium.launch({ ...options, executablePath: envPath });
  if (fallbackPath) return chromium.launch({ ...options, executablePath: fallbackPath });
  try {
    return await chromium.launch(options);
  } catch (err) {
    const alt = findSystemBrowser();
    if (!alt) throw err;
    writeLog(
      `付属ブラウザの起動に失敗したため、代わりに ${alt} を使います。\n元のエラー: ${err.message?.split('\n')[0]}`,
      'warn'
    );
    const browser = await chromium.launch({ ...options, executablePath: alt });
    fallbackPath = alt; // 成功したときだけ覚える
    return browser;
  }
}
