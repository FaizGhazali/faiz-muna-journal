// Ledger: first-run seeds and the few writes that touch several collections at once.
// The maths lives in ledger.js (pure); this file only talks to Firestore through fs.js.
import { collection, doc, getDocs, setDoc, writeBatch } from "../../core/fs.js";
import { SEED_ALIASES, PRESETS } from "../../logic/ledger.js";

// Bump when SEED_ALIASES gains rules; only rules the family doesn't already have are added.
export const SEED_VERSION = 1;

// Adds the seed merchant rules once. Never overwrites or brings back a rule someone edited or deleted:
// a seed id that was ever written is remembered in config/ledger.seeded.
export async function ensureSeeds(db) {
  const meta = await getDocs(collection(db, "config"));
  let cfg = {};
  meta.forEach((d) => { if (d.id === "ledger") cfg = d.data(); });
  if ((cfg.seedVersion ?? 0) >= SEED_VERSION) return false;
  const known = new Set(cfg.seeded ?? []);
  const batch = writeBatch(db), now = Date.now();
  const added = [];
  for (const { id, ...rule } of SEED_ALIASES) {
    if (known.has(id)) continue;
    batch.set(doc(db, "ledgerAliases", id), { ...rule, created: now });
    added.push(id);
  }
  batch.set(doc(db, "config", "ledger"), { seedVersion: SEED_VERSION, seeded: [...known, ...added] }, { merge: true });
  await batch.commit();
  return true;
}

// A new card, optionally with a rebate program copied from a preset (the copy is the family's to edit).
export async function addAccount(db, account, preset) {
  const ref = doc(collection(db, "ledgerAccounts"));
  const now = Date.now(), acc = { cycleBasis: "posted", active: true, openingSen: 0, created: now, updated: now, ...account };
  const batch = writeBatch(db);
  batch.set(ref, acc);
  if (preset && PRESETS[preset]) {
    const p = doc(collection(db, "ledgerPrograms"));
    batch.set(p, { ...structuredClone(PRESETS[preset]), account: ref.id, preset, created: now, updated: now });
    batch.set(ref, { program: p.id }, { merge: true });
  }
  await batch.commit();
  return ref.id;
}

// Saves a cycle's dates the first time a transaction lands in it (balance stays empty until a statement is imported).
export const saveCycle = (db, c) => setDoc(doc(db, "ledgerCycles", c.id), { account: c.account, start: c.start, statement: c.statement, due: c.due, updated: Date.now() }, { merge: true });
