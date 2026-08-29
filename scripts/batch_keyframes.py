#!/usr/bin/env python3
r"""台本(60カット版)から指定カットのキーフレームを一括生成する。

使い方:
    python scripts/batch_keyframes.py --np-only          # 人物なしカットのみ
    python scripts/batch_keyframes.py --cuts C01,C05     # カット指定
    python scripts/batch_keyframes.py --all              # 全カット

台本の `### C01 (NP) 見出し` と `- IMG: \`...\`` を読み取り、
docs/production-spec.md の脱AI語を付与して generate.py を呼ぶ。
出力は outputs/keyframes/C01.png のようにカット番号で保存する。
"""

import argparse
import os
import re
import shutil
import subprocess
import sys

SCRIPT_MD = "script/ome-rookie-detective-60cuts.md"
OUT_DIR = "outputs/keyframes"

# docs/production-spec.md の「脱AI」語。全カット共通で付与する。
DEAI = (
    " Visible skin pores and slightly uneven skin tone, unretouched, "
    "natural slight asymmetry, shot on 35mm film with Kodak Portra 400, "
    "film grain, slight halation, shallow depth of field, "
    "slightly imperfect off-center framing."
)

CUT_RE = re.compile(r"^### (C\d{2})\s*(\(NP\))?\s*(\[\d+s\])?\s*(.*)$")
IMG_RE = re.compile(r"^- IMG: `(.+)`\s*$")


def parse_cuts(path):
    """[(id, is_np, label, img_prompt), ...] を返す。"""
    cuts, cur = [], None
    with open(path, encoding="utf-8") as f:
        for line in f:
            m = CUT_RE.match(line.rstrip())
            if m:
                cur = {"id": m.group(1), "np": bool(m.group(2)),
                       "label": m.group(4).strip(), "img": None}
                cuts.append(cur)
                continue
            if cur and cur["img"] is None:
                mi = IMG_RE.match(line.rstrip())
                if mi:
                    cur["img"] = mi.group(1)
    return [c for c in cuts if c["img"]]


def main():
    ap = argparse.ArgumentParser()
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--np-only", action="store_true", help="人物なしカットのみ")
    g.add_argument("--cuts", help="カット番号をカンマ区切りで指定 (例 C01,C05)")
    g.add_argument("--all", action="store_true")
    ap.add_argument("--width", type=int, default=1024)
    ap.add_argument("--height", type=int, default=1536)
    ap.add_argument("--script", default=SCRIPT_MD)
    ap.add_argument("--out", default=OUT_DIR)
    ap.add_argument("--python", default=sys.executable)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    cuts = parse_cuts(args.script)
    if args.np_only:
        cuts = [c for c in cuts if c["np"]]
    elif args.cuts:
        want = {s.strip().upper() for s in args.cuts.split(",")}
        cuts = [c for c in cuts if c["id"] in want]

    if not cuts:
        sys.exit("対象カットがありません。")

    os.makedirs(args.out, exist_ok=True)
    print(f"対象 {len(cuts)} カット: {', '.join(c['id'] for c in cuts)}\n")

    ok, ng = [], []
    for i, c in enumerate(cuts, 1):
        dest = os.path.join(args.out, f"{c['id']}.png")
        if os.path.exists(dest):
            print(f"[{i}/{len(cuts)}] {c['id']} 済み (スキップ)")
            ok.append(c["id"])
            continue
        print(f"[{i}/{len(cuts)}] {c['id']} {c['label']}")
        if args.dry_run:
            print(f"    {(c['img'] + DEAI)[:120]}...")
            continue

        before = set(os.listdir("outputs"))
        r = subprocess.run(
            [args.python, "scripts/generate.py", "--prompt", c["img"] + DEAI,
             "--width", str(args.width), "--height", str(args.height)],
            capture_output=True, text=True,
        )
        if r.returncode != 0:
            print(f"    失敗: {r.stderr.strip()[:200]}")
            ng.append(c["id"])
            continue
        new = [f for f in os.listdir("outputs") if f not in before and f.endswith(".png")]
        if not new:
            print("    出力が見つかりません")
            ng.append(c["id"])
            continue
        shutil.move(os.path.join("outputs", new[0]), dest)
        print(f"    -> {dest}")
        ok.append(c["id"])

    print(f"\n完了 {len(ok)} / 失敗 {len(ng)}")
    if ng:
        print("失敗したカット: " + ", ".join(ng))


if __name__ == "__main__":
    main()
