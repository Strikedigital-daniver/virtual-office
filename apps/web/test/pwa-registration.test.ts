// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PwaRegistration } from "@/components/pwa-registration";

let root: Root;
let host: HTMLDivElement;
let serviceWorker: EventTarget & {
  controller: object | null;
  register: ReturnType<typeof vi.fn>;
};
let registration: EventTarget & {
  waiting: { postMessage: ReturnType<typeof vi.fn> } | null;
  installing: null;
};
const reload = vi.fn();
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("window", { location: { reload } });
  reload.mockClear();
  registration = Object.assign(new EventTarget(), {
    waiting: null,
    installing: null,
  });
  serviceWorker = Object.assign(new EventTarget(), {
    controller: null,
    register: vi.fn().mockResolvedValue(registration),
  });
  vi.stubGlobal("navigator", { serviceWorker });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
async function render() {
  await act(async () => root.render(createElement(PwaRegistration)));
}

it("ignores first installation but reloads a later update in the same session", async () => {
  await render();
  serviceWorker.controller = {};
  serviceWorker.dispatchEvent(new Event("controllerchange"));
  expect(reload).not.toHaveBeenCalled();
  serviceWorker.dispatchEvent(new Event("controllerchange"));
  expect(reload).toHaveBeenCalledOnce();
});
it("allows an explicit waiting update and removes listeners on unmount", async () => {
  serviceWorker.controller = {};
  const postMessage = vi.fn();
  registration.waiting = { postMessage };
  const remove = vi.spyOn(registration, "removeEventListener");
  await render();
  expect(host.textContent).toContain("actualización");
  await act(async () => host.querySelector("button")!.click());
  expect(postMessage).toHaveBeenCalledWith("SKIP_WAITING");
  await act(async () => root.unmount());
  serviceWorker.dispatchEvent(new Event("controllerchange"));
  expect(reload).not.toHaveBeenCalled();
  expect(remove).toHaveBeenCalledWith("updatefound", expect.any(Function));
});
it("continues without an unhandled error if registration is refused", async () => {
  serviceWorker.register.mockRejectedValueOnce(new Error("private mode"));
  await render();
  expect(host.textContent).toBe("");
});
