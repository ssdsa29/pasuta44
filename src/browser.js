// ブラウザの起動を一箇所にまとめる。
//
// パソコンに入っている Google Chrome / Edge を優先して使います。
// 理由は2つ:
//   1) Playwright付属のChromiumが起動できない環境がある(Windowsの側の構成エラーなど)
//   2) 付属Chromiumは普段使いのブラウザと中身が違うため、Xのログイン画面で
//      「見慣れないブラウザ」として弾かれやすい
// あわせて、自動操作であることを示す目印(navigator.webdriver など)を消します。
// これは普段のブラウザに近い状態で自分のアカウントにログインするための調整で、
// 端末の指紋を偽装したり、認証を回避するものではありません。
import { chromium } from 'playwright';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { writeLog } from './logger.js';

// 起動できたブラウザの場所は覚えておき、次回から探し直さない
let resolvedPath = null;

// パソコンに入っていそうなブラウザの場所(前にあるものから優先して使う)
export function systemBrowserCandidates() {
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

// 自動操作の目印を消す起動オプションを足す
function withStealth(options = {}) {
  const args = [
    // navigator.webdriver を立てない(自動操作の一番わかりやすい目印)
    '--disable-blink-features=AutomationControlled',
    ...(options.args ?? []),
  ];
  return {
    ...options,
    args,
    // 「Chromeは自動テストソフトウェアによって制御されています」の表示と、
    // 自動化用の既定フラグを外す
    ignoreDefaultArgs: ['--enable-automation'],
  };
}

// chromium.launch の代わりに使う。CHROMIUM_PATH での指定が最優先。
export async function launchBrowser(options = {}) {
  const opts = withStealth(options);
  const envPath = process.env.CHROMIUM_PATH;
  if (envPath) return chromium.launch({ ...opts, executablePath: envPath });
  if (resolvedPath) return chromium.launch({ ...opts, executablePath: resolvedPath });

  // まずはパソコンのChrome/Edgeで起動を試す
  const system = findSystemBrowser();
  if (system) {
    try {
      const browser = await chromium.launch({ ...opts, executablePath: system });
      resolvedPath = system;
      return browser;
    } catch (err) {
      writeLog(
        `パソコンのブラウザ(${system})を起動できなかったため、付属のブラウザを使います。\n元のエラー: ${err.message?.split('\n')[0]}`,
        'warn'
      );
    }
  }
  // 見つからない/起動できないときは付属のChromiumを使う
  return chromium.launch(opts);
}
