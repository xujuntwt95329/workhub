// @vitest-environment jsdom
import { it, expect, vi, afterEach } from "vitest";
import {
  render,
  screen,
  cleanup,
  fireEvent,
  waitFor,
} from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { BrowserRouter } from "react-router-dom";
import { Badge, Markdown, Modal, Editor } from "../src/components";
import { record } from "./fixtures";
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it("renders readable labels and blocks executable HTML in user Markdown", () => {
  const { container } = render(
    <>
      <Badge value="passed" />
      <Markdown
        text={
          "# Hello\n<script>window.pwned=true</script>\n[bad](javascript:alert(1))"
        }
      />
    </>,
  );
  expect(screen.getByText("通过")).toBeVisible();
  expect(screen.getByRole("heading", { name: "Hello" })).toBeVisible();
  expect(container.querySelector("script")).toBeNull();
  expect(container.querySelector("a")?.getAttribute("href")).not.toContain(
    "javascript:",
  );
});
it("traps keyboard focus, closes on Escape, and restores prior focus", () => {
  const trigger = document.createElement("button");
  document.body.appendChild(trigger);
  trigger.focus();
  const close = vi.fn();
  const { unmount } = render(
    <Modal title="Test" onClose={close}>
      <input aria-label="First" />
      <button>Last</button>
    </Modal>,
  );
  const x = screen.getByRole("button", { name: "关闭" });
  expect(x).toHaveFocus();
  fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
  expect(screen.getByRole("button", { name: "Last" })).toHaveFocus();
  fireEvent.keyDown(document, { key: "Tab" });
  expect(x).toHaveFocus();
  fireEvent.keyDown(document, { key: "Escape" });
  expect(close).toHaveBeenCalledOnce();
  unmount();
  expect(trigger).toHaveFocus();
  trigger.remove();
});
it("preserves input and surfaces a conflict without closing the editor", async () => {
  const close = vi.fn(),
    saved = vi.fn();
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({
            error: { code: "VERSION_CONFLICT", message: "内容已变化，请刷新" },
          }),
          { status: 409 },
        ),
      ),
  );
  render(
    <BrowserRouter>
      <Editor
        spec={{
          kind: "todo",
          entity: record("todo", { taskId: null, title: "My idea" }),
        }}
        records={[]}
        onClose={close}
        onSaved={saved}
      />
    </BrowserRouter>,
  );
  fireEvent.change(screen.getByLabelText("标题"), {
    target: { value: "My revised idea" },
  });
  fireEvent.click(screen.getByRole("button", { name: /保存/ }));
  await screen.findByText("内容已变化，请刷新");
  expect(screen.getByLabelText("标题")).toHaveValue("My revised idea");
  expect(close).not.toHaveBeenCalled();
  expect(saved).not.toHaveBeenCalled();
});
it("submits owner edits with the version last read", async () => {
  const close = vi.fn(),
    saved = vi.fn().mockResolvedValue(undefined),
    fetcher = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ data: record("todo", { version: 5 }) })),
      );
  vi.stubGlobal("fetch", fetcher);
  render(
    <BrowserRouter>
      <Editor
        spec={{
          kind: "todo",
          entity: record("todo", { taskId: null, version: 4 }),
        }}
        records={[]}
        onClose={close}
        onSaved={saved}
      />
    </BrowserRouter>,
  );
  fireEvent.click(screen.getByRole("button", { name: /保存/ }));
  await waitFor(() => expect(close).toHaveBeenCalled());
  expect(JSON.parse(fetcher.mock.calls[0][1].body).expectedVersion).toBe(4);
});
