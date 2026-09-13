#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""给 pptx 注入动画（pptxgenjs 不支持动画，此脚本在生成后做后处理）。

菜单制：AI 写"哪页、哪个形状、哪道效果、怎么触发"的声明式脚本（JSON），
本脚本把它编译成 PowerPoint 权威格式的 timing/transition XML 注入文件。
XML 模板全部抄自 PowerPoint 自己通过 COM 生成的文件（探针实测），
AI 永远不直接写 XML，所以结构错不了。

用法：
  python inject_anim.py deck.pptx script.json            # 注入 + COM 验证
  python inject_anim.py deck.pptx script.json --no-verify # 只注入
  python inject_anim.py deck.pptx script.json --replace   # 清掉旧动画再注入（重新注入用）
  python inject_anim.py deck.pptx script.json --probe     # 验证时打印原始读回值（校准用）
  python inject_anim.py deck.pptx script.json --raw       # 启用「原始XML」逃生舱（须用户同意，见下）

脚本格式（全部中文键值；页码/形状以 JSON 字符串写）：
  {
    "transitions": {"1": "淡入", "2": {"效果": "推入", "方向": "自底部"}, "3": "平滑"},
    "pages": {
      "2": [
        {"形状": "标题", "效果": "淡入", "触发": "自动"},
        {"形状": "论点一", "效果": "出现", "触发": "点击"},
        {"形状": "论点二", "效果": "浮入", "触发": "之后", "方向": "自底部"},
        {"形状": "柱状图", "效果": "擦入", "触发": "点击", "方向": "自左侧", "时长": 1.0}
      ]
    }
  }
  形状 = 施工时 pptxgenjs 的 objectName；触发 = 点击/同时/之后/自动（翻页后自动播）
  效果与切换的完整菜单、默认时长见下方 EFFECTS / TRANSITIONS 两张表。

原始XML（逃生舱，默认关闭——菜单里没有的效果才用，且**必须先经用户同意**）：
  默认路线永远是上面的菜单。只有当用户明确要求做菜单外的效果（路径动画、旋转、
  3D 等），且已经明确同意之后，才可以用 --raw 打开这个口子。三重闸门缺一不可：
    ① 命令行必须带 --raw；
    ② 脚本里每条原始 XML 必须写明「用户已同意」: true 与「原因」（非空）；
    ③ 这段 XML 必须是以 <p:timing> 为根、命名空间正确的片段，且引用的 spid 都要
       在本页真实存在（悬空引用会在写入前拦下）。
  格式（页码是字符串键，与 pages 同一套；同一页不许同时出现在 pages 和原始XML 里）：
    "原始XML": {
      "4": {"XML": "<p:timing>…</p:timing>",
            "原因": "用户要求做菜单外的路径动画", "用户已同意": true}
    }
  **手写的部分没有逐条断言可做**：菜单路线能断言「第几条是什么效果、打在哪个形状、
  什么触发、多长」；原始 XML 只有脚本自己知道要什么，工具无法核对。因此这类页只验证
  「文件能被 PowerPoint 打开 + 读回条数」，逐条验证整类关闭——报告里标 [降级]，
  退出码 2，交付说明里必须如实声明，不得声称这些动画已逐条验证过。

验证（有 PowerPoint COM 时自动执行，这是动画的两道闸门）：
  第 1 层  文件能被 PowerPoint 真打开（坏 XML 会在这一层炸出来）；
  第 2 层  逐条断言声明的每条动画与切换被 PowerPoint 完整解析：效果类型、目标形状名、
           触发方式、时长、切换 EntryEffect 全部与脚本一致——PowerPoint 对坏 timing
           树会静默丢弃，只有数得出、对得上才算存在。只配切换（无对象动画）的页也会
           被验到，不因为「没效果」而跳过。

退出码：0 注入且验证通过；1 验证不一致；2 注入成功但本机无法验证，
        或含原始 XML 动画（逐条断言整类关闭，属检查降级）。
"""
import json
import os
import re
import sys
import zipfile

try:
    from defusedxml.ElementTree import fromstring as _xml_parse
except ImportError:  # pragma: no cover
    import xml.etree.ElementTree as _ET

    def _xml_parse(data):
        return _ET.fromstring(data)

P_NS = "http://schemas.openxmlformats.org/presentationml/2006/main"
MC = "http://schemas.openxmlformats.org/markup-compatibility/2006"
P14 = "http://schemas.microsoft.com/office/powerpoint/2010/main"
P159 = "http://schemas.microsoft.com/office/powerpoint/2015/09/main"

# ================================================================ 菜单

# 方向 → presetSubtype 位码（飞入/擦入共用；探针实测 自底部=4）
DIRECTIONS = {"自顶部": 1, "自右侧": 2, "自底部": 4, "自左侧": 8}

# 菜单表：(presetID, presetClass, 默认时长s, 必须给方向?, 构建器)
# 构建器(spid, ms, 方向, 幅度) -> 行为 XML 列表；模板抄自 PowerPoint COM 生成文件
def _set_vis(ids, spid):
    ids[0] += 1
    return ('<p:set><p:cBhvr><p:cTn id="%d" dur="500" fill="hold">'
            '<p:stCondLst><p:cond delay="0"/></p:stCondLst></p:cTn>'
            '<p:tgtEl><p:spTgt spid="%d"/></p:tgtEl>'
            '<p:attrNameLst><p:attrName>style.visibility</p:attrName></p:attrNameLst>'
            '</p:cBhvr><p:to><p:strVal val="visible"/></p:to></p:set>' % (ids[0], spid))

def _anim_effect(ids, spid, ms, filt):
    ids[0] += 1
    return ('<p:animEffect transition="in" filter="%s">'
            '<p:cBhvr><p:cTn id="%d" dur="%d"/>'
            '<p:tgtEl><p:spTgt spid="%d"/></p:tgtEl></p:cBhvr></p:animEffect>'
            % (filt, ids[0], ms, spid))

def _anim(ids, spid, ms, attr, v0, v1):
    ids[0] += 1
    return ('<p:anim calcmode="lin" valueType="num">'
            '<p:cBhvr additive="base"><p:cTn id="%d" dur="%d" fill="hold"/>'
            '<p:tgtEl><p:spTgt spid="%d"/></p:tgtEl>'
            '<p:attrNameLst><p:attrName>%s</p:attrName></p:attrNameLst></p:cBhvr>'
            '<p:tavLst><p:tav tm="0"><p:val><p:strVal val="%s"/></p:val></p:tav>'
            '<p:tav tm="100000"><p:val><p:strVal val="%s"/></p:val></p:tav></p:tavLst></p:anim>'
            % (ids[0], ms, spid, attr, v0, v1))

def b_appear(ids, spid, ms, d, amp):
    return [_set_vis(ids, spid)]

def b_fade(ids, spid, ms, d, amp):
    return [_set_vis(ids, spid), _anim_effect(ids, spid, ms, "fade")]

# PowerPoint 权威配对：自底部=subtype 4 + wipe(down)（探针实测 AddEffect 默认）；
# 其余方向按同族反演，验证轮用 COM 读回 Direction 校准。
_WIPE_FILT = {4: "down", 1: "up", 2: "left", 8: "right"}

def b_wipe(ids, spid, ms, d, amp):
    return [_set_vis(ids, spid), _anim_effect(ids, spid, ms, "wipe(%s)" % _WIPE_FILT[d])]

# 飞入：起点在画布外（探针实测 自底部 = y 从 1+#ppt_h/2 起）；
# 每个效果都写 x、y 两条 anim（与 PowerPoint 一致，其一为原位空转）
_FLY = {
    4: ("#ppt_x", "1+#ppt_h/2"),   # 自底部: y 从画布下方
    1: ("#ppt_x", "0-#ppt_h/2"),   # 自顶部
    8: ("0-#ppt_w/2", "#ppt_y"),   # 自左侧: x 从画布左方
    2: ("1+#ppt_w/2", "#ppt_y"),   # 自右侧
}

def b_fly(ids, spid, ms, d, amp):
    x0, y0 = _FLY[d]
    out = [_set_vis(ids, spid),
           _anim(ids, spid, ms, "ppt_x", x0, "#ppt_x"),
           _anim(ids, spid, ms, "ppt_y", y0, "#ppt_y")]
    return out

# 浮入：fade + ppt_y 位移 0.1（画布高的 10%）；上浮=presetID 42，下沉=presetID 47
def b_float(ids, spid, ms, d, amp):
    v0 = "#ppt_y+0.1" if d == 4 else "#ppt_y-0.1"
    return [_set_vis(ids, spid), _anim_effect(ids, spid, ms, "fade"),
            _anim(ids, spid, ms, "ppt_y", v0, "#ppt_y")]

# 缩放：宽高从 0 长出 + fade（presetID 53 = 现代 UI 的"缩放"）
def b_zoom(ids, spid, ms, d, amp):
    return [_set_vis(ids, spid),
            _anim(ids, spid, ms, "ppt_w", "0", "#ppt_w"),
            _anim(ids, spid, ms, "ppt_h", "0", "#ppt_h"),
            _anim_effect(ids, spid, ms, "fade")]

# 强调-放大：animScale 放大幅度倍后自动翻转（脉冲一下）
def b_grow(ids, spid, ms, d, amp):
    pct = int(amp * 100000)
    ids[0] += 1
    return ['<p:animScale><p:cBhvr><p:cTn id="%d" dur="%d" autoRev="1" fill="hold"/>'
            '<p:tgtEl><p:spTgt spid="%d"/></p:tgtEl></p:cBhvr>'
            '<p:by x="%d" y="%d"/></p:animScale>' % (ids[0], ms, spid, pct, pct)]

EFFECTS = {
    "出现":   (1, "entr", b_appear, 0.0, False),
    "淡入":   (10, "entr", b_fade, 0.5, False),
    "擦入":   (22, "entr", b_wipe, 0.5, True),
    "飞入":   (2, "entr", b_fly, 0.7, True),
    "浮入":   (None, "entr", b_float, 0.8, True),   # presetID 由方向决定：上浮42/下沉47
    "缩放":   (53, "entr", b_zoom, 0.5, False),
    "强调-放大": (6, "emph", b_grow, 0.5, False),
}
DEFAULT_DIR = {"擦入": 8, "飞入": 4, "浮入": 4}      # 自左侧 / 自底部
FLOAT_PID = {4: 42, 1: 47}                            # 自底部=上浮 / 自顶部=下沉

# 切换：全部按 PowerPoint 的 mc:AlternateContent 包裹（p14 Choice + 旧版 Fallback）
# 探针实测：推入 自底部=dir u、自顶部=d、自左侧=r、自右侧=l（dir=新页移动方向）
_TRANS_DIR = {"自底部": "u", "自顶部": "d", "自左侧": "r", "自右侧": "l"}
# 擦除的 dir 语义与推入**相反**，不能复用上面那张表：COM 探针把 EntryEffect 设成
# 2817/2818/2819/2820 让 PowerPoint 自己写 XML，读回 dir 分别是（省略）/u/r/d，
# 而 EXPECT_TRANS 里 2817=自左侧、2819=自右侧 —— 即 擦除 自左侧需 dir="l"、
# 自右侧需 dir="r"。沿用推入表会把左右写反（注入会读回 2819 ≠ 期望 2817）。
_WIPE_DIR = {"自底部": "u", "自顶部": "d", "自左侧": "l", "自右侧": "r"}
TRANSITIONS = {
    "淡入": (lambda dur, d: '<p:fade thruBlk="0"/>', 0.7),
    "推入": (lambda dur, d: '<p:push dir="%s"/>' % _TRANS_DIR[d], 0.8),
    "擦除": (lambda dur, d: '<p:wipe dir="%s"/>' % _WIPE_DIR[d], 0.8),
    "平滑": ("morph", 1.0),
}

# ================================================================ 编译

def _subtype_for(name, d):
    if name == "缩放":
        return 16   # PowerPoint 往返会把 0 规范化为 16（现代缩放的标准子类型）
    return d if (d and name in ("飞入", "擦入")) else 0

def _effect_par(ids, spid, name, item):
    pid, cls, builder, def_dur, needs_dir = EFFECTS[name]
    ms = int(round(float(item.get("时长", def_dur)) * 1000))
    d = DIRECTIONS.get(item.get("方向", "")) if item.get("方向") else DEFAULT_DIR.get(name)
    if needs_dir and d is None:
        raise ValueError("效果「%s」需要「方向」：%s" % (name, "、".join(DIRECTIONS)))
    if name == "浮入" and item.get("方向") and item["方向"] not in ("自底部", "自顶部"):
        raise ValueError("浮入只支持 自底部（上浮）/ 自顶部（下沉）")
    real_pid = FLOAT_PID[d] if pid is None else pid
    node = item.pop("_node")
    subtype = _subtype_for(name, d)
    behaviors = "".join(builder(ids, spid, ms, d if needs_dir else None,
                                float(item.get("幅度", 1.5))))
    ids[0] += 1
    return ('<p:par><p:cTn id="%d" presetID="%d" presetClass="%s" presetSubtype="%d" '
            'fill="hold" nodeType="%s"><p:stCondLst><p:cond delay="%d"/></p:stCondLst>'
            '<p:childTnLst>%s</p:childTnLst></p:cTn></p:par>'
            % (ids[0], real_pid, cls, subtype, node, item.get("_delay", 0), behaviors)), ms

def compile_page(items, name2id):
    """一组效果声明 -> (timing XML, 统计)。触发分组建组，组内按 同时/之后 排布。"""
    ids = [2]  # id 计数器（1 给 tmRoot，2 给 mainSeq，效果从 3 起）
    groups = []   # 每组: {"auto": bool, "items": [...]}
    for it in items:
        trg = it.get("触发", "点击")
        if trg not in ("点击", "同时", "之后", "自动"):
            raise ValueError("触发只能是 点击/同时/之后/自动，收到：%r" % trg)
        if trg in ("点击", "自动"):
            groups.append({"auto": trg == "自动", "items": [dict(it, _node="clickEffect" if trg == "点击" else "afterEffect")]})
        else:
            if not groups:
                raise ValueError("「%s」之前没有可依附的效果——第一个效果用 点击 或 自动" % trg)
            groups[-1]["items"].append(dict(it, _node="withEffect" if trg == "同时" else "afterEffect"))

    pars, n_effects, n_clicks, total_ms = [], 0, 0, 0
    for g in groups:
        inner, cursor, first = [], 0, True
        n_clicks += 0 if g["auto"] else 1
        for item in g["items"]:
            shape = item.get("形状")
            if not shape:
                raise ValueError("效果缺「形状」：%r" % item)
            if shape not in name2id:
                raise ValueError("形状「%s」不存在（本页有：%s）" % (shape, "、".join(sorted(name2id))))
            name = item.get("效果")
            if name not in EFFECTS:
                raise ValueError("效果「%s」不在菜单里。可选：%s" % (name, "、".join(EFFECTS)))
            if first:
                item["_delay"] = 0
            elif item["_node"] == "withEffect":
                item["_delay"] = 0            # 与本组第一条同时起
            else:                             # afterEffect：接在前面的时长之后
                item["_delay"] = cursor
            par, ms = _effect_par(ids, name2id[shape], name, item)
            inner.append(par)
            n_effects += 1
            cursor += ms
            total_ms += ms
            first = False
        gid = ids[0] + 1
        ids[0] += 1
        cond = "0" if g["auto"] else "indefinite"
        pars.append('<p:par><p:cTn id="%d" fill="hold"><p:stCondLst><p:cond delay="%s"/>'
                    '</p:stCondLst><p:childTnLst><p:par><p:cTn id="%d" fill="hold">'
                    '<p:stCondLst><p:cond delay="0"/></p:stCondLst><p:childTnLst>%s'
                    '</p:childTnLst></p:cTn></p:par></p:childTnLst></p:cTn></p:par>'
                    % (gid, cond, gid + 1, "".join(inner)))
        ids[0] += 1
    if not pars:
        return None, {"effects": 0, "clicks": 0, "ms": 0}
    timing = ('<p:timing><p:tnLst><p:par><p:cTn id="1" dur="indefinite" restart="never" '
              'nodeType="tmRoot"><p:childTnLst><p:seq concurrent="1" nextAc="seek">'
              '<p:cTn id="2" dur="indefinite" nodeType="mainSeq"><p:childTnLst>%s'
              '</p:childTnLst></p:cTn><p:prevCondLst><p:cond evt="onPrev" delay="0">'
              '<p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:prevCondLst>'
              '<p:nextCondLst><p:cond evt="onNext" delay="0"><p:tgtEl><p:sldTgt/>'
              '</p:tgtEl></p:cond></p:nextCondLst></p:seq></p:childTnLst></p:cTn>'
              '</p:par></p:tnLst></p:timing>' % "".join(pars))
    return timing, {"effects": n_effects, "clicks": n_clicks, "ms": total_ms}

def compile_transition(name, spec):
    if name not in TRANSITIONS:
        raise ValueError("切换「%s」不在菜单里。可选：%s" % (name, "、".join(TRANSITIONS)))
    builder, def_dur = TRANSITIONS[name]
    d = spec.get("方向", "自底部")
    dur = float(spec.get("时长", def_dur))
    ms = int(round(dur * 1000))
    if builder == "morph":
        return ('<mc:AlternateContent xmlns:mc="%s" xmlns:p159="%s">'
                '<mc:Choice Requires="p159"><p:transition spd="slow" xmlns:p14="%s" '
                'p14:dur="%d"><p159:morph option="byObject"/></p:transition></mc:Choice>'
                '<mc:Fallback><p:transition spd="slow"><p:fade/></p:transition>'
                '</mc:Fallback></mc:AlternateContent>' % (MC, P159, P14, ms))
    if d not in _TRANS_DIR:
        raise ValueError("切换方向只能是 %s，收到：%r" % ("、".join(_TRANS_DIR), d))
    effect = builder(ms, d)
    return ('<mc:AlternateContent xmlns:mc="%s">'
            '<mc:Choice xmlns:p14="%s" Requires="p14"><p:transition spd="slow" p14:dur="%d">'
            '%s</p:transition></mc:Choice><mc:Fallback><p:transition spd="slow">%s'
            '</p:transition></mc:Fallback></mc:AlternateContent>' % (MC, P14, ms, effect, effect))

# ================================================================ 注入

def slide_names(xml_bytes):
    """slide XML -> {形状名: spid}。重名直接报错（按名定位的前提是名字唯一）。"""
    root = _xml_parse(xml_bytes)
    names = {}
    for el in root.iter():
        if el.tag == "{%s}cNvPr" % P_NS:
            nm, i = el.get("name") or "", el.get("id")
            if nm:
                if nm in names:
                    raise ValueError("形状名「%s」在本页出现多次，改成唯一名字（objectName）" % nm)
                names[nm] = int(i)
    return names

def strip_anim(slide_xml):
    slide_xml = re.sub(r"<p:timing>.*?</p:timing>", "", slide_xml, flags=re.S)
    slide_xml = re.sub(r'<mc:AlternateContent[^>]*>(?:(?!</mc:AlternateContent>).)*'
                       r"<p:transition.*?</mc:AlternateContent>", "", slide_xml, flags=re.S)
    slide_xml = re.sub(r"<p:transition[^>]*/>", "", slide_xml)
    return slide_xml

# ---- 原始XML 逃生舱：默认关闭，三重闸门 + 写入前校验（见文件头说明）----

RAW_ROOT = "{%s}timing" % P_NS
RAW_MENU_HINT = ("原始 XML 是逃生舱，默认关闭。动画一律走菜单路线（pages 里写"
                 "「形状/效果/触发」）；确实要做菜单外的效果、且用户已明确同意，"
                 "才给命令加 --raw，并在脚本里写「用户已同意」: true 与「原因」。")
# 片段通常不带命名空间声明（声明在 slide 根元素上），解析校验时按需补齐
NS_DECL = {
    "p": P_NS,
    "a": "http://schemas.openxmlformats.org/drawingml/2006/main",
    "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
    "mc": MC,
    "p14": P14,
    "p159": P159,
}

def slide_ids(xml_bytes):
    """slide XML -> 本页全部形状 id（原始 XML 引用的 spid 必须落在其中）。"""
    root = _xml_parse(xml_bytes)
    return {int(el.get("id")) for el in root.iter("{%s}cNvPr" % P_NS)
            if (el.get("id") or "").isdigit()}

def _frag_root(xml_text):
    """解析片段取根元素；未声明前缀（unbound prefix）时补上标准声明再解析。"""
    try:
        return _xml_parse(xml_text.encode("utf-8"))
    except Exception as e:
        if "unbound prefix" not in str(e):
            raise
        m = re.match(r"\s*<([A-Za-z0-9]+):([A-Za-z0-9._-]+)([^>]*)>", xml_text)
        if not m:
            raise
        head = m.group(0)
        used = {t for t in re.findall(r"</?([A-Za-z0-9]+):", xml_text) if t}
        used |= {t for t in re.findall(r"\s([A-Za-z0-9]+):[A-Za-z0-9._-]+=", xml_text) if t}
        decls = "".join(' xmlns:%s="%s"' % (k, v) for k, v in sorted(NS_DECL.items())
                        if k in used and ("xmlns:%s=" % k) not in head)
        return _xml_parse((xml_text[:m.end() - 1] + decls + xml_text[m.end() - 1:]).encode("utf-8"))

def validate_raw(si, entry, ids):
    """校验一条原始 XML。任一不合格都在写入前退出，文件保持原样。"""
    if not isinstance(entry, dict):
        sys.exit("S%d 原始XML 的每条必须是对象（XML / 原因 / 用户已同意）：%s" % (si, RAW_MENU_HINT))
    if entry.get("用户已同意") is not True:
        sys.exit("S%d 原始XML 缺「用户已同意」: true——未经用户同意不得手写 XML。%s"
                 % (si, RAW_MENU_HINT))
    reason = entry.get("原因")
    if not isinstance(reason, str) or not reason.strip():
        sys.exit("S%d 原始XML 必须写「原因」（菜单为什么做不到、用户怎么说的）" % si)
    xml_text = entry.get("XML")
    if not isinstance(xml_text, str) or not xml_text.strip():
        sys.exit("S%d 原始XML 缺「XML」字符串" % si)
    if "<!DOCTYPE" in xml_text or "<!ENTITY" in xml_text:
        sys.exit("S%d 原始XML 含 DOCTYPE/ENTITY 声明——不接受，去掉后重跑" % si)
    try:
        root = _frag_root(xml_text)
    except Exception as e:
        sys.exit("S%d 原始XML 解析失败：%s" % (si, str(e)[:120]))
    if root.tag != RAW_ROOT:
        sys.exit("S%d 原始XML 的根元素是 %s，只接受 <p:timing>（对象动画）"
                 "——切换与其他元素不许手写" % (si, root.tag))
    dangling = {int(m) for m in re.findall(r'<p:spTgt spid="(\d+)"', xml_text)} - ids
    if dangling:
        sys.exit("S%d 原始XML 引用了本页不存在的形状 id %s——PowerPoint 会静默丢弃"
                 "这类动画，先改对 spid 再跑" % (si, sorted(dangling)))
    return xml_text

def inject(src, sc, replace=False, allow_raw=False):
    trans_spec = sc.get("transitions", {})
    pages_spec = sc.get("pages", {})
    raw_spec = sc.get("原始XML", {})
    if not isinstance(trans_spec, dict) or not isinstance(pages_spec, dict) \
            or not isinstance(raw_spec, dict):
        sys.exit("脚本结构：transitions/pages/原始XML 必须是对象，页码是字符串键")
    if raw_spec and not allow_raw:
        sys.exit(RAW_MENU_HINT)
    both = set(map(str, pages_spec)) & set(map(str, raw_spec))
    if both:
        sys.exit("S%s 同时出现在 pages 和原始XML 里——一页只能有一条 timing，二选一"
                 % "、".join(sorted(both)))

    with zipfile.ZipFile(src) as zf:
        entries = [(i, zf.read(i.filename)) for i in zf.infolist()]
    slide_files = sorted({i.filename for i, _ in entries
                          if re.fullmatch(r"ppt/slides/slide\d+\.xml", i.filename)},
                         key=lambda n: int(re.search(r"(\d+)", n).group(1)))
    n_slides = len(slide_files)

    replaced, stats, raw_used = {}, {}, []
    data = {i.filename: b for i, b in entries}
    for fn in slide_files:
        si = int(re.search(r"(\d+)", fn).group(1))
        xml = data[fn].decode("utf-8")
        if "<p:timing>" in xml or "p:transition" in xml:
            if not replace:
                sys.exit("S%d 已有动画——从原始无动画文件注入，或加 --replace 覆盖" % si)
            xml = strip_anim(xml)
        frag = ""
        if str(si) in trans_spec:
            spec = trans_spec[str(si)]
            if isinstance(spec, str):
                spec = {"效果": spec}
            frag += compile_transition(spec["效果"], spec)
        if str(si) in pages_spec:
            names = slide_names(xml.encode("utf-8"))
            if not names:
                sys.exit("S%d 没有任何命名形状，脚本却要给它配动画" % si)
            timing, st = compile_page(pages_spec[str(si)], names)
            frag += timing or ""
            stats[si] = st
        if str(si) in raw_spec:
            frag += validate_raw(si, raw_spec[str(si)], slide_ids(xml.encode("utf-8")))
            raw_used.append(si)
        if frag:
            if "</p:sld>" not in xml:
                sys.exit("S%d 结构异常：找不到 </p:sld>（不是正常 pptxgenjs 产物？）" % si)
            xml = xml.replace("</p:sld>", frag + "</p:sld>")
            if str(si) in raw_spec:
                # 手写片段还要让整页解析通过：抓未声明前缀、标签没闭合这类结构错
                try:
                    _xml_parse(xml.encode("utf-8"))
                except Exception as e:
                    sys.exit("S%d 原始XML 拼进整页后解析失败：%s——多半是片段用了 slide 根元素"
                             "没声明的命名空间前缀，补上 xmlns:xx=\"…\" 再跑" % (si, str(e)[:120]))
            data[fn] = xml.encode("utf-8")
            replaced[si] = True

    if not replaced:
        sys.exit("脚本里没有任何可注入的页——检查 transitions/pages/原始XML 的页码")

    tmp = src + ".anim_tmp"
    with zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as zf:
        for i, _ in entries:
            zf.writestr(i.filename, data[i.filename])
    os.replace(tmp, src)

    print("已注入 %d 页动画：" % len(replaced))
    for si in sorted(stats):
        st = stats[si]
        print("  S%d：%d 条效果 · %d 组点击 · 总时长 %.1fs" % (si, st["effects"], st["clicks"], st["ms"] / 1000))
    for si in sorted(replaced):
        if si not in stats and si not in raw_used:
            print("  S%d：切换效果" % si)
    if raw_used:
        print("⚠ 原始XML 逃生舱：S%s 用的是手写 XML——逐条效果断言整类关闭（[降级]），"
              "交付说明必须声明这部分动画未经逐条验证"
              % "、".join(str(s) for s in sorted(raw_used)))
    return sorted(replaced), sorted(raw_used)

# ================================================================ COM 验证

# 菜单效果 -> (期望 EffectType, 方向是否可读)；触发 -> 期望 TriggerType
EXPECT_ET = {"出现": 1, "淡入": 10, "擦入": 22, "飞入": 2, "缩放": 48, "强调-放大": 59}
EXPECT_ET_FLOAT = {42: 39, 47: 42}          # presetID(上浮/下沉) -> msoAnimEffect
TRG_NODE = {"点击": "clickEffect", "同时": "withEffect",
            "之后": "afterEffect", "自动": "afterEffect"}
EXPECT_TRG = {"clickEffect": 1, "withEffect": 2, "afterEffect": 3}
# 本机 COM 读不到 EffectInformation.Direction（返回 None），方向改用"往返校验"：
# 让 PowerPoint 把注入文件另存一遍，若它重序列化的 presetID/subtype/filter 与
# 注入一致，说明方向编码被模型完整理解并保留。
ANIM_FILT = {"淡入": "fade", "浮入": "fade", "缩放": "fade"}
# 切换 -> 期望 EntryEffect（探针实测；推入/擦除随方向）
EXPECT_TRANS = {
    ("淡入", None): 3849,   # 普通淡入（1793 是"透过黑淡出"，菜单不用）
    ("推入", "自底部"): 3855, ("推入", "自顶部"): 3852,
    ("推入", "自左侧"): 3853, ("推入", "自右侧"): 3854,
    ("擦除", "自底部"): 2818, ("擦除", "自顶部"): 2820,
    ("擦除", "自左侧"): 2817, ("擦除", "自右侧"): 2819,
    ("平滑", None): 3954,
}

def _rt_dump(path):
    """往返保存的文件 -> {页码: ([(presetID, class, subtype)...], [滤镜...])}"""
    zf = zipfile.ZipFile(path)
    out = {}
    for n in zf.namelist():
        m = re.fullmatch(r"ppt/slides/slide(\d+)\.xml", n)
        if not m:
            continue
        xml = zf.read(n).decode("utf-8")
        effs = re.findall(r'presetID="(\d+)" presetClass="(\w+)" presetSubtype="(-?\d+)"', xml)
        filts = re.findall(r'<p:animEffect transition="in" filter="([^"]+)"', xml)
        out[int(m.group(1))] = (effs, filts)
    zf.close()
    return out


def verify(src, sc, pages, probe=False):
    try:
        from win32com.client import gencache
        app = gencache.EnsureDispatch("PowerPoint.Application").Application
    except Exception:
        import win32com.client
        app = win32com.client.Dispatch("PowerPoint.Application")
    try:
        app.DisplayAlerts = 1
    except Exception:
        pass
    we = False
    pres = None
    try:
        pres = app.Presentations.Open(os.path.abspath(src), ReadOnly=True, WithWindow=False)
    except Exception as e:
        print("✗ 第 1 层失败：PowerPoint 打不开这个文件：%s" % str(e)[:120])
        return False
    finally:
        pass
    ok = True
    degraded = []
    try:
        print(f"  （验证器：{app.Name} {app.Version}.{app.Build}"
              + "；12.x = WPS 兼容层，验证强度弱于真 PowerPoint）")
        trans_spec = sc.get("transitions", {})
        raw_spec = sc.get("原始XML", {})
        for si in pages:
            sl = pres.Slides(si)
            seq = sl.TimeLine.MainSequence
            if str(si) in raw_spec:
                # 手写 XML 没有声明清单可比对：只报读回条数，逐条断言整类关闭（[降级]）
                degraded.append(si)
                print("  [降级] S%d 原始XML：读回 %d 条动画，无逐条断言可比对"
                      "（菜单路线才有）——不得声称这些动画已逐条验证" % (si, seq.Count))
                continue
            items = sc.get("pages", {}).get(str(si), [])
            want = len(items)
            got = seq.Count
            tag = []
            if got != want:
                ok = False
                tag.append("效果数 %d ≠ 脚本 %d（PowerPoint 可能静默丢弃了坏的 timing 树）" % (got, want))
            for k in range(1, min(got, want) + 1):
                eff = seq(k)
                item = items[k - 1]
                name = item.get("效果", "?")
                real_pid = FLOAT_PID.get(DIRECTIONS.get(item.get("方向", "自底部"),
                                                        DEFAULT_DIR.get(name, 0)), 0) \
                    if name == "浮入" else EFFECTS.get(name, (0,))[0]
                exp_et = EXPECT_ET_FLOAT.get(real_pid, EXPECT_ET.get(name))
                try:
                    et = int(eff.EffectType)
                except Exception:
                    et = None
                try:
                    nm = eff.Shape.Name
                except Exception:
                    nm = "?"
                try:
                    trg = int(eff.Timing.TriggerType)
                except Exception:
                    trg = None
                try:
                    dur = round(float(eff.Timing.Duration), 2)
                except Exception:
                    dur = None
                try:
                    dirv = int(eff.EffectInformation.Direction)
                except Exception:
                    dirv = None
                node = TRG_NODE.get(item.get("触发", "点击"), "clickEffect")
                exp_trg = EXPECT_TRG.get(node)
                if probe:
                    print("  [probe] S%d #%d %-6s ET=%s(期望%s) Trg=%s(期望%s) dur=%s 形状=%s(%s) Dir=%s"
                          % (si, k, name, et, exp_et, trg, exp_trg, dur,
                             item.get("形状"), nm, dirv))
                    continue
                if et is not None and exp_et is not None and et != exp_et:
                    ok = False
                    tag.append("#%d %s 效果类型读回 %s ≠ 期望 %s" % (k, name, et, exp_et))
                if nm != item.get("形状"):
                    ok = False
                    tag.append("#%d 打在形状「%s」上，脚本要的是「%s」" % (k, nm, item.get("形状")))
                if trg is not None and exp_trg is not None and trg != exp_trg:
                    ok = False
                    tag.append("#%d 触发方式读回 %s ≠ 期望 %s" % (k, trg, exp_trg))
                declared = float(item.get("时长", EFFECTS.get(name, (0, 0, 0, 0.5))[3] if name in EFFECTS else 0.5))
                if dur is not None and name != "出现" and abs(dur - declared) > 0.06:
                    ok = False
                    tag.append("#%d 时长读回 %.2fs ≠ 声明 %.2fs" % (k, dur, declared))
            # 切换
            tspec = trans_spec.get(str(si))
            if tspec:
                tname = tspec if isinstance(tspec, str) else tspec.get("效果", "?")
                tdir = None if isinstance(tspec, str) else tspec.get("方向")
                try:
                    ee = int(sl.SlideShowTransition.EntryEffect)
                except Exception:
                    ee = None
                exp_ee = EXPECT_TRANS.get((tname, tdir))
                if probe:
                    print("  [probe] S%d 切换 %-4s EntryEffect=%s（期望 %s）" % (si, tname, ee, exp_ee))
                elif exp_ee is not None and ee is not None and ee != exp_ee:
                    ok = False
                    tag.append("切换 %s 读回 %s ≠ 期望 %s" % (tname, ee, exp_ee))
                elif exp_ee is not None and ee is not None:
                    print("  ✓ S%d 切换 %s 读回一致（EntryEffect %s）" % (si, tname, ee))
            if tag:
                for t in tag:
                    print("  ✗ S%d %s" % (si, t))
            else:
                print("  ✓ S%d %d 条效果与脚本逐条一致" % (si, got))
        # 往返校验：让 PowerPoint 把文件另存一遍，用它重新序列化的结果确认
        # 方向位码与滤镜被动画模型完整保留（Direction 属性本机读不到，这是替代路）
        import tempfile
        import shutil
        rt = None
        tmpdir = None
        try:
            tmpdir = tempfile.mkdtemp(prefix="anim_rt_")
            pres.SaveAs(os.path.join(tmpdir, "rt.pptx"), 24)  # ppSaveAsOpenXMLPresentation
            rt = _rt_dump(os.path.join(tmpdir, "rt.pptx"))
        except Exception as e:
            print("  ⚠ 往返校验跳过：%s" % str(e)[:80])
        finally:
            if tmpdir:
                shutil.rmtree(tmpdir, ignore_errors=True)
        if rt:
            for si in pages:
                items = sc.get("pages", {}).get(str(si), [])
                if not items:
                    continue
                want_pid, want_filt = [], []
                for item in items:
                    name = item.get("效果")
                    pid, _cls, _b, _dd, _nd = EFFECTS[name]
                    d = DIRECTIONS.get(item.get("方向", "")) if item.get("方向") \
                        else DEFAULT_DIR.get(name)
                    real_pid = FLOAT_PID.get(d, 42) if pid is None else pid
                    sub = _subtype_for(name, d)
                    want_pid.append((str(real_pid), str(sub)))
                    f = "wipe(%s)" % _WIPE_FILT.get(d, "") if name == "擦入" \
                        else ANIM_FILT.get(name)
                    if f:
                        want_filt.append(f)
                got_pid, got_filt = rt.get(si, ([], []))
                got_pairs = [(x[0], x[2]) for x in got_pid]
                if got_pairs != want_pid:
                    ok = False
                    print("  ✗ S%d 往返不一致：PowerPoint 序列化的 (presetID,subtype)=%s "
                          "≠ 注入 %s（方向编码未被模型按原样保留）" % (si, got_pairs, want_pid))
                if got_filt != want_filt:
                    ok = False
                    print("  ✗ S%d 往返滤镜不一致：%s ≠ %s" % (si, got_filt, want_filt))
                elif got_pid and got_pairs == want_pid and got_filt == want_filt:
                    print("  ✓ S%d 往返校验一致（方向编码被 PowerPoint 原样保留）" % si)
        if not pages:
            print("（脚本没有对象动画，只验证了文件能打开）")
    finally:
        pres.Close()
        try:
            if app.Presentations.Count == 0:
                app.Quit()
        except Exception:
            pass
    return ok, degraded

# ================================================================ main

def main():
    known = {"--no-verify", "--probe", "--replace", "--raw"}
    for a in sys.argv[1:]:
        if a.startswith("--") and a.split("=", 1)[0] not in known:
            sys.exit(f"未知参数 {a.split('=', 1)[0]}；可用：{' '.join(sorted(known))}")
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    flags = {a for a in sys.argv[1:] if a.startswith("--")}
    if len(args) != 2:
        sys.exit(__doc__)
    src, script = args
    if not os.path.exists(src):
        sys.exit("找不到文件：" + src)
    try:
        with open(script, encoding="utf-8") as f:
            sc = json.load(f)
    except Exception as e:
        sys.exit("脚本 %s 读不了：%s" % (script, e))
    try:
        menu_pages, raw_pages = inject(src, sc, replace="--replace" in flags,
                                       allow_raw="--raw" in flags)
    except ValueError as e:
        sys.exit(str(e))
    pages = sorted(set(menu_pages) | set(raw_pages))   # 只配切换的页也要验（含 EntryEffect）
    if "--no-verify" in flags:
        print("⚠ 已注入但跳过验证（--no-verify）——动画未经 PowerPoint 确认")
        return 2
    try:
        import win32com.client  # noqa: F401
        have_com = sys.platform == "win32"
    except ImportError:
        have_com = False
    if not have_com:
        print("⚠ 本机没有 PowerPoint COM，无法验证——动画已注入但未经确认")
        return 2
    ok, degraded = verify(src, sc, pages, probe="--probe" in flags)
    if not ok:
        return 1
    return 2 if degraded else 0

if __name__ == "__main__":
    sys.exit(main())
