/**
 * Prepare updated UNLOCK_ADMIN_EMAILS for staging: removes ONLY the selected
 * office-collaborator test identity from the local unlock roster file.
 *
 * Output (gitignored): spatial-office-collaborator-unlock-removal.local.txt
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  loadCollaboratorSelection,
  readUnlockAdminEmailSet,
} from "./lib/spatial-access-grants-core.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function main() {
  const { rosterIndex, entry } = loadCollaboratorSelection(root);
  const unlockPath = path.join(
    root,
    "spatial-staff-unlock-admin-emails.local.txt",
  );
  if (!fs.existsSync(unlockPath)) {
    throw new Error("Missing spatial-staff-unlock-admin-emails.local.txt");
  }

  const current = fs
    .readFileSync(unlockPath, "utf8")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  const target = entry.email.toLowerCase();
  const filtered = current.filter((email) => email.toLowerCase() !== target);
  if (filtered.length === current.length) {
    throw new Error(
      "Selected collaborator email was not present in unlock roster file",
    );
  }

  const outPath = path.join(
    root,
    "spatial-office-collaborator-unlock-removal.local.txt",
  );
  fs.writeFileSync(outPath, `${filtered.join(",")}\n`, "utf8");

  const unlockSet = readUnlockAdminEmailSet(root);
  console.log(
    JSON.stringify(
      {
        roster_index: rosterIndex,
        removed_one_email: true,
        previous_unlock_count: current.length,
        updated_unlock_count: filtered.length,
        output_file: path.basename(outPath),
        selected_still_in_default_unlock_only:
          unlockSet.has(target) &&
          !current.some((email) => email.toLowerCase() === target),
        note: "Default low.end.musica@gmail.com remains via code default; staging secret should list external staff only.",
      },
      null,
      2,
    ),
  );
}

main();
