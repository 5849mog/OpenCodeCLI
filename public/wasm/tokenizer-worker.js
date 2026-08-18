/**
 * tokenizer-worker.js — DeepSeek 真分词器 Web Worker（静态资源，不经 next 打包）。
 *
 * importScripts("./tokenizers-lib.js")（@huggingface/tokenizers 纯 JS 移植，
 * esbuild 打成 IIFE 挂 self.TokenizersLib；无 wasm，零加载风险）→
 * new Tokenizer(tokenizer.json, {})。tokenizer.json（7.8MB，DeepSeek-V3 官方
 * BPE 词表，128k vocab）fetch 一次常驻缓存，与 Python transformers 同引擎，
 * 计数逐字节一致。
 *
 * 收 { id, texts } → 回 { id, ok, result: { counts: number[] } }（批量一次往返）。
 * 加载期致命错误（importScripts / fetch / 构造失败）不带 id（宿主池化路由据此
 * 判定致命并重置）。只读、无文件操作。
 */
"use strict";

(function () {
  // reqId 为请求 id（宿主池化路由用）；加载期致命错误不传 reqId（无 id 回包 = 致命）。
  function postErr(msg, reqId) {
    var payload = { ok: false, error: String(msg) };
    if (typeof reqId === "number") payload.id = reqId;
    try { self.postMessage(payload); }
    catch (_) { /* ignore */ }
  }

  try {
    // 相对路径：与 tokenizers-lib.js 同在 public/wasm/，同目录无 CSP 问题。
    self.importScripts("./tokenizers-lib.js");
  }
  catch (e) { postErr("加载 tokenizers 引擎失败: " + (e && e.message || e)); return; }

  var TL = (typeof self !== "undefined" ? self : globalThis).TokenizersLib;
  if (!TL || !TL.Tokenizer) { postErr("tokenizers 引擎未就绪"); return; }

  var initPromise = null;
  function ensureInit() {
    if (!initPromise) {
      // tokenizer.json 在 public/tokenizer/（worker 在 /wasm/ 下，相对上一级）。
      initPromise = fetch("../tokenizer/tokenizer.json")
        .then(function (r) {
          if (!r.ok) throw new Error("tokenizer.json HTTP " + r.status);
          return r.json();
        })
        .then(function (json) { return new TL.Tokenizer(json, {}); });
    }
    return initPromise;
  }

  self.onmessage = function (ev) {
    var req = ev.data || {};
    var reqId = typeof req.id === "number" ? req.id : null;
    ensureInit().then(function (tok) {
      var texts = Array.isArray(req.texts) ? req.texts
        : typeof req.text === "string" ? [req.text] : [];
      // encode 在纯 JS 移植里是同步返回（也可能异步），Promise.resolve 统一兼容。
      return Promise.all(texts.map(function (t) {
        return Promise.resolve(tok.encode(t)).then(function (enc) { return enc.ids.length; });
      }));
    }).then(function (counts) {
      self.postMessage({ id: reqId, ok: true, result: { counts: counts } });
    }).catch(function (e) {
      postErr("分词失败: " + (e && (e.stack || e.message) || e), reqId);
    });
  };
})();
