import fs from "node:fs/promises";
import path from "node:path";

const dataDir = process.env.DATA_DIR || "./data";
const dataFile = path.join(dataDir, "preferences.json");
let state = { users: {} };

export async function loadStore() {
  await fs.mkdir(dataDir, { recursive: true });
  try {
    state = JSON.parse(await fs.readFile(dataFile, "utf8"));
    if (!state || typeof state !== "object" || !state.users) state = { users: {} };
  } catch (e) {
    if (e.code !== "ENOENT") console.error("读取偏好文件失败：", e.message);
    state = { users: {} };
    await saveStore();
  }
}

async function saveStore() {
  await fs.mkdir(dataDir, { recursive: true });
  const tmp = `${dataFile}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(state, null, 2), "utf8");
  await fs.rename(tmp, dataFile);
}

function userRecord(userId) {
  state.users[userId] ??= { defaultNotes: [], profiles: {} };
  state.users[userId].defaultNotes ??= [];
  state.users[userId].profiles ??= {};
  return state.users[userId];
}

export async function addNote(userId, profile, note) {
  const u = userRecord(userId);
  const list = profile ? (u.profiles[profile] ??= []) : u.defaultNotes;
  if (!list.includes(note)) list.push(note);
  if (list.length > 30) list.shift();
  await saveStore();
}

export function getNotes(userId, profile) {
  const u = state.users[userId];
  if (!u) return { defaults: [], profile: [] };
  return {
    defaults: u.defaultNotes || [],
    profile: profile ? (u.profiles?.[profile] || []) : []
  };
}

export function listProfiles(userId) {
  return Object.keys(state.users[userId]?.profiles || {});
}

export async function forgetNotes(userId, profile) {
  const u = userRecord(userId);
  if (profile) delete u.profiles[profile];
  else u.defaultNotes = [];
  await saveStore();
}
