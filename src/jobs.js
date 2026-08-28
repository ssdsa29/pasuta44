// 画面(GUI)に進捗を届けるための実行管理。
// 同時に走る処理は1つだけにして、途中経過をログとして配信します。
import { requestCancel, resetCancel, isCancelled } from './cancel.js';
import { cleanError } from './resilience.js';
import { writeLog } from './logger.js';

const MAX_LOG_LINES = 500;

const state = {
  running: false,
  name: null,
  startedAt: null,
  logs: [],
  result: null,
  error: null,
};

const listeners = new Set();

// 画面へ1行送る
function emit(type, payload) {
  const event = { type, ...payload, at: Date.now() };
  if (type === 'log') {
    state.logs.push(event);
    if (state.logs.length > MAX_LOG_LINES) state.logs.shift();
    // 注意・エラーは、あとから確認できるようファイルにも残す
    if (payload.level === 'warn' || payload.level === 'error') writeLog(payload.text, payload.level);
  }
  for (const send of listeners) {
    try {
      send(event);
    } catch {
      // 切断済みの相手は無視(subscribe の解除側で片付く)
    }
  }
}

export function subscribe(send) {
  listeners.add(send);
  return () => listeners.delete(send);
}

export function getState() {
  return {
    running: state.running,
    name: state.name,
    startedAt: state.startedAt,
    logs: state.logs,
    result: state.result,
    error: state.error,
    cancelled: isCancelled(),
  };
}

export function log(text, level = 'info') {
  emit('log', { text: String(text), level });
}

export function cancelJob() {
  if (!state.running) return false;
  requestCancel();
  log('中止を要求しました。安全なところまで進めてから止まります...', 'warn');
  return true;
}

// console の出力を画面にも流す(既存の処理に手を入れずに進捗を見せるため)
function captureConsole() {
  const original = { log: console.log, warn: console.warn, error: console.error };
  const forward = (level, orig) => (...args) => {
    orig(...args);
    const text = args
      .map((a) => (typeof a === 'string' ? a : JSON.stringify(a)))
      .join(' ')
      .replace(/\r/g, '')
      .trimEnd();
    if (text) emit('log', { text, level });
  };
  console.log = forward('info', original.log);
  console.warn = forward('warn', original.warn);
  console.error = forward('error', original.error);
  return () => Object.assign(console, original);
}

// 1つの処理を実行する。すでに実行中なら断る。
export async function runJob(name, fn) {
  if (state.running) {
    throw new Error('ほかの処理を実行中です。終わるまでお待ちください。');
  }
  state.running = true;
  state.name = name;
  state.startedAt = Date.now();
  state.logs = [];
  state.result = null;
  state.error = null;
  resetCancel();
  writeLog(`${name} を開始しました`);
  emit('start', { name });

  const restore = captureConsole();
  try {
    const result = await fn();
    state.result = result ?? null;
    writeLog(`${name} が${isCancelled() ? '中止されました' : '完了しました'}`);
    emit('done', { name, result: state.result, cancelled: isCancelled() });
    return result;
  } catch (err) {
    state.error = cleanError(err);
    writeLog(`${name} が失敗しました: ${err?.stack || err}`, 'error');
    emit('failed', { name, error: state.error });
    throw err;
  } finally {
    restore();
    state.running = false;
    resetCancel();
  }
}
