// A stand-in for the few Firestore calls the app makes, used only by the demo.
// Data lives in this tab's sessionStorage: it survives a reload and is gone when the tab closes.
// Nothing here ever talks to the network, so demo visitors cost the real database nothing.
const KEY = "journal-demo-db";
const UNION = Symbol("union"), REMOVE = Symbol("remove"), ADD = Symbol("add");
const OPS = { "==": (a, b) => a === b, ">=": (a, b) => a >= b, "<=": (a, b) => a <= b, ">": (a, b) => a > b, "<": (a, b) => a < b };

let data = {}; // { collection: { docId: fields } }
const listeners = new Set(), dirty = new Set();
let flushing = false, n = 0;

export function openMemory(seed) {
  try { data = JSON.parse(sessionStorage.getItem(KEY)) || {}; } catch (_) { data = {}; }
  if (!Object.keys(data).length) { data = seed(); save(); }
  return { memory: true };
}
function save() { try { sessionStorage.setItem(KEY, JSON.stringify(data)); } catch (_) {} }

// Like Firestore, listeners hear about a change a moment later, and only for the collection that changed.
function touch(col) {
  save();
  dirty.add(col);
  if (flushing) return;
  flushing = true;
  setTimeout(() => {
    const cols = new Set(dirty);
    dirty.clear(); flushing = false;
    listeners.forEach((l) => { if (cols.has(l.col)) l.fire(); });
  }, 0);
}

const autoId = () => Date.now().toString(36) + (n++).toString(36) + Math.random().toString(36).slice(2, 8);
const clone = (v) => structuredClone(v);
const isSentinel = (v) => v && typeof v === "object" && (UNION in v || REMOVE in v || ADD in v);

export const collection = (_db, name) => ({ kind: "col", name });
export function doc(parent, a, b) {
  if (parent.kind === "col") return { kind: "doc", col: parent.name, id: a ?? autoId() };
  return { kind: "doc", col: a, id: b }; // doc(db, "config", "people")
}
export const where = (field, op, value) => ({ field, op, value });
export const query = (col, ...wheres) => ({ ...col, wheres });
export const arrayUnion = (...v) => ({ [UNION]: v });
export const arrayRemove = (...v) => ({ [REMOVE]: v });
export const increment = (by) => ({ [ADD]: by });

function docSnap(ref) {
  const d = data[ref.col]?.[ref.id];
  return { id: ref.id, exists: () => !!d, data: () => (d ? clone(d) : undefined), metadata: { fromCache: false } };
}
function colSnap(q) {
  const rows = Object.entries(data[q.name] || {}).filter(([, d]) => (q.wheres || []).every((w) => OPS[w.op](d[w.field], w.value)));
  const docs = rows.map(([id, d]) => ({ id, exists: () => true, data: () => clone(d) }));
  return { docs, size: docs.length, empty: !docs.length, forEach: (f) => docs.forEach(f) };
}

export function onSnapshot(target, next) {
  const l = { col: target.kind === "doc" ? target.col : target.name, fire: () => next(target.kind === "doc" ? docSnap(target) : colSnap(target)) };
  listeners.add(l);
  setTimeout(() => { if (listeners.has(l)) l.fire(); }, 0);
  return () => listeners.delete(l);
}

function write(ref, body, merge) {
  const col = (data[ref.col] ||= {}), old = (merge && col[ref.id]) || {}, out = merge ? { ...old } : {};
  for (const [k, v] of Object.entries(body)) {
    if (isSentinel(v) && ADD in v) out[k] = (typeof old[k] === "number" ? old[k] : 0) + v[ADD];
    else if (isSentinel(v)) {
      const have = Array.isArray(old[k]) ? old[k] : [];
      out[k] = UNION in v ? [...have, ...v[UNION].filter((x) => !have.includes(x))] : have.filter((x) => !v[REMOVE].includes(x));
    } else out[k] = clone(v);
  }
  col[ref.id] = out;
  touch(ref.col);
}
// Like Firestore, refuse a field that is undefined, at once (not in the promise), so the demo shows the same bug.
function noUndefined(v, path = "") {
  if (v === undefined) throw new Error(`invalid-argument: unsupported field value undefined (found in field ${path || "document"})`);
  if (v && typeof v === "object" && !isSentinel(v)) for (const [k, x] of Object.entries(v)) noUndefined(x, path ? `${path}.${k}` : k);
}
export function setDoc(ref, body, opts) { noUndefined(body); return Promise.resolve(write(ref, body, !!opts?.merge)); }
export function updateDoc(ref, patch) {
  noUndefined(patch);
  if (!data[ref.col]?.[ref.id]) return Promise.reject(new Error("not-found"));
  return Promise.resolve(write(ref, patch, true));
}
export async function deleteDoc(ref) { if (data[ref.col]) delete data[ref.col][ref.id]; touch(ref.col); }
export const getDoc = async (ref) => docSnap(ref);
export const getDocs = async (q) => colSnap(q);
export function writeBatch() {
  const ops = [];
  return {
    set(ref, body, opts) { noUndefined(body); ops.push({ ref, body, merge: !!opts?.merge }); return this; },
    update(ref, body) { noUndefined(body); ops.push({ ref, body, merge: true, requireExisting: true }); return this; },
    delete(ref) { ops.push({ ref }); return this; },
    async commit() {
      // Validate updates before applying any writes, including earlier writes to the same document.
      const exists = new Map();
      for (const { ref, body, requireExisting } of ops) {
        const key = JSON.stringify([ref.col, ref.id]);
        if (requireExisting && !(exists.get(key) ?? !!data[ref.col]?.[ref.id])) throw new Error("not-found");
        exists.set(key, !!body);
      }
      for (const { ref, body, merge } of ops) {
        if (body) write(ref, body, merge);
        else { if (data[ref.col]) delete data[ref.col][ref.id]; touch(ref.col); }
      }
    },
  };
}
