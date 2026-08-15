import { describe, expect, it } from "vitest";

import manifest from "@/app/manifest";

describe("Sprint 1 installable shell contract", () => {
  it("publishes a standalone PWA manifest without device or map capabilities", () => {
    const output = manifest();
    expect(output.display).toBe("standalone");
    expect(output.start_url).toBe("/");
    expect(output.icons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ src: "/icon.svg", purpose: "maskable" }),
      ]),
    );
    expect(JSON.stringify(output)).not.toMatch(
      /camera|microphone|phaser|mapa/iu,
    );
  });
});
