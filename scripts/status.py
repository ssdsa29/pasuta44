#!/usr/bin/env python3
r"""制作全体の進捗を1画面で表示する。

使い方:
    python scripts/status.py            # 1回表示
    python scripts/status.py --watch    # 15秒ごとに更新
"""

import argparse
import json
import os
import re
import sys
import time
import urllib.request

# Windows のコンソールが cp932 でも日本語を出せるようにする
if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

# どのフォルダから実行してもプロジェクトルートを基準にする
os.chdir(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

SERVER = os.environ.get("COMFYUI_SERVER", "http://127.0.0.1:8188")
SCRIPT_MD = "script/ome-rookie-detective-60cuts.md"
KF_DIR = "outputs/keyframes"
VID_DIR = "outputs/videos"

CUT_RE = re.compile(r"^### (C\d{2})\s*(\(NP\))?\s*(\[(\d+)s\])?\s*(.*)$")


def parse_cuts(path):
    cuts = []
    if not os.path.exists(path):
        return cuts
    with open(path, encoding="utf-8") as f:
        for line in f:
            m = CUT_RE.match(line.rstrip())
            if m:
                cuts.append({"id": m.group(1), "np": bool(m.group(2)),
                             "sec": int(m.group(4)) if m.group(4) else 3,
                             "label": m.group(5).strip()})
    return cuts


def bar(done, total, width=32):
    if total == 0:
        return "-" * width
    n = int(width * done / total)
    return "#" * n + "." * (width - n)


def comfy():
    try:
        with urllib.request.urlopen(SERVER + "/queue", timeout=3) as r:
            q = json.loads(r.read())
        return len(q.get("queue_running", [])), len(q.get("queue_pending", []))
    except Exception:
        return None, None


def gpu():
    try:
        with urllib.request.urlopen(SERVER + "/system_stats", timeout=3) as r:
            d = json.loads(r.read())
        dev = d["devices"][0]
        return dev["vram_total"] - dev["vram_free"], dev["vram_total"]
    except Exception:
        return None, None


# 尺ごとの実測生成時間（分）
SEC_MIN = {2: 7.0, 3: 13.0, 5: 30.2}


def render():
    cuts = parse_cuts(SCRIPT_MD)
    total = len(cuts)
    kf = {os.path.splitext(f)[0] for f in os.listdir(KF_DIR)} if os.path.isdir(KF_DIR) else set()
    vid = {os.path.splitext(f)[0] for f in os.listdir(VID_DIR)} if os.path.isdir(VID_DIR) else set()

    np_cuts = [c for c in cuts if c["np"]]
    ch_cuts = [c for c in cuts if not c["np"]]
    kf_done = [c for c in cuts if c["id"] in kf]
    vid_done = [c for c in cuts if c["id"] in vid]
    vid_left = [c for c in cuts if c["id"] in kf and c["id"] not in vid]
    eta = sum(SEC_MIN.get(c["sec"], 13.0) for c in vid_left)

    out = []
    out.append("=" * 56)
    out.append(f"  『青梅西署、事件です(たぶん)』 進捗   全{total}カット")
    out.append("=" * 56)
    out.append(f"  キーフレーム  [{bar(len(kf_done), total)}] {len(kf_done):>2}/{total}")
    out.append(f"    人物なし    {len([c for c in np_cuts if c['id'] in kf]):>2}/{len(np_cuts)}"
               f"      人物あり  {len([c for c in ch_cuts if c['id'] in kf]):>2}/{len(ch_cuts)}")
    out.append(f"  動画          [{bar(len(vid_done), total)}] {len(vid_done):>2}/{total}")
    out.append("")
    if vid_left:
        h, m = divmod(int(eta), 60)
        out.append(f"  動画化待ち {len(vid_left)}カット  残り推定 {h}時間{m:02d}分")
    else:
        out.append("  動画化待ち なし")

    run, pend = comfy()
    if run is None:
        out.append("  ComfyUI    応答なし（停止中）")
    else:
        used, tot = gpu()
        v = f"  VRAM {used/2**30:.1f}/{tot/2**30:.1f}GB" if used else ""
        out.append(f"  ComfyUI    実行中 {run} / 待機 {pend}{v}")

    missing_kf = [c["id"] for c in cuts if c["id"] not in kf]
    if missing_kf:
        out.append("")
        out.append("  キーフレーム未生成: " + " ".join(missing_kf[:18])
                   + (" ..." if len(missing_kf) > 18 else ""))
    out.append("=" * 56)
    return "\n".join(out)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--watch", action="store_true")
    ap.add_argument("--interval", type=int, default=15)
    args = ap.parse_args()
    if not args.watch:
        print(render())
        return
    try:
        while True:
            os.system("cls" if os.name == "nt" else "clear")
            print(render())
            print(f"\n  {args.interval}秒ごとに更新  (Ctrl+C で終了)")
            time.sleep(args.interval)
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
