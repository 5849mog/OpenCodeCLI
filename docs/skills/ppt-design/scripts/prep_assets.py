#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""用户图片素材管线：先清点回报，再按声明式规格做无损调理。

默认只做无损项（EXIF 转正 / 转 sRGB / 按版面比例裁切 / 降采样到位）——
照片本来的信息不丢；双色调、灰度、颗粒这些改变原貌的处理**要了才做**。

目录约定：工作目录下 `assets/` 放原始素材，`assets/_ready/` 放调理成品；
deck 生成脚本引用 `_ready/` 里的文件。

用法：
  python prep_assets.py assets/                    # 清点模式：打印清单，供与用户确认
  python prep_assets.py assets/ spec.json          # 处理模式，输出到 assets/_ready/
  python prep_assets.py assets/ spec.json --out 别的目录 --ppi 300

规格（逐张声明；键=assets/ 里的文件名）：
  {
    "产品照.jpg": {"裁切": "16:9", "裁切锚点": "偏上", "目标宽": 6.0,
                   "双色调": ["111111", "E4002B"], "颗粒": 0.04},
    "截图.png":   {"目标宽": 8.0, "灰度": true},
    "考卷几何题.jpg": {"扫描件": true, "裁切": "4:3", "目标宽": 5.0},
    "整页卷子.jpg":   {"裁切区域": [0.08, 0.55, 0.92, 0.95], "扫描件": true, "目标宽": 6.0},
    "相片.jpg":   {"扫描件": {"去斜": true, "白底": true, "裁白边": true, "对比": 1.2, "去噪": 1}}
  }
  裁切区域：[左, 上, 右, 下]，<=1 为相对比例、>1 为像素；一页多图时用它取出单张图
            （放在扫描件之前——去斜会改尺寸，坐标按未处理的整页给）
  裁切：目标宽高比 "W:H"；裁切锚点：居中 / 偏上 / 偏下 / 偏左 / 偏右
  目标宽：最终显示宽度（英寸）——输出像素 = 目标宽 × PPI（默认 300）
  双色调：[深色, 浅色] 六位十六进制；灰度、颗粒（0–0.15）可选
  扫描件：true 用默认值，或给对象覆盖 去斜/白底/裁白边/对比/去噪/留白——
          依次做 去噪 → 白底归一 → 去斜（Otsu 分墨迹 + 投影廓线估角）→ 裁白边 → 对比，
          专治手机拍的卷子：灰底、歪斜、白边、噪点。纯线稿另加 "灰度": true

沟通纪律：先跑清点模式，把文件名/尺寸/比例/问题回报给用户，逐张确认用途与
处理方式后再处理——不要自作主张改用户素材。
HEIC：装了 pillow-heif 就支持，否则明确提示导出 JPG（不静默跳过）。
退出码：0 成功；1 处理失败；规格/文件错误直接报错。
"""
import json
import os
import sys

SUPPORTED = (".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tif", ".tiff", ".heic", ".heif")

def _open_image(path):
    from PIL import Image, ImageOps
    try:
        import pillow_heif
        pillow_heif.register_heif_opener()
    except ImportError:
        pass
    try:
        raw = Image.open(path)
        raw.load()
    except Exception as e:
        if path.lower().endswith((".heic", ".heif")):
            raise RuntimeError("读不了 HEIC——请导出 JPG，或 python -m pip install pillow-heif")
        raise
    note = ""
    try:
        orient = raw.getexif().get(0x0112)
        if orient not in (None, 1):
            note = f"（EXIF 旋转 {orient} 已转正）"
    except Exception:
        pass
    return ImageOps.exif_transpose(raw), note        # 手机照片靠 EXIF 记方向，不转正会躺倒

def _to_srgb(img):
    """统一到 sRGB，避免投屏偏色；转换失败不阻断，只提示。"""
    note = ""
    if img.mode in ("CMYK", "P"):
        img = img.convert("RGB")
    icc = img.info.get("icc_profile")
    if icc:
        try:
            from PIL import ImageCms
            import io
            src = ImageCms.ImageCmsProfile(io.BytesIO(icc))
            dst = ImageCms.createProfile("sRGB")
            img = ImageCms.profileToProfile(img.convert("RGB"), src, dst, outputMode="RGB")
        except Exception:
            note = "（色彩配置转换失败，按原色彩保留）"
    return img, note

def _crop_region(img, box):
    """按区域裁出图块（一页多图的卷子取单张图）：<=1 视为相对比例，>1 视为像素。"""
    if not isinstance(box, (list, tuple)) or len(box) != 4:
        raise RuntimeError("裁切区域要四个数 [左, 上, 右, 下]（<=1 为比例，>1 为像素）")
    w, h = img.size

    def px(v, size):
        return int(round(float(v) * size)) if float(v) <= 1 else int(round(float(v)))

    x0, y0 = max(0, px(box[0], w)), max(0, px(box[1], h))
    x1, y1 = min(w, px(box[2], w)), min(h, px(box[3], h))
    if x1 - x0 < 8 or y1 - y0 < 8:
        raise RuntimeError(f"裁切区域太小或反了：{(x0, y0, x1, y1)}")
    return img.crop((x0, y0, x1, y1))

def _crop_ratio(img, ratio, anchor):
    w, h = img.size
    tw, th = ratio
    target = tw / th
    cur = w / h
    if abs(cur - target) < 1e-3:
        return img
    if cur > target:                             # 太宽 → 裁左右
        nw = int(round(h * target))
        if anchor in ("偏左",):
            x = 0
        elif anchor in ("偏右",):
            x = w - nw
        else:
            x = (w - nw) // 2
        return img.crop((x, 0, x + nw, h))
    nh = int(round(w / target))                  # 太高 → 裁上下
    if anchor == "偏上":
        y = 0
    elif anchor == "偏下":
        y = h - nh
    else:
        y = (h - nh) // 2
    return img.crop((0, y, w, y + nh))

def _duotone(img, dark, light):
    from PIL import ImageOps
    gray = ImageOps.grayscale(img)
    return ImageOps.colorize(gray, black="#" + dark.lstrip("#"), white="#" + light.lstrip("#"))

def _grain(img, amount):
    from PIL import Image
    noise = Image.effect_noise(img.size, 26).convert("RGB")
    return Image.blend(img, noise, min(max(amount, 0.0), 0.15) * 0.9)

# ---------------------------------------------------------------- 扫描件清洗

SCAN_DEFAULTS = {"去斜": True, "白底": True, "裁白边": True, "对比": 1.15, "去噪": 0, "留白": 8}

def _border_percentile(img, q=0.9):
    """边框像素的分位数（按通道）——扫描件的底色估计，避开中间的内容。"""
    w, h = img.size
    b = max(2, int(min(w, h) * 0.03))
    regions = [(0, 0, w, b), (0, h - b, w, h), (0, 0, b, h), (w - b, 0, w, h)]
    hists = [0] * 256, [0] * 256, [0] * 256
    for box in regions:
        small = img.crop(box)
        if small.mode != "RGB":
            small = small.convert("RGB")
        for ch, hist in enumerate(hists):
            hh = small.getchannel(ch).histogram()
            for i, c in enumerate(hh):
                hist[i] += c
    out = []
    for hist in hists:
        total = sum(hist) or 1
        acc = 0
        for v, c in enumerate(hist):
            acc += c
            if acc >= total * q:
                out.append(v)
                break
        else:
            out.append(255)
    return out

def _otsu(arr):
    """Otsu 阈值：扫描件底色灰、墨迹黑时，靠"亮暗两类间方差最大"分开，比 mean±std 稳。"""
    import numpy as np
    hist, _ = np.histogram(arr, bins=256, range=(0, 256))
    total = float(arr.size) or 1.0
    sum_all = float((np.arange(256) * hist).sum())
    sum_b = w_b = 0.0
    best, thr = -1.0, 128.0
    for t in range(256):
        w_b += hist[t]
        if w_b == 0:
            continue
        w_f = total - w_b
        if w_f == 0:
            break
        sum_b += t * hist[t]
        m_b, m_f = sum_b / w_b, (sum_all - sum_b) / w_f
        var = w_b * w_f * (m_b - m_f) ** 2
        if var > best:
            best, thr = var, float(t)
    return thr

def _deskew(img):
    """Otsu 分出墨迹 → 候选角里取"行方向和方差最大"者转正。返回 (img, 倾斜角, 是否做了)。"""
    try:
        import numpy as np
    except ImportError:
        return img, 0.0, False
    from PIL import Image, ImageOps
    g = ImageOps.grayscale(img)
    scale = min(1.0, 1000.0 / max(g.size))
    if scale < 1.0:
        g = g.resize((max(1, int(g.width * scale)), max(1, int(g.height * scale))), Image.BILINEAR)
    arr = np.asarray(g, dtype=float)
    ink = arr < _otsu(arr)                       # 比阈值暗的才算墨迹（灰底不会被误当墨）
    if ink.sum() < 50:
        return img, 0.0, True
    mi = Image.fromarray((ink.astype(np.uint8)) * 255)
    best, best_var = 0.0, -1.0
    for k in range(-32, 33):                     # -8°…8°，步 0.25°
        a = k * 0.25
        prof = np.asarray(mi.rotate(a, resample=Image.BILINEAR, expand=False, fillcolor=0),
                          dtype=float).sum(axis=1)
        var = float(prof.var())
        if var > best_var:
            best, best_var = a, var
    if abs(best) < 0.25 or abs(best) > 7.5:       # 太小不必转；顶到边界说明估角不可靠，宁可不转
        return img, 0.0, True
    rot = img.rotate(best, resample=Image.BICUBIC, expand=True, fillcolor=(255, 255, 255))
    return rot, -best, True                       # rotate 正角=逆时针；报出的是检测到的倾斜量

def _white_base(img):
    """底色归一到白：边框分位数当底色，逐通道增益拉满（治灰底/偏黄）。返回 (img, 平均增益)。"""
    bg = _border_percentile(img, 0.9)
    gains = [min(4.0, 255.0 / max(v, 1)) for v in bg]
    if max(gains) < 1.06:                    # 本来就够白，不动
        return img, 1.0
    luts = []
    for g in gains:
        luts += [min(255, max(0, int(round(v * g)))) for v in range(256)]
    return img.point(luts), sum(gains) / 3

def _autocrop(img, pad):
    """裁掉扫描留下的白边（按"比纸白更暗"的像素求内容框）。"""
    from PIL import ImageOps
    gray = ImageOps.grayscale(img.convert("RGB"))
    ink = gray.point(lambda v: 255 if v < 232 else 0)
    box = ink.getbbox()
    if not box:
        return img, (0, 0)
    x0, y0, x1, y1 = box
    x0, y0 = max(0, x0 - pad), max(0, y0 - pad)
    x1, y1 = min(img.width, x1 + pad), min(img.height, y1 + pad)
    if x1 - x0 < 16 or y1 - y0 < 16:
        return img, (0, 0)
    return img.crop((x0, y0, x1, y1)), (img.width - (x1 - x0), img.height - (y1 - y0))

def _contrast(img, k):
    from PIL import Image
    lut = [min(255, max(0, int(round(128 + (v - 128) * k)))) for v in range(256)]
    if img.mode == "RGB":
        return img.point(lut * 3)
    if img.mode == "L":
        return img.point(lut)
    return img.convert("RGB").point(lut * 3)

def _clean_scan(img, opts):
    """扫描件清洗：去噪 → 去斜 → 白底归一 → 裁白边 → 对比。返回 (img, 说明行)。"""
    from PIL import ImageFilter
    if img.mode != "RGB":
        img = img.convert("RGB")             # 扫描件是不透明的，先丢掉 alpha，后面不必分情况
    steps = []
    if opts.get("去噪"):
        k = int(opts["去噪"])
        size = 3 if k <= 1 else 5
        img = img.convert("RGB").filter(ImageFilter.MedianFilter(size=size))
        steps.append(f"去噪 {size}×{size}")
    if opts.get("白底"):
        img, gain = _white_base(img)
        steps.append(f"白底归一（×{gain:.2f}）" if gain > 1.06 else "白底：本来就白")
    if opts.get("去斜"):
        img, ang, done = _deskew(img)
        steps.append(f"去斜 {ang:+.2f}°" if done and abs(ang) >= 0.2
                     else ("去斜：已正（无需转）" if done else "去斜跳过（缺 numpy）"))
    if opts.get("裁白边"):
        img, (dw, dh) = _autocrop(img, int(opts.get("留白", 8)))
        steps.append(f"裁白边（-{dw}/-{dh}px）" if dw or dh else "裁白边：无白边可裁")
    k = float(opts.get("对比", 1.0) or 1.0)
    if abs(k - 1.0) > 1e-6:
        img = _contrast(img.convert("RGB"), k)
        steps.append(f"对比 ×{k:.2f}")
    return img, ("扫描件：" + " · ".join(steps) if steps else "")

def _looks_scan(img):
    """清点时的疑似扫描件识别：底色浅但不到白、且通道接近（低饱和）。"""
    small = img.convert("RGB").resize((64, 64))
    px = [p for p in small.getdata() if sum(p) / 3 > 120]
    if len(px) < 200:
        return False
    mean = [sum(c) / len(px) for c in zip(*px)]
    return (max(mean) - min(mean)) < 28 and 150 <= sum(mean) / 3 <= 244   # 允许轻微暖/冷偏色

def inventory(folder):
    files = sorted(f for f in os.listdir(folder)
                   if f.lower().endswith(SUPPORTED) and not f.startswith("_"))
    if not files:
        print(f"（{folder} 里没有图片素材——支持的格式：{' '.join(SUPPORTED)}）")
        return []
    print(f"素材清点（{folder}）：{len(files)} 个文件")
    rows = []
    for f in files:
        p = os.path.join(folder, f)
        try:
            img, exif_note = _open_image(p)
            w, h = img.size
            issues = []
            if w < 800:
                issues.append("偏小（宽度 <800px，投屏会糊）")
            if max(w, h) / max(min(w, h), 1) > 3.5:
                issues.append("比例极端（长宽比 >3.5）")
            if img.mode in ("CMYK",):
                issues.append("CMYK——已按 sRGB 处理可防偏色")
            if _looks_scan(img):
                issues.append("疑似扫描件——规格里加 \"扫描件\": true 可白底/去斜/裁白边")
            alpha = "有透明" if img.mode in ("RGBA", "LA") or "transparency" in img.info else ""
            kb = os.path.getsize(p) // 1024
            print(f"  {f} | {w}×{h} | {w / h:.2f} : 1 | {img.mode} {alpha} | {kb} KB"
                  + (exif_note if exif_note else "")
                  + ("  ⚠ " + "；".join(issues) if issues else ""))
            rows.append((f, w, h, img.mode))
        except Exception as e:
            print(f"  {f} | ✗ {str(e)[:90]}")
    print("\n把这份清单回报给用户，逐张确认用途与处理方式（裁切比例/锚点、是否双色调）"
          "再进入处理模式——不要自作主张改素材。")
    return rows

def process(folder, spec, out_dir, ppi):
    from PIL import Image
    os.makedirs(out_dir, exist_ok=True)
    files = set(os.listdir(folder))
    missing = [k for k in spec if k not in files]
    if missing:
        sys.exit("规格里的文件不存在：" + "、".join(missing)
                 + "\n（清点模式可看可用文件）")
    done, failed = 0, 0
    for name, rule in spec.items():
        src = os.path.join(folder, name)
        try:
            img, exif_note = _open_image(src)
            img, note = _to_srgb(img)
            note = (exif_note + note) or ""
            if rule.get("裁切区域"):
                img = _crop_region(img, rule["裁切区域"])   # 先取区域：去斜会改尺寸，坐标要按原图给
                note += "（按区域取图）"
            if rule.get("扫描件"):
                opts = dict(SCAN_DEFAULTS)
                if isinstance(rule["扫描件"], dict):
                    opts.update(rule["扫描件"])
                img, scan_note = _clean_scan(img, opts)
                note = (note + "  " + scan_note) if scan_note else note
            ratio = None
            if rule.get("裁切"):
                a, b = str(rule["裁切"]).split(":")
                ratio = (int(a), int(b))
                img = _crop_ratio(img, ratio, rule.get("裁切锚点", "居中"))
            if rule.get("双色调"):
                d, l = rule["双色调"]
                img = _duotone(img, d, l)
            elif rule.get("灰度"):
                from PIL import ImageOps
                img = ImageOps.grayscale(img).convert("RGB")
            target_w = float(rule.get("目标宽", 6.0))
            out_w = int(round(target_w * ppi))
            out_h = max(1, int(round(img.height * out_w / img.width)))
            img = img.resize((out_w, out_h), Image.LANCZOS)
            if rule.get("颗粒"):
                img = _grain(img.convert("RGB"), float(rule["颗粒"]))
            has_alpha = img.mode in ("RGBA", "LA") or "transparency" in img.info
            base = os.path.splitext(name)[0]
            dst = os.path.join(out_dir, base + (".png" if has_alpha else ".jpg"))
            if has_alpha:
                img.convert("RGBA").save(dst)
            else:
                img.convert("RGB").save(dst, quality=92)
            eff = round(out_w / target_w)
            print(f"  {name} → {os.path.relpath(dst)} | {out_w}×{out_h} | 有效 {eff} PPI"
                  f" | {os.path.getsize(dst) // 1024} KB" + (note or ""))
            done += 1
        except Exception as e:
            failed += 1
            print(f"  ✗ {name}：{str(e)[:110]}")
    print(f"\n处理完成 {done} 张" + (f"，失败 {failed} 张" if failed else "")
          + f" → {out_dir}")
    print("生成脚本请引用 _ready/ 里的文件；图片出处记在交付说明里（来源必列）。")
    return 1 if failed else 0

def main():
    argv = sys.argv[1:]
    known = {"--out", "--ppi"}
    for a in argv:
        if not a.startswith("--"):
            continue
        base, eq, _ = a.partition("=")
        if base not in known:
            sys.exit(f"未知参数 {base}；可用：{' '.join(sorted(known))}")
        if eq and base in ("--out", "--ppi"):
            sys.exit(f"{base} 不支持 = 形式，请用空格：{base} <值>")
    pos, out_dir, ppi, i = [], None, 300, 0
    while i < len(argv):
        a = argv[i]
        if a in ("--out", "--ppi"):
            if i + 1 >= len(argv):
                sys.exit(f"{a} 缺少值")
            val = argv[i + 1]
            if a == "--out":
                out_dir = val
            else:
                try:
                    ppi = int(val)
                except ValueError:
                    sys.exit(f"{a} 的值 {val!r} 不是整数")
            i += 2
            continue
        if a.startswith("--"):
            i += 1
            continue
        pos.append(a)
        i += 1
    if not pos or len(pos) > 2:
        sys.exit(__doc__)
    folder = pos[0]
    if not os.path.isdir(folder):
        sys.exit("找不到目录：" + folder)
    if len(pos) == 1:
        inventory(folder)
        return 0
    try:
        spec = json.load(open(pos[1], encoding="utf-8"))
    except Exception as e:
        sys.exit(f"规格 {pos[1]} 读不了：{e}")
    return process(folder, spec, out_dir or os.path.join(folder, "_ready"), ppi)

if __name__ == "__main__":
    sys.exit(main())
