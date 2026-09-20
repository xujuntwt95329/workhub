import { it, expect, vi, afterEach } from "vitest";
import {
  api,
  post,
  ApiError,
  percent,
  initials,
  formatDate,
} from "../src/lib/api";
afterEach(() => vi.unstubAllGlobals());
it("sends same-origin requests with JSON and idempotency headers", async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response('{"ok":true}'));
  vi.stubGlobal("fetch", fetcher);
  expect(await post("/api/v1/todos", { title: "Idea" })).toEqual({ ok: true });
  expect(fetcher.mock.calls[0][1]).toMatchObject({
    method: "POST",
    credentials: "same-origin",
    body: '{"title":"Idea"}',
    headers: { "content-type": "application/json" },
  });
  expect(fetcher.mock.calls[0][1].headers["Idempotency-Key"]).toBeTruthy();
});
it("propagates structured errors and provides fallbacks", async () => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: {
              message: "Conflict",
              code: "VERSION_CONFLICT",
              details: ["v2"],
            },
          }),
          { status: 409 },
        ),
      )
      .mockResolvedValueOnce(new Response("{}", { status: 500 })),
  );
  await expect(api("/api/x")).rejects.toMatchObject({
    message: "Conflict",
    code: "VERSION_CONFLICT",
    status: 409,
    details: ["v2"],
  });
  await expect(api("/api/x")).rejects.toThrow(ApiError);
});
it("formats missing metrics, rates, dates and initials", () => {
  expect(percent(null)).toBe("—");
  expect(percent(0.3333)).toBe("33%");
  expect(initials(" alice ")).toBe("A");
  expect(initials("")).toBe("W");
  expect(formatDate("2026-01-02T00:00:00Z")).toContain("2");
});
