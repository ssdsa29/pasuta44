#!/usr/bin/env python3
r"""生成済みの動画を台本の順に連結してプレビューを作る。

使い方:
    python scripts/preview.py                    # 全部つなぐ
    python scripts/preview.py --act 1            # 第1幕だけ
    python scripts/preview.py --no-label         # カット番号の焼き込みなし

未生成のカットは飛ばす。制作途中でも通して見られる。
出力は outputs/preview.mp4。
"""

import argparse
import os
import re
import subprocess
import sys

if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

# どのフォルダから実行してもプロジェクトルートを基準にする
os.chdir(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

SCRIPT_MD = "script/ome-rookie-detective-60cuts.md"
VID_DIR = "outputs/videos"
OUT = "outputs/preview.mp4"
FONT = "C\\:/Windows/Fonts/BIZ-UDGothicB.ttc"

CUT_RE = re.compile(r"^### (C\d{2})\s*(\(NP\))?\s*(\[(\d+)s\])?\s*(.*)$")
ACT_RE = re.compile(r"^## 第(\d)幕")


def parse(path):
    cuts, act = [], 0
    with open(path, encoding="utf-8") as f:
        for line in f:
            a = ACT_RE.match(line)
            if a:
                act = int(a.group(1))
                continue
            m = CUT_RE.match(line.rstrip())
            if m:
                cuts.append({"id": m.group(1), "act": act,
                             "label": m.group(5).strip()})
    return cuts


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--act", type=int, help="幕を指定 (1-4)")
    ap.add_argument("--no-label", action="store_true", help="カット番号を焼き込まない")
    ap.add_argument("--out", default=OUT)
    args = ap.parse_args()

    cuts = parse(SCRIPT_MD)
    if args.act:
        cuts = [c for c in cuts if c["act"] == args.act]
    have = [c for c in cuts if os.path.exists(os.path.join(VID_DIR, c["id"] + ".mp4"))]
    if not have:
        sys.exit("連結できる動画がありません。")

    missing = [c["id"] for c in cuts if c not in have]
    print(f"連結 {len(have)} カット" + (f"  (未生成 {len(missing)} をスキップ)" if missing else ""))

    # 入力とフィルタを組み立てる
    ins, parts = [], []
    for i, c in enumerate(have):
        ins += ["-i", os.path.join(VID_DIR, c["id"] + ".mp4")]
        v = f"[{i}:v]"
        if not args.no_label:
            txt = f"{c['id']}  {c['label']}".replace(":", "\\:").replace("'", "")
            v_out = f"[v{i}]"
            parts.append(
                f"{v}drawtext=fontfile='{FONT}':text='{txt}':"
                f"fontcolor=white:fontsize=26:box=1:boxcolor=black@0.55:boxborderw=10:"
                f"x=20:y=h-th-20{v_out}"
            )
            ins_label = v_out
        else:
            ins_label = v
        parts.append(None) if False else None
        have[i]["_v"] = ins_label

    filt = ";".join(p for p in parts if p)
    concat_in = "".join(c["_v"] for c in have)
    if filt:
        filt += ";"
    filt += f"{concat_in}concat=n={len(have)}:v=1:a=0[out]"

    cmd = ["ffmpeg", "-v", "error", "-y", *ins,
           "-filter_complex", filt, "-map", "[out]",
           "-c:v", "libx264", "-preset", "medium", "-crf", "18",
           "-pix_fmt", "yuv420p", args.out]
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        sys.exit("ffmpeg 失敗:\n" + (r.stderr or r.stdout)[:1500])

    dur = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "csv=p=0", args.out], capture_output=True, text=True).stdout.strip()
    mb = os.path.getsize(args.out) / 1e6
    print(f"-> {args.out}  {float(dur):.1f}秒  {mb:.1f}MB")
    if missing:
        print("未生成: " + " ".join(missing))


if __name__ == "__main__":
    main()
