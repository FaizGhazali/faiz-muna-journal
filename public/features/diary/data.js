// Dearly's photo loading and permanent deletes (diary/{id}, diaryPhotos/{id}).
import { doc, deleteDoc, getDocs, query, where } from "../../core/fs.js";
import { expired } from "../../logic/diary.js";
import { S } from "./state.js";

export const photoCache = new Map(); // entry id -> its photos, so going back and forth doesn't reload them

export async function loadPhotos(e) {
  if (photoCache.has(e.id)) return photoCache.get(e.id);
  try {
    const snap = await getDocs(query(S.photosCol, where("entry", "==", e.id)));
    const order = e.photos || [];
    const out = snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((p) => /^data:image\//.test(p.data || "")).sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
    photoCache.set(e.id, out);
    return out;
  } catch (_) { return []; }
}

export async function removeForever(e) {
  const snap = await getDocs(query(S.photosCol, where("entry", "==", e.id))).catch(() => null);
  await S.commit(() => Promise.all([deleteDoc(doc(S.diaryCol, e.id)), ...(snap ? snap.docs.map((d) => deleteDoc(doc(S.photosCol, d.id))) : [])]));
  photoCache.delete(e.id);
}

// Entries kept in Recently deleted for longer than the keep period go for good, photos too.
let purging = false;
export async function purge() {
  if (purging) return;
  const old = S.list.filter((e) => expired(e, Date.now()));
  if (!old.length) return;
  purging = true;
  try { for (const e of old) await removeForever(e); } finally { purging = false; }
}
