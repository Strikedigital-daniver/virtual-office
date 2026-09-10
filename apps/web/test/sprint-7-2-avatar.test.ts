import { describe, expect, it } from "vitest";

import {
  DEFAULT_AVATAR_APPEARANCE,
  parseAvatarAppearance,
} from "@virtual-office/shared";

import {
  createAvatarDraft,
  optionsForField,
  patchAvatarDraft,
  randomizeAvatarDraft,
  resetAvatarDraft,
} from "../src/lib/avatar/customizer-state";
import {
  appearanceForMissingLoadout,
  avatarWriteIsForbidden,
} from "../src/lib/avatar/access";
import {
  appearanceFromStoredLoadout,
  avatarLoadoutUpsertRow,
  interpretAvatarSaveResponse,
  resolveAvatarLoadPriority,
} from "../src/lib/avatar/persistence";
import {
  cameraOffPortraitOwners,
  chatIdentityAppearance,
} from "../src/lib/avatar/identity";

describe("Sprint 7.2 customizer draft", () => {
  it("H: opening the customizer copies the current appearance", () => {
    const current = patchAvatarDraft(
      DEFAULT_AVATAR_APPEARANCE,
      "faceId",
      "face-wide",
    );
    expect(createAvatarDraft(current)).toEqual(current);
  });

  it("I/J: face, eyes and mouth update the preview draft", () => {
    let draft = createAvatarDraft();
    draft = patchAvatarDraft(draft, "faceId", "face-oval");
    draft = patchAvatarDraft(draft, "eyesId", "eyes-wide");
    draft = patchAvatarDraft(draft, "mouthId", "mouth-grin");
    expect(draft.faceId).toBe("face-oval");
    expect(draft.eyesId).toBe("eyes-wide");
    expect(draft.mouthId).toBe("mouth-grin");
  });

  it("K: hair style and color update the preview draft", () => {
    let draft = createAvatarDraft();
    draft = patchAvatarDraft(draft, "hairStyleId", "hair-long");
    draft = patchAvatarDraft(draft, "hairColorId", "hair-soil");
    expect(draft.hairStyleId).toBe("hair-long");
    expect(draft.hairColorId).toBe("hair-soil");
  });

  it("L: clothing updates the preview draft", () => {
    let draft = createAvatarDraft();
    draft = patchAvatarDraft(draft, "topId", "top-hoodie");
    draft = patchAvatarDraft(draft, "bottomId", "bottom-skirt");
    expect(draft.topId).toBe("top-hoodie");
    expect(draft.bottomId).toBe("bottom-skirt");
  });

  it("M: accessories update the preview draft", () => {
    const draft = patchAvatarDraft(
      createAvatarDraft(),
      "headAccessoryId",
      "head-cap",
    );
    expect(draft.headAccessoryId).toBe("head-cap");
  });

  it("N: cancel keeps the persisted avatar unchanged", () => {
    const persisted = DEFAULT_AVATAR_APPEARANCE;
    const draft = patchAvatarDraft(persisted, "topId", "top-hoodie");
    expect(draft).not.toEqual(persisted);
    expect(createAvatarDraft(persisted)).toEqual(persisted);
  });

  it("O: save uses the final validated draft once", () => {
    const draft = patchAvatarDraft(
      createAvatarDraft(),
      "eyesId",
      "eyes-bright",
    );
    const saves: unknown[] = [];
    saves.push(parseAvatarAppearance(draft));
    expect(saves).toHaveLength(1);
    expect(saves[0]).toEqual(draft);
  });

  it("P: randomize only produces valid catalog combinations", () => {
    const random = randomizeAvatarDraft(7);
    expect(parseAvatarAppearance(random)).toEqual(random);
    expect(
      optionsForField("hairStyleId").some(
        (item) => item.id === random.hairStyleId,
      ),
    ).toBe(true);
  });

  it("Q: reset returns the default avatar", () => {
    expect(resetAvatarDraft()).toEqual(DEFAULT_AVATAR_APPEARANCE);
  });
});

describe("Sprint 7.2 persistence contracts", () => {
  it("R/S: loadouts are keyed by auth user id, with or without a Club profile", () => {
    const authOnly = "11111111-1111-4111-8111-111111111111";
    const clubMember = "22222222-2222-4222-8222-222222222222";
    expect(avatarWriteIsForbidden(authOnly, authOnly)).toBe(false);
    expect(avatarWriteIsForbidden(clubMember, clubMember)).toBe(false);
  });

  it("T: cannot write another auth user's avatar", () => {
    expect(
      avatarWriteIsForbidden(
        "11111111-1111-4111-8111-111111111111",
        "22222222-2222-4222-8222-222222222222",
      ),
    ).toBe(true);
  });

  it("U: missing loadout falls back to the default humanoid", () => {
    expect(appearanceForMissingLoadout()).toEqual(DEFAULT_AVATAR_APPEARANCE);
  });

  it("V: invalid persisted config normalizes safely", () => {
    expect(
      parseAvatarAppearance({ version: 1, topId: "javascript:alert(1)" }),
    ).toBeNull();
  });
});

describe("Sprint 7.2 identity rendering", () => {
  it("AI: camera-off tiles prefer portrait owners without video", () => {
    expect(
      cameraOffPortraitOwners({
        videoOwnerIds: new Set(["a"]),
        audioOwnerIds: new Set(["a", "b"]),
      }),
    ).toEqual(["b"]);
  });

  it("AJ: chat identity resolves the current appearance separately from the message", () => {
    const appearance = DEFAULT_AVATAR_APPEARANCE;
    const map = new Map([["user-1", appearance]]);
    expect(chatIdentityAppearance(map, "user-1")).toBe(appearance);
    expect(chatIdentityAppearance(map, "user-2")).toBeUndefined();
  });
});

describe("Sprint 7.2 canonical persistence", () => {
  const userA = "11111111-1111-4111-8111-111111111111";
  const userB = "22222222-2222-4222-8222-222222222222";
  const saved = patchAvatarDraft(
    DEFAULT_AVATAR_APPEARANCE,
    "topId",
    "top-hoodie",
  );
  const stale = patchAvatarDraft(
    DEFAULT_AVATAR_APPEARANCE,
    "topId",
    "top-tank",
  );

  it("A: missing row yields the default avatar", () => {
    expect(appearanceFromStoredLoadout(undefined, false)).toEqual(
      DEFAULT_AVATAR_APPEARANCE,
    );
  });

  it("B/C: save uses one upsert keyed by auth_user_id", () => {
    const first = avatarLoadoutUpsertRow(userA, saved);
    const second = avatarLoadoutUpsertRow(userA, stale);
    expect(first.onConflict).toBe("auth_user_id");
    expect(second.onConflict).toBe("auth_user_id");
    expect(first.row.auth_user_id).toBe(second.row.auth_user_id);
  });

  it("D: reload abstraction returns the server appearance", () => {
    const loaded = resolveAvatarLoadPriority({
      serverAvailable: true,
      hasLoadout: true,
      serverAppearance: saved,
      localAppearance: stale,
    });
    expect(loaded.source).toBe("server");
    expect(loaded.appearance.topId).toBe("top-hoodie");
  });

  it("E: invalid stored appearance falls back safely", () => {
    expect(
      appearanceFromStoredLoadout({ version: 99, topId: "nope" }, true),
    ).toEqual(DEFAULT_AVATAR_APPEARANCE);
  });

  it("F: user cannot mutate another user", () => {
    expect(avatarWriteIsForbidden(userA, userB)).toBe(true);
  });

  it("G: Auth-only Office Collaborator persists by auth user id", () => {
    const spec = avatarLoadoutUpsertRow(userA, saved);
    expect(spec.row.auth_user_id).toBe(userA);
    expect(avatarWriteIsForbidden(userA)).toBe(false);
  });

  it("H: server save failure does not report synchronized success", () => {
    expect(
      interpretAvatarSaveResponse({
        ok: false,
        status: 503,
        persisted: false,
      }).synced,
    ).toBe(false);
    expect(
      interpretAvatarSaveResponse({ ok: true, status: 200, persisted: true })
        .synced,
    ).toBe(true);
  });

  it("I: server saved appearance outranks stale local cache", () => {
    const loaded = resolveAvatarLoadPriority({
      serverAvailable: true,
      hasLoadout: true,
      serverAppearance: saved,
      localAppearance: stale,
    });
    expect(loaded.appearance).toEqual(saved);
    expect(loaded.appearance).not.toEqual(stale);
  });
});
