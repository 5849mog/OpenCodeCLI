#!/usr/bin/env python3
"""把 pptx 渲染成 PNG，供闸门二视觉验收。优先 PowerPoint COM（Windows），
不可用时回退 LibreOffice + poppler。

用法：
  python render.py deck.pptx                  # 输出 preview/deck1.png ...
  python render.py deck.pptx tag              # 输出 preview/tag1.png ...
  python render.py deck.pptx --pages 2        # 只渲染第 2 页（样板页确认）
  python render.py deck.pptx --pages 2-4,7    # judge 复核：只重渲改动页
  python render.py deck.pptx --contact        # 额外输出 preview/_contact_tag.png 全 deck 拼图
  python render.py deck.pptx --soffice        # 强制走 LibreOffice 路线
  python render.py deck.pptx --soffice "C:\\path\\soffice.exe"  # 指定 soffice 路径

--pages 让样板页确认与修复复核只渲染关心的页：样板页只需要一张图，复核只需要
改动页，全量渲染是浪费。--contact 把所有页缩略拼成一张网格图：deck 级评审
（骨架复读、色带复现、强调色是否洒满）一眼可判，不必让 judge 在脑内翻十张图；
指定 --pages 时拼图自动跳过（拼图需要全量）。
"""
import argparse
import glob
import math
import os
import pathlib
import re
import shutil
import subprocess
import sys
import tempfile


def parse_args():
    ap = argparse.ArgumentParser(description="渲染 pptx 为 PNG，供闸门二视觉验收")
    ap.add_argument("deck", help="pptx 路径")
    ap.add_argument("tag", nargs="?", default=None,
                    help="输出文件名前缀（默认用 deck 文件名）")
    ap.add_argument("--pages", default=None, metavar="2-4,7",
                    help="只渲染指定页；缺省渲染全部")
    ap.add_argument("--contact", action="store_true",
                    help="全量渲染后额外输出全 deck 拼图")
    ap.add_argument("--soffice", nargs="?", const="", default=None, metavar="SOFFICE路径",
                    help="不带值=强制 LibreOffice 路线；带值=同时指定 soffice 路径")
    return ap.parse_args()


def parse_pages(spec):
    """'2-4,7' -> {2,3,4,7}；None/空 -> None（全部页）。"""
    if not spec:
        return None
    pages = set()
    for part in spec.split(","):
        part = part.strip()
        if not part:
            continue
        if "-" in part:
            lo, _, hi = part.partition("-")
            a, b = int(lo), int(hi)
            if a > b:
                raise ValueError(f"--pages 区间反了：{part}")
            pages.update(range(a, b + 1))
        else:
            pages.add(int(part))
    return pages or None


def _ranges(pages):
    """{2,3,4,7} -> [(2,4),(7,7)]：连续段合并，pdftoppm 按段调用。"""
    out = []
    for n in sorted(pages):
        if out and n == out[-1][1] + 1:
            out[-1] = (out[-1][0], n)
        else:
            out.append((n, n))
    return out


def _find_soffice(explicit):
    candidates = []
    if explicit:
        candidates.append(explicit)
    env = os.environ.get("SOFFICE")
    if env:
        candidates.append(env)
    found = shutil.which("soffice")
    if found:
        candidates.append(found)
    candidates += [
        "C:/Program Files/LibreOffice/program/soffice.exe",
        "/Applications/LibreOffice.app/Contents/MacOS/soffice",
    ]
    for c in candidates:
        if c and os.path.exists(c):
            return c
    return None


def _run(cmd, **kw):
    """subprocess.run 包一层：转换失败报「哪个程序、什么错」，而不是裸 CalledProcessError。"""
    try:
        return subprocess.run(cmd, **kw)
    except subprocess.CalledProcessError as e:
        raise RuntimeError(f"{os.path.basename(cmd[0])} 转换失败（退出码 {e.returncode}）") from None
    except subprocess.TimeoutExpired:
        raise RuntimeError(f"{os.path.basename(cmd[0])} 超时（>{kw.get('timeout', '?')}s）") from None


def via_powerpoint(src, out, tag, pages):
    import win32com.client

    # PowerPoint 是单实例应用。Dispatch 会附着到用户正开着的实例，
    # 此时 Quit() 会把人家未保存的演示一起关掉。先探测已有实例：
    # 有就只关自己开的演示，只有确认是我们拉起的进程才允许 Quit。
    try:
        app = win32com.client.GetActiveObject("PowerPoint.Application")
        we_started = False
    except Exception:
        app = win32com.client.Dispatch("PowerPoint.Application")
        we_started = True
    try:
        app.DisplayAlerts = 1  # ppAlertsNone：修复弹窗改走异常回退，别让 COM 挂死
    except Exception:
        pass
    pres = None
    try:
        pres = app.Presentations.Open(src, ReadOnly=True, WithWindow=False)
        # 画幅比跟随 deck 本身（4:3 / A4 竖版等）——固定 1920×1080 会把非 16:9 的页拉变形
        slide_w = float(pres.PageSetup.SlideWidth)
        slide_h = float(pres.PageSetup.SlideHeight)
        w_px = 1920
        h_px = max(1, round(w_px * slide_h / slide_w))
        total = len(pres.Slides)
        if pages:
            missing = sorted(i for i in pages if not 1 <= i <= total)
            if missing:
                # ValueError = 参数错误，main 里不进渲染器回退链
                raise ValueError(f"--pages 里的第 {missing[0]} 页不存在（deck 共 {total} 页）")
            wanted = sorted(pages)
        else:
            wanted = range(1, total + 1)
        for i in wanted:
            dst = os.path.join(out, f"{tag}{i}.png")
            pres.Slides(i).Export(dst, "PNG", w_px, h_px)
            print(dst, os.path.getsize(dst), "bytes")
        return len(list(wanted)), pages is None
    finally:
        # Open 失败也要收尸：脚本拉起的实例必须退出，别留游离 PowerPoint
        if pres is not None:
            pres.Close()
        if we_started:
            app.Quit()


def via_libreoffice(src, out, tag, soffice, pages):
    # 独立 profile：用户本机开着 LibreOffice 时 profile 锁会让 headless 转换静默失败
    profile = pathlib.Path(tempfile.mkdtemp(prefix="lo_render_profile_")).as_uri()
    pdf = os.path.join(out, os.path.splitext(os.path.basename(src))[0] + ".pdf")
    _run(
        [soffice, f"-env:UserInstallation={profile}",
         "--headless", "--convert-to", "pdf", "--outdir", out, src],
        check=True, timeout=300,
    )
    try:
        if not os.path.exists(pdf):
            raise RuntimeError(f"LibreOffice 未产出 PDF（期望 {pdf}）")
        poppler = shutil.which("pdftoppm") or os.environ.get("PDFTOPPM")
        if not poppler:
            raise RuntimeError("未找到 pdftoppm（poppler-utils），LibreOffice 路线需要它。")
        total = 0
        pdfinfo = shutil.which("pdfinfo") or os.environ.get("PDFINFO")
        if pdfinfo:
            info = subprocess.run([pdfinfo, pdf], capture_output=True, text=True).stdout
            m = re.search(r"^Pages:\s+(\d+)", info, re.M)
            total = int(m.group(1)) if m else 0
        # 页数拿不到（pdfinfo 缺失/输出没解析出来）时不伪造区间：全量渲染就不传
        # -f/-l 让 pdftoppm 出全部页；--pages 则交给 pdftoppm 自己校验。
        if pages:
            ranges = _ranges(pages)
            if total:
                for lo, hi in ranges:
                    if hi < 1 or hi > total:
                        raise ValueError(f"--pages 里的页码超出范围（deck 共 {total} 页）")
        elif total:
            ranges = [(1, total)]
        else:
            ranges = [None]
        for r in ranges:
            cmd = [poppler, "-png", "-r", "144"]
            if r is not None:
                cmd += ["-f", str(r[0]), "-l", str(r[1])]
            cmd += [pdf, os.path.join(out, f"{tag}-")]
            _run(cmd, check=True, timeout=300)
        # 规范命名：tag-1.png / tag-01.png -> tagN.png，与 COM 路线完全一致
        for f in glob.glob(os.path.join(out, f"{tag}-*.png")):
            m = re.match(re.escape(tag) + r"-(\d+)\.png$", os.path.basename(f))
            if m:
                os.replace(f, os.path.join(out, f"{tag}{int(m.group(1))}.png"))
    finally:
        if os.path.exists(pdf):
            os.remove(pdf)  # 中间产物，preview 目录只留 PNG
    n = len(glob.glob(os.path.join(out, f"{tag}*.png")))
    print("LibreOffice 渲染完成（注意：LibreOffice 会替换它没有的字体，"
          "溢出判断与观感可能与 PowerPoint 不一致）")
    return n, pages is None


def _page_no(path: str, tag: str) -> int:
    m = re.search(re.escape(tag) + r"-?(\d+)", os.path.basename(path))
    return int(m.group(1)) if m else 0


def contact_sheet(out, tag):
    try:
        from PIL import Image
    except ImportError:
        print("PIL 未安装，跳过拼图（python -m pip install pillow）")
        return
    files = sorted(glob.glob(os.path.join(out, f"{tag}*.png")), key=lambda p: _page_no(p, tag))
    if len(files) < 2:
        return
    thumbs = []
    tw = 640
    for f in files:
        try:
            im = Image.open(f)
            th = max(1, round(im.height * tw / im.width))
            thumbs.append(im.resize((tw, th)))
        except Exception:
            continue
    if not thumbs:
        return
    cols = math.ceil(math.sqrt(len(thumbs)))
    rows = math.ceil(len(thumbs) / cols)
    row_h = [max(t.height for t in thumbs[r * cols:(r + 1) * cols]) for r in range(rows)]
    col_w = [max(t.width for t in thumbs[c::cols]) for c in range(cols)]
    gap = 12
    W = sum(col_w) + gap * (cols + 1)
    H = sum(row_h) + gap * (rows + 1)
    sheet = Image.new("RGB", (W, H), "white")
    y = gap
    for r in range(rows):
        x = gap
        for c in range(cols):
            i = r * cols + c
            if i < len(thumbs):
                sheet.paste(thumbs[i], (x, y))
            x += col_w[c] + gap
        y += row_h[r] + gap
    dst = os.path.join(out, f"_contact_{tag}.png")
    sheet.save(dst)
    print(dst, os.path.getsize(dst), "bytes (contact sheet)")


def main():
    args = parse_args()
    pages = parse_pages(args.pages)
    src = os.path.abspath(args.deck)
    if not os.path.exists(src):
        sys.exit(f"找不到文件：{src}")
    tag = args.tag or os.path.splitext(os.path.basename(src))[0]
    out = os.path.join(os.path.abspath("."), "preview")
    os.makedirs(out, exist_ok=True)
    if pages is None:
        for f in glob.glob(os.path.join(out, f"{tag}*.png")):
            os.remove(f)
    else:
        # 只删这次要重渲的那几页，保留其它页预览（复核改动页不该毁掉全量预览）
        for n in pages:
            p = os.path.join(out, f"{tag}{n}.png")
            if os.path.exists(p):
                os.remove(p)
    contact = os.path.join(out, f"_contact_{tag}.png")
    if pages is None and os.path.exists(contact):
        os.remove(contact)  # 只在全量渲染时清旧拼图；--pages 重渲不应毁掉已有的拼图

    exported, full = 0, False
    if args.soffice is None and sys.platform == "win32":
        try:
            exported, full = via_powerpoint(src, out, tag, pages)
        except ValueError as e:
            sys.exit(f"渲染失败：{e}")  # 参数错误不进渲染器回退链
        except ImportError:
            print("pywin32 未安装 → 回退 LibreOffice")
        except Exception as e:
            print(f"PowerPoint 渲染失败（{e}）→ 回退 LibreOffice")

    if not exported:
        soffice = _find_soffice(args.soffice or None)
        if not soffice:
            sys.exit("找不到渲染器：装 pywin32 + PowerPoint，或 LibreOffice + poppler-utils。")
        exported, full = via_libreoffice(src, out, tag, soffice, pages)

    if args.contact and full:
        contact_sheet(out, tag)
    elif args.contact and not full:
        print("指定了 --pages，跳过拼图（拼图需要全量渲染）")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (RuntimeError, ValueError, subprocess.SubprocessError, OSError) as e:
        sys.exit(f"渲染失败：{e}")
