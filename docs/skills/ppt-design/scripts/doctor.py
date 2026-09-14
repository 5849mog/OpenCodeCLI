#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""检测 ppt-design 的真实执行能力，禁止调用方靠猜测决定交付承诺。

用法：
  python doctor.py          # 人类可读报告
  python doctor.py --json   # 机器可读报告，供 Agent 路由
  python doctor.py --strict # 任一阻塞项存在时退出 1

输出的 profile 是唯一环境决策来源：
  full-windows      可以做并验证静态与动画 PPT
  static-verified   可以生成、QA、渲染；动画没有 COM 逐条验证
  structure-only    可以生成/结构 QA，不能完成可靠的视觉验收
  blocked           缺生成或结构 QA 的硬依赖，不得开始正式施工
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import os
import platform
import shutil
import subprocess
import sys
from pathlib import Path


def present_module(name: str) -> bool:
    return importlib.util.find_spec(name) is not None


def command_version(command: list[str]) -> tuple[bool, str | None]:
    if not shutil.which(command[0]):
        return False, None
    try:
        out = subprocess.run(command, capture_output=True, text=True, timeout=8,
                             encoding="utf-8", errors="replace")
        line = (out.stdout or out.stderr).strip().splitlines()
        return out.returncode == 0, line[0] if line else None
    except (OSError, subprocess.SubprocessError):
        return False, None


def node_package(name: str) -> tuple[bool, str | None]:
    ok, version = command_version(["node", "--version"])
    if not ok:
        return False, version
    probe = subprocess.run(
        ["node", "-e", f"console.log(require.resolve({name!r}))"],
        capture_output=True, text=True, timeout=8, encoding="utf-8", errors="replace",
    )
    return probe.returncode == 0, version


def find_soffice() -> str | None:
    candidates = [os.environ.get("SOFFICE"), shutil.which("soffice"),
                  "C:/Program Files/LibreOffice/program/soffice.exe",
                  "/Applications/LibreOffice.app/Contents/MacOS/soffice"]
    return next((str(p) for p in candidates if p and Path(p).exists()), None)


def main() -> int:
    ap = argparse.ArgumentParser(description="ppt-design 环境探测与能力路由")
    ap.add_argument("--json", action="store_true", help="输出机器可读 JSON")
    ap.add_argument("--strict", action="store_true", help="有阻塞项时退出 1")
    args = ap.parse_args()

    is_windows = platform.system().lower() == "windows"
    node_ok, node_version = command_version(["node", "--version"])
    pptxgenjs_ok, _ = node_package("pptxgenjs")
    soffice = find_soffice()
    poppler = shutil.which("pdftoppm")
    modules = {name: present_module(name) for name in
               ("pptx", "PIL", "defusedxml", "jieba", "matplotlib", "numpy", "pillow_heif", "win32com")}
    com = is_windows and modules["win32com"]
    qa_structure = modules["pptx"]
    qa_real_font_metrics = is_windows and modules["PIL"] and Path("C:/Windows/Fonts").is_dir()
    qa_cjk_word_break = modules["jieba"]
    renderer = "powerpoint-com" if com else ("libreoffice" if soffice and poppler else None)
    visual_review = renderer is not None
    generate = node_ok and pptxgenjs_ok

    blocks: list[dict[str, str]] = []
    warnings: list[dict[str, str]] = []
    if not generate:
        blocks.append({"feature": "generation", "reason": "缺少 Node 或 pptxgenjs；不得开始正式施工"})
    if not qa_structure:
        blocks.append({"feature": "structure-qa", "reason": "缺少 python-pptx；不得声称闸门一已通过"})
    if not visual_review:
        warnings.append({"feature": "visual-review", "reason": "无 PowerPoint COM 或 LibreOffice+pdftoppm；不得声称闸门二已完成"})
    if not com:
        warnings.append({"feature": "animation", "reason": "无 PowerPoint COM；动画可注入但不得声称已逐条验证"})
    if not qa_real_font_metrics:
        warnings.append({"feature": "font-metrics", "reason": "非 Windows 字体目录或缺 Pillow；文字宽度检查将降级为估算"})
    if not qa_cjk_word_break:
        warnings.append({"feature": "cjk-word-break", "reason": "缺 jieba；中文劈词检查关闭，交付必须声明降级"})

    if blocks:
        profile = "blocked"
    elif visual_review and com:
        profile = "full-windows"
    elif visual_review:
        profile = "static-verified"
    else:
        profile = "structure-only"

    result = {
        "profile": profile,
        "platform": platform.platform(),
        "python": sys.version.split()[0],
        "capabilities": {
            "generatePptx": generate, "qaStructure": qa_structure,
            "qaRealFontMetrics": qa_real_font_metrics, "qaCjkWordBreak": qa_cjk_word_break,
            "renderPowerPoint": com, "renderLibreOffice": bool(soffice and poppler),
            "visualReview": visual_review, "injectFormula": modules["matplotlib"],
            "injectFigure": modules["matplotlib"] and modules["numpy"],
            "injectIcons": qa_structure, "injectAnimation": qa_structure,
            "verifyAnimationWithCom": com,
        },
        "tools": {"node": node_version, "pptxgenjs": pptxgenjs_ok, "soffice": soffice,
                  "pdftoppm": poppler, "modules": modules},
        "blocks": blocks, "warnings": warnings,
    }
    if args.json:
        print(json.dumps(result, ensure_ascii=False, indent=2))
    else:
        print(f"ppt-design environment: {profile}")
        print(f"  Python: {result['python']}  |  Node: {node_version or 'missing'}  |  pptxgenjs: {'yes' if pptxgenjs_ok else 'missing'}")
        print("  Rendering: " + ("PowerPoint COM" if com else "LibreOffice" if renderer else "unavailable"))
        for item in blocks:
            print(f"  [BLOCK] {item['reason']}")
        for item in warnings:
            print(f"  [WARN] {item['reason']}")
        if not blocks and not warnings:
            print("  [PASS] All configured checks are available.")
    return 1 if args.strict and blocks else 0


if __name__ == "__main__":
    raise SystemExit(main())
