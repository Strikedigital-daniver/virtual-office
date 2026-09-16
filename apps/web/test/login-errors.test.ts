// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { LoginForm } from "@/components/login-form";

const mocks = vi.hoisted(() => ({ createClient: vi.fn(), signIn: vi.fn() }));
vi.mock("@/lib/supabase/client", () => ({ createClient: mocks.createClient }));
let root: Root;
let host: HTMLDivElement;
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mocks.createClient
    .mockReset()
    .mockReturnValue({ auth: { signInWithPassword: mocks.signIn } });
  mocks.signIn.mockReset();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () =>
    root.render(createElement(LoginForm, { nextPath: "/office/temple" })),
  );
  for (const [id, value] of [
    ["email", "person@example.test"],
    ["password", "local-test-only"],
  ]) {
    const input = host.querySelector<HTMLInputElement>(`#${id}`)!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
async function submit() {
  await act(async () =>
    host
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
}
it("allows retry after a thrown network error", async () => {
  mocks.signIn.mockRejectedValueOnce(new Error("network unavailable"));
  await submit();
  expect(mocks.signIn).toHaveBeenCalledOnce();
  expect(host.querySelector("[role=alert]")?.textContent).toContain(
    "No se pudo conectar",
  );
  expect(host.querySelector("button")!.disabled).toBe(false);
  mocks.signIn.mockResolvedValueOnce({
    error: { message: "invalid credentials" },
  });
  await submit();
  expect(mocks.signIn).toHaveBeenCalledTimes(2);
  expect(host.querySelector("[role=alert]")?.textContent).toContain(
    "Correo o contraseña incorrectos",
  );
});
it("recovers from missing client configuration without leaving the form stuck", async () => {
  mocks.createClient.mockImplementation(() => {
    throw new Error("configuration missing");
  });
  await submit();
  expect(host.querySelector("button")!.disabled).toBe(false);
  expect(host.querySelector("[role=alert]")?.textContent).toContain(
    "No se pudo conectar",
  );
});
