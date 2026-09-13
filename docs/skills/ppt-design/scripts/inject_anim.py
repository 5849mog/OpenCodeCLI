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
        {"形状": "标题", "效果": "浮入", "触发": "自动", "方向": "自底部"},
        {"形状": "论点一", "效果": "浮入", "触发": "之后", "方向": "自底部"},
        {"形状": "论点二", "效果": "浮入", "触发": "之后", "方向": "自底部"},
        {"形状": "柱状图", "效果": "擦入", "触发": "之后", "方向": "自左侧", "时长": 1.0}
      ]
    }
  }
  形状 = 施工时 pptxgenjs 的 objectName；触发 = 点击/同时/之后/自动（翻页后自动播）

  **默认写法就是上面这样：首条「自动」（翻到这一页即起播）+ 其余「之后」自动接续，
  页内 0 点击——断点在翻页，不在页内。** 观众/演讲者只需要翻页，一页自己的动画会
  播完再等人。「点击」是例外：只在必须停下时用（提问、等听众反应），并写进规格书
  「动画」行的理由里；qa 对页内出现点击告警。切换用「自动」的页配合首条「自动」，
  翻页即无缝起播。

  每个效果还可以给「缓动」：线性 / 缓入 / 缓出 / 缓入缓出（默认「缓入缓出」，
  「出现」是瞬时的、固定线性）。缓动不改效果名，只改运动曲线——线性运动是机械/
  廉价观感的主要来源。一般不用写，走默认即好。
  切换「平滑」还可以给「选项」：按对象（默认，同一个名字的元素自己走过去）／按词／按字（文字逐词或逐字变形）。
  效果与切换的完整菜单、默认时长、缓动刻度见下方 EFFECTS / TRANSITIONS / EASE 三张表。

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
  「断言」（可选，强烈建议写）——手写页默认只验「文件能打开 + 读回条数」（标 [降级]、
  退出码 2）。附上「断言」清单就把逐条核对补回来：逐条核对 形状 / presetID /
  presetSubtype / 起始ms / 时长ms / 重复 / 参数，并与 COM 读回的
  Timing.TriggerDelayTime 与 Duration 交叉核对。**必须覆盖该页全部效果**（只声明一部分
  等于没查），书写顺序**按页内出现顺序**（同一形状有多个效果时靠顺序配对）：
    "原始XML": {
      "4": {"XML": "<p:timing>…</p:timing>", "原因": "…", "用户已同意": true,
            "断言": [
              {"形状": "光子", "效果": "匀速位移", "presetID": 2,
               "起始ms": 0, "时长ms": 3000,
               "参数": {"tav": ["#ppt_x", "#ppt_x+0.8687", "#ppt_y", "#ppt_y"]}},
              {"形状": "轴端", "presetID": 8, "起始ms": 3000, "时长ms": 600,
               "参数": {"animRot": "21600000"}},
              {"形状": "斜带", "presetID": 6, "起始ms": 3000, "时长ms": 500, "重复": 2000}
            ]}
    }
  字段：形状（必填）／效果（只用于报告可读）／presetID／presetSubtype／起始ms／时长ms／
  重复（repeatCount）／参数（animRot、animScale、tav、滤镜）；容差 30ms。未知字段直接报错。
  「起始ms」是**组内相对**起始（与 COM 的 TriggerDelayTime 同口径）。**不要去累加往返后
  文件里的 XML 延迟来比**——PowerPoint 会重写节拍的嵌套编码（实测把 800ms 写成
  「包装节点 1000 + 效果 800」），只有 COM 的 TriggerDelayTime 是权威口径。

验证（有 PowerPoint COM 时自动执行，这是动画的两道闸门）：
  第 1 层  文件能被 PowerPoint 真打开（坏 XML 会在这一层炸出来）；
  第 2 层  逐条断言声明的每条动画与切换被 PowerPoint 完整解析：效果类型、目标形状名、
           触发方式、时长、缓动（Timing.Accelerate/Decelerate）、切换 EntryEffect 全部
           与脚本一致——PowerPoint 对坏 timing 树会静默丢弃，只有数得出、对得上才算存在。
           只配切换（无对象动画）的页也会被验到，不因为「没效果」而跳过。

退出码：0 注入且验证通过；1 验证不一致；2 注入成功但本机无法验证，
        或含原始 XML 动画（逐条断言整类关闭，属检查降级）。
"""
import hashlib
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

# 脚本自己的内容哈希：技能脚本会被拷进工作目录，副本静默过期没有任何症状
# （实测发生过：拷的是 591 行的旧版，真源当天已到 795 行，于是 --raw 报「未知参数」、
# 闸门口径也对不上）。打进报告，交付时能与真源对照。
try:
    _SELF_SHA = hashlib.sha1(open(__file__, "rb").read()).hexdigest()[:8]
except Exception:
    _SELF_SHA = "?"
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

# 缓动：PowerPoint「平滑开始 / 平滑结束」两个刻度，编译成效果级 p:cTn 的 accel/decel。
# 探针实测（anim_probe/probe_ease.py → probe_ease.pptx，PowerPoint 自己另存的文件）：
#   COM 属性 Timing.Accelerate / Decelerate 是 0–1 浮点，写进 XML 时 ×100000，
#   位置在 presetSubtype 之后、fill 之前；取 0 时该属性不写。
#   SmoothStart/SmoothEnd（MsoTriState）是同一对刻度的开关形态，置真即 50000。
# 它不改效果名，只改运动曲线——线性运动是"机械/廉价感"的主要来源，这是唯一的动效质量参数。
EASE = {
    "线性":     (0, 0),
    "缓入":     (50000, 0),        # 起步慢（accel）
    "缓出":     (0, 50000),        # 收尾慢（decel）
    "缓入缓出": (50000, 50000),     # 默认
}
DEFAULT_EASE = {"出现": "线性"}     # 出现是瞬时效果（时长 0），加缓动没有意义
EASE_FALLBACK = "缓入缓出"

def _ease_of(name, item):
    """该效果实际用的缓动名与 (accel, decel)。菜单给默认值，声明里的「缓动」可覆盖。"""
    ename = item.get("缓动", DEFAULT_EASE.get(name, EASE_FALLBACK))
    if ename not in EASE:
        raise ValueError("缓动「%s」不在菜单里。可选：%s" % (ename, "、".join(EASE)))
    if name == "出现" and EASE[ename] != (0, 0):
        raise ValueError("「出现」是瞬时效果（时长 0），加缓动没有意义——去掉「缓动」或改成「线性」")
    return ename, EASE[ename]

def _ease_attrs(pair):
    a, d = pair
    s = ""
    if a:
        s += ' accel="%d"' % a
    if d:
        s += ' decel="%d"' % d
    return s

def _ease_key(attrs):
    """accel/decel 属性串 -> 可比较的 "accel/decel"（缺项记 0）——往返校验用。"""
    a = re.search(r'accel="(\d+)"', attrs or "")
    d = re.search(r'decel="(\d+)"', attrs or "")
    return "%s/%s" % (a.group(1) if a else "0", d.group(1) if d else "0")

# 切换：全部按 PowerPoint 的 mc:AlternateContent 包裹（p14 Choice + 旧版 Fallback）
#
# 方向表**两张，不能混用**——`p:push` 与 `p:wipe` 的 dir 约定不同。两张都是探针实测：
# 把 EntryEffect 设成以下枚举值让 PowerPoint 自己写 XML，再读回 dir。
#   擦除(p:wipe)：2817 WipeLeft→(省略，即默认 "l")、2818 WipeUp→u、
#                 2819 WipeRight→r、2820 WipeDown→d
#   推入(p:push)：3852 PushDown→d、3853 PushLeft→r、3854 PushRight→l、3855 PushUp→u
# 枚举名与数值取自类型库（`ppEffectWipeLeft=2817 … ppEffectPushUp=3855`，
# `ppEffectFadeSmoothly=3849`、`ppEffectMorphByObject=3954`），用于核对 EXPECT_TRANS。
#
# ⚠ 已知未闭合项：**中文标签 ↔ 屏幕视觉方向**没有实测过（PNG 看不到切换，本机也无法
#   逐帧看）。上面记的是「标签 ↔ 枚举名 ↔ dir」这条链，若要确认「标着自左侧的到底是不是
#   从左边擦入」，需要在 PowerPoint 里把四个方向各放一次、亲眼看一遍并回填结论。
# 平滑(morph)的「选项」= p159:morph 的 option 属性；探针实测三个值被 PowerPoint 认，
# 读回 EntryEffect 分别 3954/3955/3956（与类型库 MorphByObject/ByWord/ByChar 一致）。
MORPH_OPT = {"按对象": "byObject", "按词": "byWord", "按字": "byChar"}
MORPH_EE = {"byObject": 3954, "byWord": 3955, "byChar": 3956}
_TRANS_DIR = {"自底部": "u", "自顶部": "d", "自左侧": "r", "自右侧": "l"}
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
    ename, pair = _ease_of(name, item)
    behaviors = "".join(builder(ids, spid, ms, d if needs_dir else None,
                                float(item.get("幅度", 1.5))))
    ids[0] += 1
    meta = (str(real_pid), str(subtype), _ease_key(_ease_attrs(pair)), item.get("_delay", 0))
    return ('<p:par><p:cTn id="%d" presetID="%d" presetClass="%s" presetSubtype="%d"%s '
            'fill="hold" nodeType="%s"><p:stCondLst><p:cond delay="%d"/></p:stCondLst>'
            '<p:childTnLst>%s</p:childTnLst></p:cTn></p:par>'
            % (ids[0], real_pid, cls, subtype, _ease_attrs(pair), node,
               item.get("_delay", 0), behaviors)), ms, ename, meta

def compile_page(items, name2id):
    """一组效果声明 -> (timing XML, 统计)。

    分组的判据就是「触发」：**点击 / 自动 = 开一个新组，同时 / 之后 = 并进上一组**。
    所以"一次点击出几个"＝"这一组里放几条"——逐条声明，每页独立，没有全局默认。
    组内排布：第一条从 0 起；「同时」与本组第一条同时起；「之后」接在**此前所有
    已结束的效果**最后一刻之后（不是简单累加，否则「同时」的时长会被重复计入）。
    """
    ids = [2]  # id 计数器（1 给 tmRoot，2 给 mainSeq，效果从 3 起）
    groups = []   # 每组: {"auto": bool, "items": [...]}
    for it in items:
        unknown = [k for k in it if k not in ITEM_FIELDS]
        if unknown:
            raise ValueError("效果声明里有未知字段 %s；可用：%s"
                             "（「断言」只给原始XML 逃生舱页用——菜单路线自带逐条验证）"
                             % ("、".join(unknown), "、".join(ITEM_FIELDS)))
        trg = it.get("触发", "点击")
        if trg not in ("点击", "同时", "之后", "自动"):
            raise ValueError("触发只能是 点击/同时/之后/自动，收到：%r" % trg)
        if trg in ("点击", "自动"):
            groups.append({"auto": trg == "自动", "items": [dict(it, _node="clickEffect" if trg == "点击" else "afterEffect")]})
        else:
            if not groups:
                raise ValueError("「%s」之前没有可依附的效果——第一个效果用 点击 或 自动" % trg)
            groups[-1]["items"].append(dict(it, _node="withEffect" if trg == "同时" else "afterEffect"))

    pars, n_effects, n_clicks, eases, gstats = [], 0, 0, {}, []
    for g in groups:
        inner, max_end, first = [], 0, True
        n_clicks += 0 if g["auto"] else 1
        g_members, g_start, g_end, g_meta = [], 0, 0, []
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
            else:                             # afterEffect：接在此前所有效果结束之后
                item["_delay"] = max_end
            par, ms, ename, meta = _effect_par(ids, name2id[shape], name, item)
            inner.append(par)
            n_effects += 1
            eases[ename] = eases.get(ename, 0) + 1
            g_members.append(shape)
            g_meta.append(meta)
            g_end = max(g_end, item["_delay"] + ms)
            max_end = max(max_end, item["_delay"] + ms)
            first = False
        gstats.append({"auto": g["auto"], "members": g_members,
                       "ms": g_end - g_start, "meta": g_meta})
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
        return None, {"effects": 0, "clicks": 0, "ms": 0, "eases": {}, "groups": []}
    timing = ('<p:timing><p:tnLst><p:par><p:cTn id="1" dur="indefinite" restart="never" '
              'nodeType="tmRoot"><p:childTnLst><p:seq concurrent="1" nextAc="seek">'
              '<p:cTn id="2" dur="indefinite" nodeType="mainSeq"><p:childTnLst>%s'
              '</p:childTnLst></p:cTn><p:prevCondLst><p:cond evt="onPrev" delay="0">'
              '<p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:prevCondLst>'
              '<p:nextCondLst><p:cond evt="onNext" delay="0"><p:tgtEl><p:sldTgt/>'
              '</p:tgtEl></p:cond></p:nextCondLst></p:seq></p:childTnLst></p:cTn>'
              '</p:par></p:tnLst></p:timing>' % "".join(pars))
    return timing, {"effects": n_effects, "clicks": n_clicks,
                    "ms": max((g["ms"] for g in gstats), default=0),
                    "eases": eases, "groups": gstats}

def compile_transition(name, spec):
    if name not in TRANSITIONS:
        raise ValueError("切换「%s」不在菜单里。可选：%s" % (name, "、".join(TRANSITIONS)))
    builder, def_dur = TRANSITIONS[name]
    d = spec.get("方向", "自底部")
    dur = float(spec.get("时长", def_dur))
    ms = int(round(dur * 1000))
    if builder == "morph":
        opt = spec.get("选项", "按对象")
        if opt not in MORPH_OPT:
            raise ValueError("平滑切换的「选项」只能是 %s，收到：%r"
                             % ("、".join(MORPH_OPT), opt))
        return ('<mc:AlternateContent xmlns:mc="%s" xmlns:p159="%s">'
                '<mc:Choice Requires="p159"><p:transition spd="slow" xmlns:p14="%s" '
                'p14:dur="%d"><p159:morph option="%s"/></p:transition></mc:Choice>'
                '<mc:Fallback><p:transition spd="slow"><p:fade/></p:transition>'
                '</mc:Fallback></mc:AlternateContent>'
                % (MC, P159, P14, ms, MORPH_OPT[opt]))
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

# ---- 原始XML 的「断言」清单：给逃生舱页补回逐条核对 ----
# 手写页默认只验「文件能打开 + 读回条数」（标 [降级]）。附上「断言」就把这一类补回来：
# 逐条核对 形状 / presetID / presetSubtype / 起始ms / 时长ms / 重复次数 / 参数，再从 COM
# 侧核一次形状、起始延迟（Timing.TriggerDelayTime）与时长。断言必须覆盖该页**全部**效果。
_MOTION_TAGS = ("animEffect", "anim", "animScale", "animRot", "animMotion")
ITEM_FIELDS = ("形状", "效果", "触发", "方向", "时长", "缓动", "幅度")
ASSERT_FIELDS = ("形状", "效果", "presetID", "presetSubtype", "起始ms", "时长ms", "重复", "参数")
ASSERT_PARAMS = ("animRot", "animScale", "tav", "滤镜")


def validate_asserts(si, entry):
    """校验「断言」清单的结构。任一不合格都在写入前退出，文件保持原样。"""
    raw = entry.get("断言")
    if raw is None:
        return []
    if not isinstance(raw, list) or not raw:
        sys.exit("S%d 原始XML 的「断言」要是非空数组（每条一个效果）" % si)
    for i, a in enumerate(raw, 1):
        if not isinstance(a, dict):
            sys.exit("S%d 断言第 %d 条要是对象" % (si, i))
        unknown = [k for k in a if k not in ASSERT_FIELDS]
        if unknown:
            sys.exit("S%d 断言第 %d 条有未知字段 %s；可用：%s"
                     % (si, i, "、".join(unknown), "、".join(ASSERT_FIELDS)))
        if not isinstance(a.get("形状"), str) or not a["形状"].strip():
            sys.exit("S%d 断言第 %d 条必须写「形状」（与施工时的 objectName 一致）" % (si, i))
        for k in ("presetID", "presetSubtype", "起始ms", "时长ms", "重复"):
            if k in a and not isinstance(a[k], (int, float)):
                sys.exit("S%d 断言第 %d 条的「%s」要是数字，收到 %r" % (si, i, k, a[k]))
        params = a.get("参数")
        if params is not None:
            if not isinstance(params, dict):
                sys.exit("S%d 断言第 %d 条的「参数」要是对象" % (si, i))
            bad = [k for k in params if k not in ASSERT_PARAMS]
            if bad:
                sys.exit("S%d 断言第 %d 条「参数」有未知键 %s；可用：%s"
                         % (si, i, "、".join(bad), "、".join(ASSERT_PARAMS)))
    return raw


def _walk_records(node, base, out, id2name):
    """沿 childTnLst 递归，把每个效果级 cTn 收成一条现场记录。"""
    for par in node:
        if par.tag != "{%s}par" % P_NS:
            continue
        ctn = par.find("{%s}cTn" % P_NS)
        if ctn is None:
            continue
        delay = 0
        for cond in ctn.findall("{%s}stCondLst/{%s}cond" % (P_NS, P_NS)):
            d = (cond.get("delay") or "").strip()
            if d.isdigit():
                delay += int(d)
        start = base + delay
        if ctn.get("nodeType") in ("clickEffect", "withEffect", "afterEffect"):
            durs, params = [], {}
            for beh in ctn.iter():
                tag = beh.tag.rsplit("}", 1)[-1]
                if tag == "animRot":
                    params["animRot"] = beh.get("by")
                elif tag == "animScale":
                    by = beh.find("{%s}by" % P_NS)
                    if by is not None:
                        params["animScale"] = "%s,%s" % (by.get("x"), by.get("y"))
                elif tag == "anim":
                    params.setdefault("tav", []).extend(
                        v.get("val") for v in beh.iter("{%s}strVal" % P_NS))
                elif tag == "animEffect":
                    params.setdefault("滤镜", []).append(beh.get("filter"))
                if tag in _MOTION_TAGS:
                    durs += [int(x.get("dur")) for x in beh.iter("{%s}cTn" % P_NS)
                             if (x.get("dur") or "").isdigit()]
            spid = next((t.get("spid") for t in ctn.iter("{%s}spTgt" % P_NS)), None)
            out.append({"形状": id2name.get(int(spid)) if (spid or "").isdigit() else None,
                        "spid": spid, "presetID": ctn.get("presetID"),
                        "presetSubtype": ctn.get("presetSubtype"),
                        "起始ms": start, "时长ms": max(durs) if durs else 0,
                        "重复": ctn.get("repeatCount"), "参数": params})
        inner = ctn.find("{%s}childTnLst" % P_NS)
        if inner is not None:
            _walk_records(inner, start, out, id2name)
    return out


def slide_records(slide_xml_bytes):
    """注入后的一页 -> (按文档顺序的效果记录, spid->形状名)。

    「起始ms」沿路径累加 delay 求**组内相对**值——与 COM 的 TriggerDelayTime 同口径。
    （不要拿往返后的文件累加 XML 延迟做断言：PowerPoint 会重写节拍嵌套编码。）
    """
    root = _xml_parse(slide_xml_bytes)
    id2name = {int(e.get("id")): e.get("name")
                  for e in root.iter("{%s}cNvPr" % P_NS)
                  if (e.get("id") or "").isdigit()}
    out = []
    seq = root.find(".//{%s}cTn[@nodeType='mainSeq']" % P_NS)
    ctl = seq.find("{%s}childTnLst" % P_NS) if seq is not None else None
    if ctl is None:
        return out, id2name
    for gpar in ctl:
        if gpar.tag != "{%s}par" % P_NS:
            continue
        gctn = gpar.find("{%s}cTn" % P_NS)
        inner = gctn.find("{%s}childTnLst" % P_NS) if gctn is not None else None
        if inner is not None:
            _walk_records(inner, 0, out, id2name)
    return out, id2name


def check_asserts(si, declared, records):
    """声明的断言 vs 注入文件的现场记录 -> 问题列表（空 = 全对）。"""
    problems = []
    by_shape = {}
    for rec in records:
        by_shape.setdefault(rec["形状"], []).append(rec)
    used = set()
    for want in declared:
        shape = want["形状"]
        label = want.get("效果") or shape
        cands = [r for r in by_shape.get(shape, []) if id(r) not in used]
        if not cands:
            problems.append("S%d 断言：形状「%s」上没有效果（本页有 %s）"
                            % (si, shape, "、".join(sorted(str(k) for k in by_shape))))
            continue
        rec = cands[0]
        used.add(id(rec))
        for key, disp in (("presetID", "presetID"), ("presetSubtype", "presetSubtype"),
                          ("重复", "重复次数")):
            if key in want and str(want[key]) != str(rec[key]):
                problems.append("S%d 断言：%s「%s」%s 现场是 %s ≠ 声明 %s"
                                % (si, label, shape, disp, rec[key], want[key]))
        if "起始ms" in want and abs(int(want["起始ms"]) - rec["起始ms"]) > 30:
            problems.append("S%d 断言：%s「%s」起始 %dms ≠ 声明 %dms"
                            % (si, label, shape, rec["起始ms"], int(want["起始ms"])))
        if "时长ms" in want and abs(int(want["时长ms"]) - rec["时长ms"]) > 30:
            problems.append("S%d 断言：%s「%s」时长 %dms ≠ 声明 %dms"
                            % (si, label, shape, rec["时长ms"], int(want["时长ms"])))
        for k, v in (want.get("参数") or {}).items():
            got = rec["参数"].get(k)
            if isinstance(v, list):
                if list(v) != list(got or []):
                    problems.append("S%d 断言：%s「%s」参数 %s 现场是 %s ≠ 声明 %s"
                                    % (si, label, shape, k, got or [], v))
            elif str(v) != str(got):
                problems.append("S%d 断言：%s「%s」参数 %s 现场是 %s ≠ 声明 %s"
                                % (si, label, shape, k, got, v))
    return problems


def raw_assert_report(src, sc):
    """原始XML 页的**结构侧**逐条断言（不需要 COM）：打印现场读回表，返回问题列表。

    放在 COM 之外是有意的：没装 PowerPoint 的机器也该能做这类核对，COM 只负责在其上
    再加一层交叉核对（形状 / TriggerDelayTime / Duration）。
    """
    raw_spec = sc.get("原始XML", {})
    if not isinstance(raw_spec, dict):
        return []
    problems = []
    for key in sorted(raw_spec, key=lambda k: int(k) if str(k).isdigit() else 0):
        entry = raw_spec[key] or {}
        declared = validate_asserts(int(key), entry)
        if not declared:
            continue
        si = int(key)
        recs, _id2n = slide_records(_slide_xml(src, si))
        probs = check_asserts(si, declared, recs)
        if len(recs) != len(declared):
            probs.append("S%d 断言：效果数 %d ≠ 声明 %d"
                         "——断言必须覆盖该页全部效果，只声明一部分等于没查" % (si, len(recs), len(declared)))
        print("  S%d 原始XML 断言清单（%d 条，现场读回）：" % (si, len(declared)))
        for r in recs:
            print("      %-6s presetID=%-4s 起始 %5dms 时长 %5dms 参数 %s"
                  % (r["形状"], r["presetID"], r["起始ms"], r["时长ms"], r["参数"] or ""))
        if probs:
            problems += probs
        else:
            print("  ✓ S%d 原始XML 逐条断言一致（%d 条：形状/presetID/起始ms/时长ms/参数）"
                  % (si, len(declared)))
    return problems


def _slide_xml(src, si):
    with zipfile.ZipFile(src) as zf:
        return zf.read("ppt/slides/slide%d.xml" % si)


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
            validate_asserts(si, raw_spec[str(si)])
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

    print("已注入 %d 页动画（inject_anim.py %s）：" % (len(replaced), _SELF_SHA))
    for si in sorted(stats):
        st = stats[si]
        ease = "／".join("%s×%d" % (k, v) for k, v in sorted(st.get("eases", {}).items()))
        gs = st.get("groups", [])
        print("  S%d：%d 条效果 · %d 组（自动 %d／点击 %d）· 最长节拍 %.1fs · 缓动 %s"
              % (si, st["effects"], len(gs), sum(1 for g in gs if g["auto"]),
                 st["clicks"], st["ms"] / 1000, ease or "—"))
        for gi, g in enumerate(gs, 1):
            print("        组%d %s：%s（%.1fs）"
                  % (gi, "自动" if g["auto"] else "点击",
                     "、".join(g["members"]), g["ms"] / 1000))
    for si in sorted(replaced):
        if si not in stats and si not in raw_used:
            print("  S%d：切换效果" % si)
    if raw_used:
        no_assert = [s for s in sorted(raw_used)
                     if not (raw_spec.get(str(s)) or {}).get("断言")]
        yes_assert = [s for s in sorted(raw_used) if s not in no_assert]
        if yes_assert:
            print("原始XML 逃生舱：S%s 用的是手写 XML，已按「断言」清单逐条核对（见下方验证输出）"
                  % "、".join(str(s) for s in yes_assert))
        if no_assert:
            print("⚠ 原始XML 逃生舱：S%s 用的是手写 XML 且没写「断言」——逐条核对整类关闭"
                  "（标 [降级]、退出码 2），交付说明必须声明这部分动画未经逐条验证；"
                  "给这条原始XML 补一份「断言」清单就能把这一类核对加回来"
                  % "、".join(str(s) for s in no_assert))
    return sorted(replaced), sorted(raw_used), stats

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
    """往返保存的文件 -> {页码: ([(presetID, class, subtype, 缓动)…], [滤镜…])}"""
    zf = zipfile.ZipFile(path)
    out = {}
    for n in zf.namelist():
        m = re.fullmatch(r"ppt/slides/slide(\d+)\.xml", n)
        if not m:
            continue
        xml = zf.read(n).decode("utf-8")
        effs = re.findall(r'presetID="(\d+)" presetClass="(\w+)" presetSubtype="(-?\d+)"'
                          r'((?: (?:accel|decel)="\d+")*)', xml)
        filts = re.findall(r'<p:animEffect transition="in" filter="([^"]+)"', xml)
        out[int(m.group(1))] = (effs, filts)
    zf.close()
    return out


def _check_transition(si, sl, tspec, probe, tag):
    """切换断言。**raw 页与菜单页都要跑**——切换由 transitions 编译而来，与手写 XML 无关，
    原先 raw 分支的 continue 把这条一起跳过了（能验却没验）。返回是否一致。"""
    tname = tspec if isinstance(tspec, str) else tspec.get("效果", "?")
    tdir = None if isinstance(tspec, str) else tspec.get("方向")
    try:
        ee = int(sl.SlideShowTransition.EntryEffect)
    except Exception:
        ee = None
    if tname == "平滑":
        exp_ee = MORPH_EE.get(MORPH_OPT.get(
            (tspec.get("选项", "按对象") if isinstance(tspec, dict) else "按对象"), "byObject"))
    else:
        exp_ee = EXPECT_TRANS.get((tname, tdir))
    if probe:
        print("  [probe] S%d 切换 %-4s EntryEffect=%s（期望 %s）" % (si, tname, ee, exp_ee))
        return True
    if exp_ee is not None and ee is not None and ee != exp_ee:
        tag.append("切换 %s 读回 %s ≠ 期望 %s" % (tname, ee, exp_ee))
        return False
    if exp_ee is not None and ee is not None:
        print("  ✓ S%d 切换 %s 读回一致（EntryEffect %s）" % (si, tname, ee))
    return True


def verify(src, sc, pages, stats=None, probe=False):
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
                tag = []
                declared = validate_asserts(si, raw_spec[str(si)])
                if not declared:
                    # 没写「断言」：对象动画的逐条核对整类关闭，如实标降级（不得声称已验证）
                    degraded.append(si)
                    print("  [降级] S%d 原始XML：读回 %d 条动画，没写「断言」——对象动画的逐条"
                          "核对整类关闭（要补回来就给这条原始XML 加「断言」清单）"
                          % (si, seq.Count))
                problems = []
                # COM 侧交叉核对（结构侧已在 raw_assert_report 里核过，不需要 COM 也跑）
                for k in range(1, min(seq.Count, len(declared)) + 1):
                    eff = seq(k)
                    want = declared[k - 1]
                    try:
                        nm = eff.Shape.Name
                    except Exception:
                        nm = "?"
                    if nm != want["形状"]:
                        problems.append("S%d 断言：#%d 打在「%s」上，声明是「%s」"
                                        % (si, k, nm, want["形状"]))
                    for field, reader, disp in (
                            ("起始ms", lambda e: round(float(e.Timing.TriggerDelayTime) * 1000),
                             "起始延迟"),
                            ("时长ms", lambda e: round(float(e.Timing.Duration) * 1000), "时长")):
                        if field not in want:
                            continue
                        try:
                            got = reader(eff)
                        except Exception:
                            got = None
                        if got is not None and abs(got - int(want[field])) > 30:
                            problems.append("S%d 断言：%s「%s」%s 读回 %dms ≠ 声明 %dms"
                                            % (si, want.get("效果") or want["形状"],
                                               want["形状"], disp, got, int(want[field])))
                if problems:
                    ok = False
                    for pb in problems:
                        print("  ✗ " + pb)
                elif declared:
                    print("  ✓ S%d 原始XML 与 COM 读回交叉核对一致（形状/起始延迟/时长）"
                          % si)
                # 切换由 transitions 编译而来，与手写 XML 无关——raw 页也要验
                # （原先这里的 continue 把这条一起跳过了：能验却没验）
                if trans_spec.get(str(si)):
                    if not _check_transition(si, sl, trans_spec[str(si)], probe, tag):
                        ok = False
                    for t in tag:
                        print("  ✗ S%d %s" % (si, t))
                continue
            items = sc.get("pages", {}).get(str(si), [])
            # 声明里每条效果在**本组内的相对起始延迟**（ms），顺序与 XML 一致
            decl_delays = [m[3] for g in (stats or {}).get(si, {}).get("groups", [])
                           for m in g.get("meta", [])]
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
                try:
                    accel = round(float(eff.Timing.Accelerate), 2)
                except Exception:
                    accel = None
                try:
                    decel = round(float(eff.Timing.Decelerate), 2)
                except Exception:
                    decel = None
                # 延迟要问对象模型，不要去累加 XML 里的 delay：PowerPoint 会重写节拍的
                # 嵌套编码（插包装节点、加偏置），但 TriggerDelayTime 是权威读回值。
                try:
                    tdelay = round(float(eff.Timing.TriggerDelayTime), 2)
                except Exception:
                    tdelay = None
                node = TRG_NODE.get(item.get("触发", "点击"), "clickEffect")
                exp_trg = EXPECT_TRG.get(node)
                if probe:
                    print("  [probe] S%d #%d %-6s ET=%s(期望%s) Trg=%s(期望%s) dur=%s 延迟=%s "
                          "形状=%s(%s) Dir=%s accel=%s decel=%s"
                          % (si, k, name, et, exp_et, trg, exp_trg, dur, tdelay,
                             item.get("形状"), nm, dirv, accel, decel))
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
                _en, _ep = _ease_of(name, item)
                if accel is not None and abs(accel - _ep[0] / 100000.0) > 0.02:
                    ok = False
                    tag.append("#%d %s 缓入读回 %.2f ≠ 声明 %.2f（accel=%d）"
                               % (k, name, accel, _ep[0] / 100000.0, _ep[0]))
                if decel is not None and abs(decel - _ep[1] / 100000.0) > 0.02:
                    ok = False
                    tag.append("#%d %s 缓出读回 %.2f ≠ 声明 %.2f（decel=%d）"
                               % (k, name, decel, _ep[1] / 100000.0, _ep[1]))
                decl_delay = decl_delays[k - 1] if k - 1 < len(decl_delays) else None
                if tdelay is not None and decl_delay is not None:
                    if abs(tdelay * 1000 - decl_delay) > 30:
                        ok = False
                        tag.append("#%d %s 节拍起始延迟读回 %.2fs ≠ 声明 %.2fs"
                                   "（同一节拍内的先后关系被改了）"
                                   % (k, name, tdelay, decl_delay / 1000.0))
            # 切换
            tspec = trans_spec.get(str(si))
            if tspec and not _check_transition(si, sl, tspec, probe, tag):
                ok = False
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
                    _en, _ep = _ease_of(name, item)
                    want_pid.append((str(real_pid), str(sub), _ease_key(_ease_attrs(_ep))))
                    f = "wipe(%s)" % _WIPE_FILT.get(d, "") if name == "擦入" \
                        else ANIM_FILT.get(name)
                    if f:
                        want_filt.append(f)
                got_pid, got_filt = rt.get(si, ([], []))
                got_pairs = [(x[0], x[2], _ease_key(x[3])) for x in got_pid]
                if got_pairs != want_pid:
                    ok = False
                    print("  ✗ S%d 往返不一致：PowerPoint 序列化的 (presetID,subtype,缓动)=%s "
                          "≠ 注入 %s（方向/缓动编码未被模型按原样保留）" % (si, got_pairs, want_pid))
                if got_filt != want_filt:
                    ok = False
                    print("  ✗ S%d 往返滤镜不一致：%s ≠ %s" % (si, got_filt, want_filt))
                elif got_pid and got_pairs == want_pid and got_filt == want_filt:
                    print("  ✓ S%d 往返校验一致（方向与缓动编码被 PowerPoint 原样保留）" % si)
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
        menu_pages, raw_pages, stats = inject(src, sc, replace="--replace" in flags,
                                              allow_raw="--raw" in flags)
    except ValueError as e:
        sys.exit(str(e))
    pages = sorted(set(menu_pages) | set(raw_pages))   # 只配切换的页也要验（含 EntryEffect）
    if "--no-verify" in flags:
        print("⚠ 已注入但跳过验证（--no-verify）——动画未经 PowerPoint 确认")
        return 2
    # 原始XML 的结构侧断言（不需要 COM，任何机器都能跑）；COM 侧在 verify 里再交叉核对一次
    problems = raw_assert_report(src, sc)
    if problems:
        for pb in problems:
            print("  ✗ " + pb)
        print("原始XML 的「断言」对不上（文件已按声明注入；问题在声明或手写 XML 里）"
              "——按实测值修正后重跑")
        return 1
    try:
        import win32com.client  # noqa: F401
        have_com = sys.platform == "win32"
    except ImportError:
        have_com = False
    if not have_com:
        print("⚠ 本机没有 PowerPoint COM，无法验证——动画已注入但未经确认")
        return 2
    ok, degraded = verify(src, sc, pages, stats=stats, probe="--probe" in flags)
    if not ok:
        return 1
    return 2 if degraded else 0

if __name__ == "__main__":
    sys.exit(main())
