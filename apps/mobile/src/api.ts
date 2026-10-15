import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
export const API = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:4000";
let access = "";
let refresh = "";
let renewing: Promise<void> | null = null;
export const token = () => access;
async function timedFetch(input: string, init: RequestInit) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}
const storage = {
  async get() {
    return Platform.OS === "web"
      ? sessionStorage.getItem("island.refresh")
      : SecureStore.getItemAsync("island.refresh");
  },
  async set(v: string) {
    if (Platform.OS === "web") {
      if (v) sessionStorage.setItem("island.refresh", v);
      else sessionStorage.removeItem("island.refresh");
    } else if (v) await SecureStore.setItemAsync("island.refresh", v);
    else await SecureStore.deleteItemAsync("island.refresh");
  },
};
export async function saveSession(s: any) {
  access = s.accessToken;
  refresh = s.refreshToken;
  await storage.set(refresh);
}
export async function clearSession() {
  const old = refresh;
  access = "";
  refresh = "";
  await storage.set("");
  if (old)
    await timedFetch(`${API}/auth/logout`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken: old }),
    }).catch(() => {});
}
async function rotate() {
  const r = await timedFetch(`${API}/auth/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refreshToken: refresh }),
  });
  const data = await r.json();
  if (!r.ok) throw Error("登入已失效，請登出後重新登入");
  await saveSession(data);
}
export async function renewSession() {
  if (!renewing)
    renewing = rotate().finally(() => {
      renewing = null;
    });
  return renewing;
}
export async function restore() {
  refresh = (await storage.get()) ?? "";
  if (!refresh) return false;
  try {
    await rotate();
    return true;
  } catch {
    await clearSession();
    return false;
  }
}
export async function request(
  path: string,
  method = "GET",
  body?: unknown,
  retry = true,
): Promise<any> {
  const r = await timedFetch(`${API}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(access ? { Authorization: `Bearer ${access}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (r.status === 401 && retry && refresh && !path.startsWith("/auth/")) {
    if (!renewing)
      renewing = rotate().finally(() => {
        renewing = null;
      });
    await renewing;
    return request(path, method, body, false);
  }
  const data = await r.json().catch(() => ({ message: "伺服器回應格式錯誤" }));
  if (!r.ok)
    throw Error(
      Array.isArray(data.message)
        ? data.message.join("、")
        : (data.message ?? `操作失敗 (${r.status})`),
    );
  return data;
}
