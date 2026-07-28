# 🌐 Web 工具配置指南

> 让你的 AI 助手拥有联网能力——搜索互联网、获取网页内容。

---

## 目录

- [能做什么？](#能做什么)
- [快速开始：配置搜索 API Key](#快速开始配置搜索-api-key)
  - [方案 A：Tavily（推荐）](#方案-atavily推荐)
  - [方案 B：Brave Search](#方案-bbrave-search)
- [在 Settings 中配置](#在-settings-中配置)
- [可选：配置 CORS 代理](#可选配置-cors-代理)
  - [方案 A：本地 Caddy 代理](#方案-a本地-caddy-代理)
  - [方案 B：Cloudflare Workers 代理](#方案-bcloudflare-workers-代理)
- [常见问题](#常见问题)

---

## 能做什么？

| 工具 | 功能 | 需要配置 |
|:----:|------|:--------:|
| `web_search` | 搜索互联网，返回标题/链接/摘要 | ✅ 搜索 API Key |
| `fetch_url` | 获取指定 URL 的内容 | ❌ 默认直连可用 |

**`fetch_url` 开箱即用**，不需要任何配置。它能直接访问支持 CORS 的网站和 API（GitHub API、npm 注册表、JSONPlaceholder 等）。

**`web_search` 需要配置一个搜索 API Key**，因为浏览器本身没有内置的搜索能力，需要调用第三方搜索服务。下面教你如何获取。

---

## 快速开始：配置搜索 API Key

### 方案 A：Tavily（推荐）

[Tavily](https://tavily.com) 是专为 AI Agent 设计的搜索引擎，**免费套餐每月 1000 次查询**，返回的不只是摘要，而是页面的完整内容，AI 能直接读懂。

**获取步骤：**

1. 打开 [tavily.com](https://tavily.com)
2. 点击右上角 **"Sign Up"** 注册账号
   - 支持 Google / GitHub 快速登录
   - 也可以直接用邮箱注册
3. 注册完成后，自动跳转到 Dashboard
4. 在 Dashboard 中可以看到你的 **API Key**（格式类似 `tvly-xxxxxxxxxxxxxxxx`）
   - 点击复制按钮复制它
5. 回到 Open Code Web → **Settings → Web & Search**，粘贴到 **Search API Key** 输入框

> 💡 **免费额度：** 每月 1000 次搜索。日常开发查询完全够用，而且只在 AI 主动调用 `web_search` 时才消耗。

### 方案 B：Brave Search

[Brave Search API](https://brave.com/search/api/) 是 Brave 浏览器提供的搜索 API，**免费套餐每月 2000 次查询**，比 Tavily 多一倍，但只返回摘要片段（不返回页面正文）。

**获取步骤：**

1. 打开 [brave.com/search/api/](https://brave.com/search/api/)
2. 点击 **"Get Started"** 或 **"Subscribe"**
3. 注册免费套餐（Free tier，每月 2000 次查询）
4. 在 Dashboard 中找到你的 **API Key**
5. 回到 Open Code Web → **Settings → Web & Search**
   - 搜索提供商选择 **"Brave Search"**
   - 粘贴你的 API Key

> 💡 **何时选 Brave？** 如果你已经有 Brave 浏览器、或者 Tavily 的 1000 次不够用、或者你在的地区 Tavily 访问不稳定。

---

## 在 Settings 中配置

将 API Key 填入设置后，记得点击底部的 **"Done"** 按钮保存，密钥会用 AES-GCM 加密存储在 sessionStorage 中（标签页一关就消失，和你的 LLM 密钥一样安全）。

**Settings 中的各个选项：**

| 选项 | 说明 |
|------|------|
| **Search provider** | 选择 Tavily 或 Brave |
| **Search API Key** | 粘贴你的 API Key |
| **Use Jina AI Reader** | 默认开启。当 `fetch_url` 直连失败时，尝试通过 Jina AI Reader 代理获取。*注意：r.jina.ai 在中国大陆可能无法访问* |
| **Custom CORS proxy URL** | 如果你有自己的 CORS 代理服务器，填在这里 |

---

## 可选：配置 CORS 代理

`fetch_url` 的默认策略是：**先直连 → CORS 失败则走 Jina Reader → 再失败则走自定义代理**。

如果你在中国大陆（Jina Reader 被墙），且需要获取不支持 CORS 的网站内容，可以搭建自己的代理。

### 方案 A：本地 Caddy 代理

项目根目录的 `Caddyfile` 已经自带了一个 CORS 代理端点。

```bash
# 启动 Caddy（假设你已经在本地运行了 next dev）
caddy run
```

然后在 Settings → Web & Search 的 **Custom CORS proxy URL** 中填入：

```
http://localhost:81/cors-proxy/
```

> ⚠️ Caddy 配置中的 CORS 代理有安全警告：仅用于可信网络，不要暴露到公网。

### 方案 B：Cloudflare Workers 代理

如果你想在 iPad 上也能通过 `fetch_url` 获取被 CORS 限制的网页，最省心的方式是部署一个 Cloudflare Worker：

```javascript
// Cloudflare Worker — CORS Proxy
export default {
  async fetch(request) {
    const url = new URL(request.url);
    const target = url.pathname.slice(1) + url.search;

    const resp = await fetch(target, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; OpenCodeWeb/1.0)',
      },
    });

    const newResp = new Response(resp.body, resp);
    newResp.headers.set('Access-Control-Allow-Origin', '*');
    return newResp;
  }
}
```

部署后，在 Settings 的 **Custom CORS proxy URL** 填入：

```
https://你的worker名.workers.dev/
```

---

## 常见问题

### Q：不配置搜索 API Key 会怎样？

A：AI 调用 `web_search` 时会返回清晰的引导提示，告诉你如何注册并配置，不会报错崩溃。

### Q：fetch_url 报 "Failed to fetch" 怎么办？

A：这通常是因为目标网站不支持 CORS。`fetch_url` 会自动尝试 Jina Reader 回退。如果还不行：
1. 用 `web_search` 替代搜索信息
2. 配置自定义 CORS 代理（见上方）

### Q：Tavily 和 Brave 哪个更好？

A：**Tavily** 返回完整页面内容（AI 直接读懂），**Brave** 只返回摘要片段。总体上 Tavily 更适合 AI 编程助手场景。但如果 Tavily 在你的地区不可用，Brave 是不错的备选。

### Q：搜索 API Key 安全吗？

A：和你的 LLM API Key 一样，用 AES-GCM 加密存储在 sessionStorage 中。刷新页面时自动解密回内存，关闭标签页自动清除。搜索引擎只知道你在搜什么，不知道你的代码内容。

### Q：免费额度用完了怎么办？

A：Tavily 和 Brave 的付费套餐都很便宜（每月几美元到几十美元不等，取决于用量）。你也可以同时注册两个，在 Settings 中切换使用。
