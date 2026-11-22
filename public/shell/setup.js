// First-run setup: the two people (name, age, sex, height) and their starting weights. Writes config/people and
// one starting entry each; the config/people snapshot in app.js then opens the journal.
import { doc, writeBatch } from "../core/fs.js";
import { r1 } from "../logic/bmi.js";
import { $, today } from "../core/util.js";

let db, entriesCol;

export function initSetup(opts) {
  ({ db, entriesCol } = opts);
  $("setupForm").addEventListener("submit", save);
}

export function buildSetup() {
  $("startDate").value = today();
  $("setupPeople").innerHTML = [1, 2].map((n) => `<fieldset>
    <legend>Person ${n}</legend>
    <label for="s${n}-name">Name<input type="text" id="s${n}-name" autocomplete="off"></label>
    <div class="two">
      <label for="s${n}-age">Age<input id="s${n}-age" type="number" min="1" max="120" inputmode="numeric"></label>
      <label for="s${n}-sex">Sex<select id="s${n}-sex"><option>Male</option><option>Female</option></select></label>
    </div>
    <div class="two">
      <label for="s${n}-cm">Height, cm<input id="s${n}-cm" type="number" min="100" max="250" inputmode="numeric"></label>
      <label for="s${n}-kg">Weight, kg<input id="s${n}-kg" type="number" min="30" max="250" step="0.1" inputmode="decimal"></label>
    </div></fieldset>`).join("");
}

async function save(ev) {
  ev.preventDefault();
  const msg = $("setupMsg"), date = $("startDate").value, people = [], batch = writeBatch(db);
  for (const n of [1, 2]) {
    const name = $(`s${n}-name`).value.trim(), age = Number($(`s${n}-age`).value), cm = Number($(`s${n}-cm`).value), kg = r1(Number($(`s${n}-kg`).value));
    if (!name || !(age >= 1 && age <= 120) || !(cm >= 100 && cm <= 250) || !(kg >= 30 && kg <= 250)) { msg.textContent = `Fill in every field for person ${n}. Height is 100 to 250 cm and weight is 30 to 250 kg.`; return; }
    const id = "p" + n;
    people.push({ id, name, age, sex: $(`s${n}-sex`).value, cm });
    batch.set(doc(entriesCol, `${id}_${date}`), { person: id, date, weight: kg, note: "Starting weight.", created: Date.now(), updated: Date.now() });
  }
  if (!date) { msg.textContent = "Pick the date of these weights."; return; }
  batch.set(doc(db, "config", "people"), { people, created: Date.now(), updated: Date.now() });
  $("setupSave").disabled = true;
  try { await batch.commit(); } catch (_) { msg.textContent = "That didn't save. Check your connection and try again."; $("setupSave").disabled = false; }
}
