"use client";

import {
  type AvatarAppearance,
  parseAvatarAppearance,
} from "@virtual-office/shared";
import { useEffect, useMemo, useState } from "react";

import { AvatarPreview } from "@/components/avatar-preview";
import {
  AVATAR_CUSTOMIZER_CATEGORIES,
  AVATAR_CUSTOMIZER_FIELDS,
  createAvatarDraft,
  optionsForField,
  patchAvatarDraft,
  randomizeAvatarDraft,
  resetAvatarDraft,
  type AvatarCustomizerCategory,
} from "@/lib/avatar/customizer-state";
import {
  appearancesEquivalent,
  interpretAvatarSaveResponse,
} from "@/lib/avatar/persistence";
import { writeLocalAvatarFallback } from "@/lib/avatar/repository";

interface AvatarCustomizerProps {
  open: boolean;
  current: AvatarAppearance;
  onClose: () => void;
  onSaved: (appearance: AvatarAppearance) => void;
}

export function AvatarCustomizer({
  open,
  current,
  onClose,
  onSaved,
}: AvatarCustomizerProps) {
  const [draft, setDraft] = useState<AvatarAppearance>(current);
  const [category, setCategory] = useState<AvatarCustomizerCategory>("Cara");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) setDraft(createAvatarDraft(current));
  }, [open, current]);

  const fields = AVATAR_CUSTOMIZER_FIELDS[category];
  const preview = useMemo(() => draft, [draft]);

  if (!open) return null;

  const verifyPersistedAppearance = async (
    expected: AvatarAppearance,
  ): Promise<AvatarAppearance | null> => {
    try {
      const response = await fetch("/api/spatial-avatar", {
        credentials: "same-origin",
      });
      if (!response.ok) return null;
      const payload = (await response.json()) as {
        appearance?: AvatarAppearance;
        hasLoadout?: boolean;
      };
      const loaded = parseAvatarAppearance(payload.appearance);
      if (!payload.hasLoadout || !loaded) return null;
      return appearancesEquivalent(loaded, expected) ? loaded : null;
    } catch {
      return null;
    }
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/spatial-avatar", {
        method: "PUT",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ appearance: draft }),
      });
      const payload = (await response.json().catch(() => null)) as {
        appearance?: AvatarAppearance;
        error?: string;
        persisted?: boolean;
      } | null;
      let saveResult = interpretAvatarSaveResponse({
        ok: response.ok,
        status: response.status,
        persisted: payload?.persisted,
        appearance: payload?.appearance,
      });
      let appearance = payload?.appearance ?? draft;
      if (!saveResult.synced) {
        const verified = await verifyPersistedAppearance(draft);
        if (verified) {
          saveResult = { synced: true, message: null };
          appearance = verified;
        }
      }
      if (!saveResult.synced) {
        writeLocalAvatarFallback(draft);
        setError(
          payload?.error ?? saveResult.message ?? "El avatar no se sincronizó.",
        );
        return;
      }
      writeLocalAvatarFallback(appearance);
      onSaved(appearance);
      onClose();
    } catch {
      const verified = await verifyPersistedAppearance(draft);
      if (verified) {
        writeLocalAvatarFallback(verified);
        onSaved(verified);
        onClose();
        return;
      }
      writeLocalAvatarFallback(draft);
      setError("El avatar no se sincronizó en el servidor.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="avatar-customizer"
      role="dialog"
      aria-label="Personalizar personaje"
    >
      <header className="avatar-customizer-header">
        <h2>Personalizar personaje</h2>
        <button type="button" className="secondary" onClick={onClose}>
          Cancelar
        </button>
      </header>
      <div className="avatar-customizer-layout">
        <div className="avatar-customizer-preview">
          <AvatarPreview appearance={preview} scale={5} label="Vista previa" />
        </div>
        <div className="avatar-customizer-controls">
          <nav className="avatar-customizer-tabs" aria-label="Categorías">
            {AVATAR_CUSTOMIZER_CATEGORIES.map((item) => (
              <button
                key={item}
                type="button"
                className={item === category ? "active" : undefined}
                aria-pressed={item === category}
                onClick={() => setCategory(item)}
              >
                {item}
              </button>
            ))}
          </nav>
          {fields.map((entry) => (
            <fieldset key={entry.field} className="avatar-customizer-field">
              <legend>{entry.label}</legend>
              <div className="avatar-customizer-options">
                {optionsForField(entry.field).map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    className={
                      draft[entry.field] === option.id ? "selected" : undefined
                    }
                    aria-pressed={draft[entry.field] === option.id}
                    aria-label={option.label}
                    title={option.label}
                    onClick={() =>
                      setDraft(patchAvatarDraft(draft, entry.field, option.id))
                    }
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </fieldset>
          ))}
        </div>
      </div>
      {error ? <p className="avatar-customizer-error">{error}</p> : null}
      <footer className="avatar-customizer-actions">
        <button
          type="button"
          className="secondary"
          onClick={() => setDraft(randomizeAvatarDraft(Date.now()))}
        >
          Randomizar
        </button>
        <button
          type="button"
          className="secondary"
          onClick={() => setDraft(resetAvatarDraft())}
        >
          Restablecer
        </button>
        <button type="button" disabled={saving} onClick={() => void save()}>
          Guardar
        </button>
      </footer>
    </div>
  );
}
