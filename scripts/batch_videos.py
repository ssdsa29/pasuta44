#!/usr/bin/env python3
r"""キーフレームから動画を一括生成する。

使い方:
    python scripts/batch_videos.py --ready      # キーフレームが揃ったカット全部
    python scripts/batch_videos.py --cuts C01,C02
    python scripts/batch_videos.py --np-only

台本の MOV: 行を動きプロンプトとして使い、尺([2s]/[5s]/無印=3s)から
フレーム数を決める。出力は outputs/videos/C01.mp4。
生成済みはスキップするので、中断しても再開できる。
"""

import argparse
import os
import re
import shutil
import subprocess
import sys
import time

# Windows のコンソールが cp932 でも日本語を出せるようにする
if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

# どのフォルダから実行してもプロジェクトルートを基準にする
os.chdir(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

SCRIPT_MD = "script/ome-rookie-detective-60cuts.md"
KF_DIR = "outputs/keyframes"
VID_DIR = "outputs/videos"

CUT_RE = re.compile(r"^### (C\d{2})\s*(\(NP\))?\s*(\[(\d+)s\])?\s*(.*)$")
MOV_RE = re.compile(r"^- MOV: `(.+)`\s*$")

# 尺 → フレーム数（4n+1）
FRAMES = {2: 49, 3: 73, 5: 121}


def parse_cuts(path):
    cuts, cur = [], None
    with open(path, encoding="utf-8") as f:
        for line in f:
            m = CUT_RE.match(line.rstrip())
            if m:
                cur = {"id": m.group(1), "np": bool(m.group(2)),
                       "sec": int(m.group(4)) if m.group(4) else 3,
                       "label": m.group(5).strip(), "mov": None}
                cuts.append(cur)
                continue
            if cur and cur["mov"] is None:
                mm = MOV_RE.match(line.rstrip())
                if mm:
                    cur["mov"] = mm.group(1)
    return [c for c in cuts if c["mov"]]


def main():
    ap = argparse.ArgumentParser()
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--ready", action="store_true", help="キーフレームがあるカット全部")
    g.add_argument("--np-only", action="store_true")
    g.add_argument("--cuts")
    ap.add_argument("--width", type=int, default=720)
    ap.add_argument("--height", type=int, default=1088)
    ap.add_argument("--steps", type=int, default=30)
    ap.add_argument("--script", default=SCRIPT_MD)
    ap.add_argument("--python", default=sys.executable)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    cuts = parse_cuts(args.script)
    if args.np_only:
        cuts = [c for c in cuts if c["np"]]
    elif args.cuts:
        want = {s.strip().upper() for s in args.cuts.split(",")}
        cuts = [c for c in cuts if c["id"] in want]
    # キーフレームがあるものだけ
    cuts = [c for c in cuts if os.path.exists(os.path.join(KF_DIR, c["id"] + ".png"))]
    if not cuts:
        sys.exit("対象カットがありません（キーフレームが未生成の可能性）。")

    os.makedirs(VID_DIR, exist_ok=True)
    todo = [c for c in cuts if not os.path.exists(os.path.join(VID_DIR, c["id"] + ".mp4"))]
    est = sum({2: 7.0, 3: 13.0, 5: 30.2}[c["sec"]] for c in todo)
    print(f"対象 {len(cuts)} / 未生成 {len(todo)}  推定 {int(est)//60}時間{int(est)%60:02d}分\n")

    t0 = time.time()
    ok, ng = [], []
    for i, c in enumerate(todo, 1):
        frames = FRAMES[c["sec"]]
        dest = os.path.join(VID_DIR, c["id"] + ".mp4")
        el = time.time() - t0
        print(f"[{i}/{len(todo)}] {c['id']} {c['sec']}s({frames}f) {c['label']}"
              f"   経過 {int(el)//3600}:{int(el)%3600//60:02d}")
        if args.dry_run:
            print(f"    {c['mov'][:100]}")
            continue

        before = set(os.listdir("outputs"))
        r = subprocess.run(
            [args.python, "scripts/generate_video.py",
             "--image", os.path.join(KF_DIR, c["id"] + ".png"),
             "--prompt", c["mov"],
             "--width", str(args.width), "--height", str(args.height),
             "--length", str(frames), "--steps", str(args.steps)],
            capture_output=True, text=True,
        )
        if r.returncode != 0:
            print(f"    失敗: {(r.stderr or r.stdout).strip()[:200]}")
            ng.append(c["id"])
            continue
        new = [f for f in os.listdir("outputs") if f not in before and f.endswith(".mp4")]
        if not new:
            print("    出力が見つかりません")
            ng.append(c["id"])
            continue
        shutil.move(os.path.join("outputs", new[0]), dest)
        print(f"    -> {dest}")
        ok.append(c["id"])

    el = time.time() - t0
    print(f"\n完了 {len(ok)} / 失敗 {len(ng)}   所要 {int(el)//3600}時間{int(el)%3600//60:02d}分")
    if ng:
        print("失敗したカット: " + ", ".join(ng))


if __name__ == "__main__":
    main()
