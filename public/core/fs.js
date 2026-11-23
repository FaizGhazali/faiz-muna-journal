// The Firestore calls the app uses, pointed at the real database or, in the demo, at memdb.js.
// app.js picks once at start-up with useMemory(); every other file imports from here, not from gstatic.
import * as real from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import * as memory from "./memdb.js";

let impl = real;
export function useMemory() { impl = memory; }

export const collection = (...a) => impl.collection(...a);
export const doc = (...a) => impl.doc(...a);
export const setDoc = (...a) => impl.setDoc(...a);
export const updateDoc = (...a) => impl.updateDoc(...a);
export const deleteDoc = (...a) => impl.deleteDoc(...a);
export const getDoc = (...a) => impl.getDoc(...a);
export const getDocs = (...a) => impl.getDocs(...a);
export const onSnapshot = (...a) => impl.onSnapshot(...a);
export const writeBatch = (...a) => impl.writeBatch(...a);
export const query = (...a) => impl.query(...a);
export const where = (...a) => impl.where(...a);
export const arrayUnion = (...a) => impl.arrayUnion(...a);
export const arrayRemove = (...a) => impl.arrayRemove(...a);
export const increment = (...a) => impl.increment(...a);
