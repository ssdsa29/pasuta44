// スクレイピング検知(BAN)を避けるため、人間に近い操作を行うヘルパー群。
// ランダムな待機・少しずつのスクロール・たまに戻る・マウス移動・1文字ずつのタイプ入力など。
// 待機時間はすべて CONFIG.speedFactor 倍されます(設定メニューの「動作の速さ」)。
import { CONFIG } from './config.js';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 設定の「動作の速さ」を反映した待機
const scaled = (ms) => Math.round(ms * (CONFIG.speedFactor ?? 1));
export const paceSleep = (ms) => sleep(scaled(ms));

// min〜max の乱数(整数)
export function randInt(min, max) {
  return Math.floor(min + Math.random() * (max - min + 1));
}

// 目安ミリ秒を中心に±40%ばらつかせて待つ(アカウント間・詳細ページ間の「間」用)。
// 待ち時間は「動作の速さ」倍率も反映する。0 以下なら待たない。
export async function jitterSleep(ms) {
  const base = Number(ms) || 0;
  if (base <= 0) return;
  await paceSleep(randInt(Math.round(base * 0.6), Math.round(base * 1.4)));
}

// 人間らしい短い間(既定 0.4〜1.6秒)。ときどき長めに考え込む。
export async function humanPause(minMs = 400, maxMs = 1600) {
  let ms = randInt(minMs, maxMs);
  if (Math.random() < 0.15) ms += randInt(800, 2500); // たまに長考
  await sleep(scaled(ms));
}

// マウスを画面内のランダムな位置へ、複数ステップで滑らかに動かす
export async function humanMouseMove(page, viewport = { width: 1280, height: 900 }) {
  try {
    const x = randInt(50, viewport.width - 50);
    const y = randInt(80, viewport.height - 80);
    await page.mouse.move(x, y, { steps: randInt(5, 20) });
  } catch {
    // マウス操作に失敗しても収集は続行
  }
}

// 人間らしいスクロール。小刻みに下へ動かし、たまに少し戻り、合間に止まって読む。
export async function humanScroll(page, viewport = { width: 1280, height: 900 }) {
  const steps = randInt(3, 6);
  for (let i = 0; i < steps; i++) {
    const delta = randInt(250, 600);
    await page.mouse.wheel(0, delta);
    await paceSleep(randInt(150, 450));
  }

  // たまに少し上に戻る(読み返す動き)
  if (Math.random() < 0.2) {
    await page.mouse.wheel(0, -randInt(150, 350));
    await paceSleep(randInt(300, 800));
  }

  // ときどきマウスを動かす
  if (Math.random() < 0.5) await humanMouseMove(page, viewport);

  // コンテンツを読んでいる間の停止
  await humanPause(700, 2200);
}

// 入力欄に1文字ずつ、ばらついた速度でタイプする(自動入力っぽさを消す)
export async function humanType(page, selector, text) {
  await page.click(selector);
  await humanPause(200, 600);
  for (const ch of text) {
    await page.keyboard.type(ch);
    await paceSleep(randInt(60, 180));
    if (Math.random() < 0.05) await paceSleep(randInt(200, 500)); // たまに手が止まる
  }
  await humanPause(300, 800);
}
