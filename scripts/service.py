#!/usr/bin/env python3
r"""ComfyUI サーバーの起動・停止・状態確認をまとめて扱う。

使い方:
    python scripts/service.py start    # 起動して応答するまで待つ
    python scripts/service.py stop     # 実行中の処理を確認してから停止
    python scripts/service.py restart
    python scripts/service.py status

start.bat / stop.bat から呼ばれる。
"""

import argparse
import json
import os
import subprocess
import sys
import time
import urllib.request

if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

os.chdir(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

SERVER = os.environ.get("COMFYUI_SERVER", "http://127.0.0.1:8188")
COMFY_DIR = r"C:\claud\ComfyUI_windows_portable"
COMFY_PY = os.path.join(COMFY_DIR, "python_embeded", "python.exe")
COMFY_MAIN = os.path.join(COMFY_DIR, "ComfyUI", "main.py")


def api(path, timeout=3):
    try:
        with urllib.request.urlopen(SERVER + path, timeout=timeout) as r:
            return json.loads(r.read())
    except Exception:
        return None


def is_up():
    return api("/system_stats") is not None


def queue_state():
    q = api("/queue")
    if q is None:
        return None, None
    return len(q.get("queue_running", [])), len(q.get("queue_pending", []))


PORT = int(SERVER.rsplit(":", 1)[-1].split("/")[0]) if ":" in SERVER else 8188


def find_pids():
    """ポートを掴んでいるプロセスから ComfyUI を特定する。

    wmic は新しい Windows で非推奨のため、netstat でポートの所有者を引く。
    """
    pids = []
    try:
        r = subprocess.run(["netstat", "-ano", "-p", "TCP"],
                           capture_output=True, text=True, timeout=15)
        for line in r.stdout.splitlines():
            f = line.split()
            if len(f) >= 5 and f[3] == "LISTENING" and f[1].endswith(f":{PORT}"):
                if f[4].isdigit():
                    pids.append(int(f[4]))
    except Exception:
        pass
    return sorted(set(pids))


def cmd_status():
    if not is_up():
        print("ComfyUI : 停止中")
        return 1
    run, pend = queue_state()
    st = api("/system_stats")
    dev = st["devices"][0]
    used = (dev["vram_total"] - dev["vram_free"]) / 2**30
    tot = dev["vram_total"] / 2**30
    print(f"ComfyUI : 起動中  (v{st['system']['comfyui_version']})")
    print(f"  キュー : 実行中 {run} / 待機 {pend}")
    print(f"  VRAM   : {used:.1f} / {tot:.1f} GB")
    if run + pend > 0:
        print("\n  ★ 処理が動いています。停止すると中断されます。")
    return 0


def cmd_start(wait=180):
    if is_up():
        print("ComfyUI : すでに起動しています")
        return cmd_status()
    if not os.path.isfile(COMFY_PY):
        sys.exit(f"ComfyUI が見つかりません: {COMFY_PY}")
    print("ComfyUI を起動しています ...")
    subprocess.Popen(
        [COMFY_PY, "-s", COMFY_MAIN, "--windows-standalone-build"],
        cwd=COMFY_DIR,
        creationflags=subprocess.CREATE_NEW_CONSOLE if os.name == "nt" else 0,
    )
    t0 = time.time()
    while time.time() - t0 < wait:
        if is_up():
            print(f"  起動しました ({int(time.time()-t0)}秒)")
            return cmd_status()
        time.sleep(3)
        print("  ...", end="", flush=True)
    print(f"\n{wait}秒待っても応答しません。別ウィンドウのログを確認してください。")
    return 1


def cmd_stop(force=False):
    if not is_up():
        print("ComfyUI : すでに停止しています")
        return 0
    run, pend = queue_state()
    if (run or pend) and not force:
        print(f"★ 処理が動いています（実行中 {run} / 待機 {pend}）")
        print("  停止すると生成中のカットは失われます。")
        print("  終わるまで待つ場合はこのまま閉じてください。")
        ans = input("  それでも停止しますか？ [y/N]: ").strip().lower()
        if ans != "y":
            print("  停止をやめました。")
            return 0
    pids = find_pids()
    if not pids:
        print("プロセスが見つかりません。手動で閉じてください。")
        return 1
    for pid in pids:
        subprocess.run(["taskkill", "/PID", str(pid), "/T", "/F"],
                       capture_output=True)
        print(f"  停止しました (PID {pid})")
    for _ in range(10):
        if not is_up():
            print("ComfyUI : 停止完了")
            return 0
        time.sleep(1)
    print("まだ応答しています。手動で確認してください。")
    return 1


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("action", choices=["start", "stop", "restart", "status"])
    ap.add_argument("--force", action="store_true", help="確認せずに停止する")
    args = ap.parse_args()

    if args.action == "start":
        sys.exit(cmd_start())
    if args.action == "stop":
        sys.exit(cmd_stop(args.force))
    if args.action == "status":
        sys.exit(cmd_status())
    if args.action == "restart":
        cmd_stop(args.force)
        time.sleep(2)
        sys.exit(cmd_start())


if __name__ == "__main__":
    main()
