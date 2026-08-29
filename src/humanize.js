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

// 1回の「ひと転がし」。指を弾いたときのように、加速してから減速する。
// distance ぶんを細かく分けて送るので、画面上は滑らかに流れる。
async function smoothWheel(page, distance, { stepMs = 16 } = {}) {
  const dir = Math.sign(distance) || 1;
  const total = Math.abs(distance);
  // 細かく送るほど滑らか。1ステップ 12〜28px 目安で分割する。
  const steps = Math.max(4, Math.round(total / randInt(12, 28)));
  let sent = 0;
  for (let i = 1; i <= steps; i++) {
    // 進み具合(0→1)に対して、最初ゆっくり→速く→最後ゆっくり(イーズインアウト)
    const p = i / steps;
    const eased = p < 0.5 ? 2 * p * p : 1 - 2 * (1 - p) * (1 - p);
    const target = Math.round(total * eased);
    let delta = target - sent;
    if (delta <= 0) continue;
    // 一定にならないよう、1回ごとに少しだけばらつかせる
    delta = Math.max(1, Math.round(delta * (0.85 + Math.random() * 0.3)));
    await page.mouse.wheel(0, dir * delta);
    sent += delta;
    await sleep(Math.round(stepMs * (0.7 + Math.random() * 0.8)));
  }
}

// 人間らしいスクロール。滑らかに流し、たまに読み返し、止まって読む。
// 動きの大きさ・回数・止まる長さは CONFIG.scrollVariance(振れ幅)で調整できる。
// 0 に近いほど一定のリズム、大きいほど気まぐれになる。
export async function humanScroll(page, viewport = { width: 1280, height: 900 }) {
  const v = Math.min(2, Math.max(0, CONFIG.scrollVariance ?? 1));
  // 振れ幅に応じて範囲を広げる(v=0 なら中央値のみ、v=1 が標準)
  const spread = (center, width) => {
    const w = width * v;
    return randInt(Math.round(center - w), Math.round(center + w));
  };

  const bursts = Math.max(1, spread(3, 2)); // ひと転がしを何回するか
  for (let i = 0; i < bursts; i++) {
    const distance = Math.max(80, spread(420, 260));
    await smoothWheel(page, distance);

    // 転がしの合間の短い止まり(指を離している時間)
    await paceSleep(Math.max(60, spread(260, 220)));

    // ときどき読み返しで少し上に戻る
    if (Math.random() < 0.18 * (0.5 + v / 2)) {
      await smoothWheel(page, -Math.max(60, spread(200, 140)));
      await paceSleep(Math.max(150, spread(500, 350)));
    }
  }

  // ときどきマウスを動かす
  if (Math.random() < 0.5) await humanMouseMove(page, viewport);

  // コンテンツを読んでいる間の停止。たまにじっくり読む。
  const readMs = Math.max(200, spread(1400, 900));
  await paceSleep(Math.random() < 0.15 * (0.5 + v / 2) ? readMs + randInt(1500, 4000) : readMs);
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
