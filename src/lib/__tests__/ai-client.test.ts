import { describe, expect, it } from "vitest";
import { classifyApiError } from "../ai-client";

describe("classifyApiError", () => {
  it("401 → 提示检查 API key", () => {
    const out = classifyApiError(new Error("API error 401: unauthorized"));
    expect(out).toContain("API key is invalid");
  });

  it("Invalid API key 文案 → 提示检查 API key", () => {
    expect(classifyApiError(new Error("Invalid API key provided"))).toContain("API key is invalid");
    expect(classifyApiError(new Error("invalid_api_key"))).toContain("API key is invalid");
  });

  it("403 → 无权限提示", () => {
    expect(classifyApiError(new Error("403 Forbidden"))).toContain("does not have permission");
  });

  it("429 → 限流提示", () => {
    expect(classifyApiError(new Error("429 Too Many Requests"))).toContain("Rate limited");
  });

  it("400 + context_length → 上下文超限提示", () => {
    const out = classifyApiError(new Error("400 This model's maximum context length is exceeded (context_length)"));
    expect(out).toContain("context window");
  });

  it("400 → Bad request 原样摘要", () => {
    const out = classifyApiError(new Error("400 invalid parameter: temperature"));
    expect(out).toContain("Bad request");
    expect(out).toContain("invalid parameter");
  });

  it("网络错误 → 连接提示", () => {
    expect(classifyApiError(new Error("Network error: dial tcp"))).toContain("Cannot reach the API");
    expect(classifyApiError(new Error("Failed to fetch"))).toContain("Cannot reach the API");
  });

  it("未知错误原样透传", () => {
    const out = classifyApiError(new Error("something exploded"));
    expect(out).toBe("something exploded");
  });

  it("状态码按词边界解析——'API error 5000' 不误判为可重试的 500", () => {
    // 5000 无独立词边界码 500 → 走透传而非 Bad request
    expect(classifyApiError(new Error("API error 5000 details"))).toBe("API error 5000 details");
  });

  it("'模型 4001 不存在' 不误判为 400 Bad request", () => {
    expect(classifyApiError(new Error("模型 4001 不存在"))).toBe("模型 4001 不存在");
  });
});
