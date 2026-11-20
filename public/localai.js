// Dearly's writer runs inside the browser with WebLLM on WebGPU: no server, no API key, no cost per use.
// The model is downloaded once, only when someone taps Download, and kept in the browser's Cache Storage
// ("webllm/model", "webllm/wasm", "webllm/config"; sw.js leaves those alone). Diary text never leaves the device.
// Inference runs in aiworker.js so the page stays smooth while it writes.
const LIB = "https://cdn.jsdelivr.net/npm/@mlc-ai/web-llm@0.2.86/lib/index.js";

// Small instruction models that handle English and Malay. Sizes are the one-time download; memory is what the GPU needs.
export const MODELS = [
  { key: "tiny", base: "Qwen2.5-0.5B-Instruct", name: "Small", size: "about 0.3 GB", gb: 0.3, mem: 1.0,
    note: "For phones and older computers. Quick, but plainer writing and more slips, so read it carefully." },
  { key: "small", base: "Qwen2.5-1.5B-Instruct", name: "Medium", size: "about 0.9 GB", gb: 0.9, mem: 1.7,
    note: "The best balance. Works on most laptops and newer phones." },
  { key: "better", base: "Qwen2.5-3B-Instruct", name: "Large", size: "about 1.7 GB", gb: 1.7, mem: 2.6,
    note: "Most natural writing, Malay included. For a laptop or desktop with 8 GB of memory or more." },
];
export const modelOf = (key) => MODELS.find((m) => m.key === key) || MODELS[1];
// Phones without 16-bit GPU maths need the 32-bit build of the same model.
export const idOf = (key, f16) => `${modelOf(key).base}-${f16 ? "q4f16_1" : "q4f32_1"}-MLC`;

let wl = null, engine = null, worker = null, loadedId = null, loading = null;
const lib = async () => (wl ||= await import(LIB));

// Can this browser run the writer? { ok, why?, f16, soft, memGB, mobile }
export async function checkSupport() {
  const mobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Mac/.test(navigator.platform || ""));
  const memGB = navigator.deviceMemory || null; // Chrome and Edge only, rounded and capped at 8
  // Phones and tablets: the on-device writer is off. Tested on the family's phones it was too slow, ran out of
  // memory or scrambled words, so phones use the cloud writer (or write it themselves) instead.
  if (mobile) return { ok: false, why: "mobile", mobile, memGB };
  if (!isSecureContext) return { ok: false, why: "insecure", mobile, memGB };
  if (!("gpu" in navigator)) return { ok: false, why: "nowebgpu", mobile, memGB };
  let adapter = null;
  try { adapter = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" }); } catch (_) {}
  if (!adapter) return { ok: false, why: "noadapter", mobile, memGB };
  const soft = !!(adapter.info?.isFallbackAdapter ?? adapter.isFallbackAdapter);
  const L = adapter.limits, info = adapter.info || {};
  // gpu: plain facts for "Copy details" when something fails (chip and limits only, never diary text).
  const gpu = `${info.vendor || "?"} ${info.architecture || ""} ${info.device || ""}`.trim() + ` · f16 ${adapter.features.has("shader-f16") ? "yes" : "no"}`
    + ` · maxBuffer ${Math.round(L.maxBufferSize / 2 ** 20)}MB · maxStorageBinding ${Math.round(L.maxStorageBufferBindingSize / 2 ** 20)}MB · workgroupStorage ${L.maxComputeWorkgroupStorageSize}`;
  return { ok: true, f16: adapter.features.has("shader-f16"), soft, mobile, memGB, maxBuffer: L.maxStorageBufferBindingSize, gpu };
}
// The size to suggest for this device.
export function suggestKey(s) {
  if (!s?.ok) return "small";
  if (s.mobile || (s.memGB && s.memGB <= 4) || s.soft) return "tiny";
  return "small";
}
export function whyText(why) {
  return {
    mobile: "The on-device writer is too heavy for phones, so it's switched off here. It still works on a computer.",
    insecure: "The writer needs a secure (https) page.",
    nowebgpu: "This browser can't use the graphics chip for AI yet (no WebGPU). It works in recent Chrome or Edge on a computer, Chrome on many Android phones, and Safari on iOS 26 or newer.",
    noadapter: "This browser has WebGPU, but no graphics chip it can use was found. The graphics driver may be too old, or the browser has it switched off.",
  }[why] || "The writer can't run in this browser.";
}

// Free the space a model downloaded on a phone before the writer was switched off there. Only Dearly's model
// caches (webllm/*), never the app's own. Returns true when something was removed.
export async function clearAll() {
  try {
    const ks = (await caches.keys()).filter((k) => k.startsWith("webllm"));
    await Promise.all(ks.map((k) => caches.delete(k)));
    return ks.length > 0;
  } catch (_) { return false; }
}

export async function isDownloaded(key, f16) {
  try { return await (await lib()).hasModelInCache(idOf(key, f16)); } catch (_) { return false; }
}

// Download (first time) or open (after that) the model, reporting { progress 0..1, phase: "download"|"open", text }.
export async function load(key, f16, onProgress) {
  const id = idOf(key, f16);
  if (engine && loadedId === id) return engine;
  if (loading) { await loading.catch(() => {}); if (engine && loadedId === id) return engine; }
  const report = (r) => onProgress?.({ progress: r.progress || 0, phase: /fetch|download/i.test(r.text || "") ? "download" : "open", text: r.text || "" });
  loading = (async () => {
    const w = await lib();
    if (!engine) {
      worker = new Worker(new URL("./aiworker.js", import.meta.url), { type: "module" });
      engine = await w.CreateWebWorkerMLCEngine(worker, id, { initProgressCallback: report });
    } else {
      engine.setInitProgressCallback(report);
      await engine.reload(id);
    }
    loadedId = id;
    return engine;
  })();
  try { return await loading; } catch (e) { if (gpuLost(e)) { reset(); throw lostError(e); } loadedId = null; throw e; } finally { loading = null; }
}
export const isLoaded = (key, f16) => !!engine && loadedId === idOf(key, f16);

// The GPU dropped the work: phone watchdogs kill long jobs, and the browser then unmaps buffers mid-read.
// The engine can't be trusted after that, so it's thrown away and the next use starts a fresh worker.
const gpuLost = (e) => /mapAsync|unmapped|device (?:was |is )?lost|DeviceLost|GPU device|context lost/i.test(String(e?.message || e));
const lostError = (e) => Object.assign(new Error("gpu-lost"), { cause: e });
function reset() { try { worker?.terminate(); } catch (_) {} worker = null; engine = null; loadedId = null; }

// Write from chat messages, calling onText with everything so far. Abort the signal to stop early.
export async function write(messages, onText, signal) {
  if (!engine) throw new Error("not-loaded");
  const stop = () => { try { engine.interruptGenerate(); } catch (_) {} };
  signal?.addEventListener("abort", stop);
  let out = "";
  try {
    const stream = await engine.chat.completions.create({ messages, stream: true, temperature: 0.3, top_p: 0.85, frequency_penalty: 0.2, max_tokens: 700 });
    for await (const c of stream) {
      out += c.choices?.[0]?.delta?.content || "";
      onText(out);
      if (signal?.aborted) break;
    }
  } catch (e) {
    if (gpuLost(e)) { reset(); throw lostError(e); }
    throw e;
  } finally { signal?.removeEventListener("abort", stop); }
  try { await engine.resetChat(); } catch (e) { if (gpuLost(e)) reset(); } // each entry starts fresh; nothing is remembered between them
  return out;
}

export async function remove(key, f16) {
  const id = idOf(key, f16);
  if (engine && loadedId === id) { try { await engine.unload(); } catch (_) {} loadedId = null; }
  await (await lib()).deleteModelAllInfoInCache(id);
}

// Ask the browser not to clear the download when space runs low. Returns true when it agrees.
export async function keepStorage() {
  try { return (await navigator.storage?.persisted?.()) || (await navigator.storage?.persist?.()) || false; } catch (_) { return false; }
}
export async function storageInfo() {
  try {
    const [est, kept] = await Promise.all([navigator.storage.estimate(), navigator.storage.persisted?.()]);
    return { used: est.usage || 0, quota: est.quota || 0, kept: !!kept };
  } catch (_) { return null; }
}

// Plain words for what went wrong.
export function errorText(e) {
  const m = String(e?.message || e || "");
  if (/quota|storage|space/i.test(m)) return "There isn't enough free space on this device to keep the model. Free some space or pick a smaller size.";
  if (/memory|OOM|allocate|device was lost|device lost|out of/i.test(m)) return "This device ran out of graphics memory. Close other tabs and try again, or pick the Small size.";
  if (/fetch|network|Failed to load|NetworkError|offline/i.test(m) || !navigator.onLine) return "The download stopped. Check the connection and tap Download again: the parts already saved are kept.";
  if (/shader-f16|feature/i.test(m)) return "This graphics chip can't run that build of the writer. Try the other build below.";
  if (/maxBufferSize|maxStorageBufferBindingSize|maxComputeWorkgroupStorageSize|exposes/i.test(m)) return "This phone's browser doesn't give the writer enough graphics memory for this build. Try the other build below, or the Small size.";
  if (m === "gpu-lost") return "The phone's graphics chip stopped the writer partway, twice. Close other apps, keep the screen on, and try again, or use the Small size.";
  if (/compil|pipeline|shader|WGSL|validation/i.test(m)) return "The writer couldn't set itself up on this graphics chip. Try the other build below.";
  return "The writer couldn't start on this device. You can still write yourself.";
}
