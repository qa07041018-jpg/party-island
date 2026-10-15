import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  ImageBackground,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { io, Socket } from "socket.io-client";
import {
  API,
  request,
  restore,
  saveSession,
  clearSession,
  token,
  renewSession,
} from "./src/api";
type Room = {
  id: string;
  name: string;
  owner_id: string;
  capacity: number;
  visibility: string;
  locked?: boolean;
  members: any[] | number;
  messages?: any[];
};
const art = {
  island: require("./assets/party-island.png"),
  werewolf: require("./assets/werewolf.png"),
  arcade: require("./assets/arcade.png"),
};
function Button({
  label,
  onPress,
  secondary = false,
  disabled = false,
}: {
  label: string;
  onPress: () => void;
  secondary?: boolean;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        s.button,
        secondary && s.secondary,
        (disabled || pressed) && { opacity: 0.55 },
      ]}
    >
      <Text style={s.buttonText}>{label}</Text>
    </Pressable>
  );
}
function Field({
  label,
  ...props
}: React.ComponentProps<typeof TextInput> & { label: string }) {
  return (
    <View style={{ gap: 7 }}>
      <Text style={s.label}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor="#74758d"
        style={s.input}
        {...props}
      />
    </View>
  );
}
export default function App() {
  const [user, setUser] = useState<any>(null),
    [lobby, setLobby] = useState<any>(null),
    [room, setRoom] = useState<Room | null>(null),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [status, setStatus] = useState("連線中");
  const [mode, setMode] = useState<"login" | "register" | "guest">("login"),
    [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [nickname, setNickname] = useState("");
  const [panel, setPanel] = useState<"home" | "create" | "join" | "profile">(
      "home",
    ),
    [name, setName] = useState("今晚一起聊聊"),
    [privateRoom, setPrivate] = useState(false),
    [roomPassword, setRoomPassword] = useState(""),
    [invite, setInvite] = useState(""),
    [joinPassword, setJoinPassword] = useState(""),
    [message, setMessage] = useState("");
  const socket = useRef<Socket | null>(null),
    activeRoom = useRef<Room | null>(null),
    fade = useRef(new Animated.Value(0)).current;
  const refreshLobby = useCallback(async () => {
    const d = await request("/lobby");
    setLobby(d);
    setUser(d.user);
    setRoom(d.currentRoom);
  }, []);
  useEffect(() => {
    restore()
      .then((ok) => (ok ? refreshLobby() : undefined))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
    Animated.timing(fade, {
      toValue: 1,
      duration: 500,
      useNativeDriver: true,
    }).start();
  }, [refreshLobby, fade]);
  useEffect(() => {
    activeRoom.current = room;
    if (room && socket.current?.connected)
      socket.current.emit("room:subscribe", { id: room.id });
  }, [room?.id]);
  useEffect(() => {
    if (!user?.id) return;
    const ws = io(API, {
      auth: (cb) => cb({ token: token() }),
      reconnection: true,
    });
    socket.current = ws;
    ws.on("connect", () => {
      setStatus("即時連線正常");
      if (activeRoom.current)
        ws.emit("room:subscribe", { id: activeRoom.current.id });
      refreshLobby().catch((e) => setError(e.message));
    });
    ws.on("disconnect", () => setStatus("連線中斷，正在重連"));
    ws.on("connect_error", (e) => setStatus(`無法連線：${e.message}`));
    ws.on("session:expired", () => {
      renewSession()
        .then(() => ws.connect())
        .catch((e) => setError(e.message));
    });
    ws.on("room:update", (r) => setRoom((old) => (old?.id === r.id ? r : old)));
    ws.on("room:removed", () => {
      setRoom(null);
      refreshLobby().catch((e) => setError(e.message));
    });
    let pending: ReturnType<typeof setTimeout> | undefined;
    ws.on("lobby:changed", () => {
      clearTimeout(pending);
      pending = setTimeout(
        () => refreshLobby().catch((e) => setError(e.message)),
        150,
      );
    });
    // Re-authenticate the socket after HTTP refresh; reconnect preserves room membership.
    const interval = setInterval(
      async () => {
        try {
          await renewSession();
          if (ws.connected) {
            ws.disconnect();
            ws.connect();
          } else ws.connect();
        } catch (e: any) {
          setError(e.message);
        }
      },
      12 * 60 * 1000,
    );
    return () => {
      clearTimeout(pending);
      clearInterval(interval);
      ws.disconnect();
      socket.current = null;
    };
  }, [user?.id, refreshLobby]);
  async function run(fn: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e: any) {
      setError(e.message ?? "網路異常，請稍後重試");
    } finally {
      setBusy(false);
    }
  }
  const login = () =>
    run(async () => {
      const data = await request(
        `/auth/${mode}`,
        "POST",
        mode === "guest"
          ? { nickname }
          : mode === "register"
            ? { email, password, nickname }
            : { email, password },
      );
      await saveSession(data);
      setPassword("");
      await refreshLobby();
    });
  async function enter(id: string, pw: string) {
    const r = await request(
      `/rooms/${id}/join`,
      "POST",
      pw ? { password: pw } : {},
    );
    setRoom(r);
    setPanel("home");
    await refreshLobby();
  }
  const leave = () =>
    run(async () => {
      await request(`/rooms/${room!.id}/leave`, "POST", {});
      setRoom(null);
      await refreshLobby();
    });
  const send = () =>
    run(async () => {
      if (!socket.current?.connected) throw Error("即時連線尚未恢復");
      await new Promise<void>((resolve, reject) =>
        socket
          .current!.timeout(8000)
          .emit(
            "room:chat",
            { id: room!.id, body: message },
            (e: any, r: any) =>
              e
                ? reject(Error("傳送逾時，請先確認聊天紀錄再重試"))
                : r.ok
                  ? resolve()
                  : reject(Error(r.error)),
          ),
      );
      setMessage("");
    });
  if (loading)
    return (
      <View style={[s.screen, s.center]}>
        <ActivityIndicator color="#ad91ff" />
        <Text style={s.muted}>正在連接玩伴島…</Text>
      </View>
    );
  return (
    <KeyboardAvoidingView
      style={s.screen}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView
        contentContainerStyle={s.container}
        keyboardShouldPersistTaps="handled"
      >
        <Animated.View style={{ opacity: fade, gap: 24 }}>
          <View style={s.header}>
            <View>
              <Text style={s.brand}>◈ 玩伴島</Text>
              <Text style={s.eyebrow}>PARTY ISLAND · 一起玩，才有故事</Text>
            </View>
            {user ? (
              <Pressable
                onPress={() => setPanel("profile")}
                accessibilityRole="button"
                accessibilityLabel="編輯個人資料"
              >
                <View
                  style={[s.avatar, { backgroundColor: user.avatar_color }]}
                >
                  <Text style={s.avatarText}>{user.nickname.slice(0, 1)}</Text>
                </View>
              </Pressable>
            ) : (
              <Text style={s.tag}>EARLY ACCESS</Text>
            )}
          </View>
          {error ? (
            <View accessibilityRole="alert" style={s.error}>
              <Text style={{ color: "#ffc6cb" }}>{error}</Text>
            </View>
          ) : null}
          {!user ? (
            <>
              <ImageBackground
                source={art.island}
                style={s.hero}
                imageStyle={{ borderRadius: 24, width: "100%", height: "100%" }}
              >
                <View style={s.heroShade}>
                  <Text style={s.tag}>YOUR NEXT FAVORITE PLACE</Text>
                  <Text style={s.heroTitle}>聲音相遇，{"\n"}故事開始。</Text>
                  <Text style={s.heroDescription}>
                    先認識彼此，再一起開啟遊戲之夜。
                  </Text>
                </View>
              </ImageBackground>
              <View style={s.card}>
                <View style={s.row}>
                  {(["login", "register", "guest"] as const).map((m) => (
                    <Pressable
                      key={m}
                      onPress={() => setMode(m)}
                      accessibilityRole="button"
                    >
                      <Text style={[s.tab, mode === m && { color: "#c5acff" }]}>
                        {m === "login"
                          ? "登入"
                          : m === "register"
                            ? "建立帳號"
                            : "訪客體驗"}
                      </Text>
                    </Pressable>
                  ))}
                </View>
                {mode !== "login" ? (
                  <Field
                    label="暱稱"
                    value={nickname}
                    onChangeText={setNickname}
                    maxLength={24}
                  />
                ) : null}
                {mode !== "guest" ? (
                  <>
                    <Field
                      label="電子信箱"
                      value={email}
                      onChangeText={setEmail}
                      autoCapitalize="none"
                      keyboardType="email-address"
                    />
                    <Field
                      label="密碼（至少 10 個字元）"
                      value={password}
                      onChangeText={setPassword}
                      secureTextEntry
                      maxLength={128}
                    />
                  </>
                ) : null}
                <Button
                  label={
                    busy
                      ? "處理中…"
                      : mode === "login"
                        ? "登入玩伴島 →"
                        : mode === "register"
                          ? "建立我的帳號 →"
                          : "以訪客身分探索 →"
                  }
                  disabled={busy}
                  onPress={login}
                />
                <Text style={s.muted}>
                  帳號與房間資料儲存在伺服器。訪客請勿登出後遺失工作階段。
                </Text>
              </View>
            </>
          ) : (
            <>
              <View style={s.row}>
                <Text style={s.muted}>{status}</Text>
                <Text style={s.tag}>{lobby?.online ?? 0} 人即時連線</Text>
              </View>
              {room ? (
                <>
                  <View style={s.card}>
                    <View style={s.row}>
                      <Text style={s.title}>{room.name}</Text>
                      <Text style={s.tag}>文字派對</Text>
                    </View>
                    <Text selectable style={s.muted}>
                      邀請碼：{room.id}
                    </Text>
                    <Text style={s.muted}>
                      本階段開放文字互動；語音及遊戲尚未開放。
                    </Text>
                    <View style={s.seats}>
                      {Array.from({ length: room.capacity }, (_, i) => {
                        const m = Array.isArray(room.members)
                          ? room.members.find((x) => x.seat === i + 1)
                          : null;
                        return (
                          <View key={i} style={s.seat}>
                            <View
                              style={[
                                s.avatar,
                                {
                                  backgroundColor: m?.avatar_color ?? "#27283f",
                                },
                              ]}
                            >
                              <Text style={s.avatarText}>
                                {m ? m.nickname.slice(0, 1) : "＋"}
                              </Text>
                            </View>
                            <Text numberOfLines={1} style={s.label}>
                              {m?.nickname ?? "等你入座"}
                            </Text>
                            {m?.user_id === room.owner_id ? (
                              <Text style={s.tag}>房主</Text>
                            ) : null}
                            {user.id === room.owner_id &&
                            m &&
                            m.user_id !== user.id ? (
                              <Pressable
                                accessibilityRole="button"
                                onPress={() =>
                                  run(async () => {
                                    await request(
                                      `/rooms/${room.id}/kick`,
                                      "POST",
                                      { userId: m.user_id },
                                    );
                                  })
                                }
                              >
                                <Text style={{ color: "#ffb5bf" }}>移除</Text>
                              </Pressable>
                            ) : null}
                          </View>
                        );
                      })}
                    </View>
                  </View>
                  <View style={s.card}>
                    <Text style={s.title}>房間聊天</Text>
                    {room.messages?.length ? (
                      room.messages.map((m) => (
                        <View key={m.id} style={s.chat}>
                          <Text style={s.tag}>{m.nickname}</Text>
                          <Text selectable style={s.body}>
                            {m.body}
                          </Text>
                        </View>
                      ))
                    ) : (
                      <Text style={s.muted}>還沒有人說話，打個招呼吧。</Text>
                    )}
                    <Field
                      label="訊息"
                      value={message}
                      onChangeText={setMessage}
                      maxLength={500}
                      onSubmitEditing={send}
                    />
                    <Button
                      label="傳送訊息"
                      disabled={busy || !message.trim()}
                      onPress={send}
                    />
                    <Button
                      secondary
                      label="離開房間"
                      disabled={busy}
                      onPress={leave}
                    />
                  </View>
                </>
              ) : panel === "create" ? (
                <View style={s.card}>
                  <Text style={s.title}>讓今晚熱鬧起來</Text>
                  <Field
                    label="房間名稱"
                    value={name}
                    onChangeText={setName}
                    maxLength={48}
                  />
                  <Button
                    secondary
                    label={
                      privateRoom
                        ? "私人房間 · 只有邀請碼可加入"
                        : "公開房間 · 在大廳顯示"
                    }
                    onPress={() => setPrivate((v) => !v)}
                  />
                  <Field
                    label="房間密碼（選填，至少 4 碼）"
                    value={roomPassword}
                    onChangeText={setRoomPassword}
                    secureTextEntry
                  />
                  <Text style={s.muted}>
                    6 人文字派對。遊戲模式會在後續階段開放。
                  </Text>
                  <Button
                    label="建立房間"
                    disabled={busy}
                    onPress={() =>
                      run(async () => {
                        const r = await request("/rooms", "POST", {
                          name,
                          capacity: 6,
                          visibility: privateRoom ? "private" : "public",
                          game: "social",
                          ...(roomPassword ? { password: roomPassword } : {}),
                        });
                        setRoom(r);
                        setPanel("home");
                        await refreshLobby();
                      })
                    }
                  />
                  <Button
                    secondary
                    label="返回大廳"
                    onPress={() => setPanel("home")}
                  />
                </View>
              ) : panel === "join" ? (
                <View style={s.card}>
                  <Text style={s.title}>朋友的派對，缺你一席</Text>
                  <Field
                    label="房間邀請碼"
                    value={invite}
                    onChangeText={setInvite}
                    autoCapitalize="none"
                  />
                  <Field
                    label="房間密碼（若有設定）"
                    value={joinPassword}
                    onChangeText={setJoinPassword}
                    secureTextEntry
                  />
                  <Button
                    label="加入房間"
                    disabled={busy}
                    onPress={() =>
                      run(() => enter(invite.trim(), joinPassword))
                    }
                  />
                  <Button
                    secondary
                    label="返回大廳"
                    onPress={() => setPanel("home")}
                  />
                </View>
              ) : panel === "profile" ? (
                <View style={s.card}>
                  <Text style={s.title}>我的島民資料</Text>
                  <Text selectable style={s.muted}>
                    UID {user.uid} · Lv.{Math.floor(user.experience / 100) + 1}{" "}
                    · {user.experience} XP
                  </Text>
                  <Field
                    label="新暱稱"
                    placeholder={user.nickname}
                    value={nickname}
                    onChangeText={setNickname}
                  />
                  <Button
                    label="儲存暱稱"
                    disabled={busy}
                    onPress={() =>
                      run(async () => {
                        await request("/me", "PATCH", {
                          nickname,
                          avatarColor: user.avatar_color,
                        });
                        await refreshLobby();
                        setPanel("home");
                      })
                    }
                  />
                  <Button
                    secondary
                    label="登出"
                    disabled={busy}
                    onPress={() =>
                      run(async () => {
                        await clearSession();
                        setUser(null);
                        setLobby(null);
                        setRoom(null);
                        setPanel("home");
                      })
                    }
                  />
                  <Button
                    secondary
                    label="返回大廳"
                    onPress={() => setPanel("home")}
                  />
                </View>
              ) : (
                <>
                  <View>
                    <Text style={s.eyebrow}>GOOD EVENING, ISLANDER</Text>
                    <Text style={s.welcome}>{user.nickname}，今晚玩什麼？</Text>
                  </View>
                  <ImageBackground
                    source={art.island}
                    style={s.hero}
                    imageStyle={{
                      borderRadius: 24,
                      width: "100%",
                      height: "100%",
                    }}
                  >
                    <View style={s.heroShade}>
                      <Text style={s.tag}>MAKE A LITTLE CONNECTION</Text>
                      <Text style={s.heroTitle}>找到你的{"\n"}同頻玩伴。</Text>
                      <Text style={s.heroDescription}>
                        開一間房，讓陌生變成下一次的約定。
                      </Text>
                      <Button
                        label="＋ 建立派對房間"
                        onPress={() => setPanel("create")}
                      />
                    </View>
                  </ImageBackground>
                  <View style={s.row}>
                    <View>
                      <Text style={s.muted}>測試金幣</Text>
                      <Text style={s.balance}>
                        {lobby?.wallet?.coins ?? "0"} ◉
                      </Text>
                    </View>
                    <View>
                      <Text style={s.muted}>測試鑽石</Text>
                      <Text style={s.balance}>
                        {lobby?.wallet?.diamonds ?? "0"} ◇
                      </Text>
                    </View>
                    <Button
                      secondary
                      label="用邀請碼加入"
                      onPress={() => setPanel("join")}
                    />
                  </View>
                  <View style={s.row}>
                    <Text style={s.title}>今晚的遊戲清單</Text>
                    <Text style={s.muted}>逐步開放</Text>
                  </View>
                  <View style={s.games}>
                    <ImageBackground
                      source={art.werewolf}
                      style={s.game}
                      imageStyle={{
                        borderRadius: 20,
                        width: "100%",
                        height: "100%",
                      }}
                    >
                      <View style={s.gameShade}>
                        <Text style={s.tag}>推理 × 心理戰</Text>
                        <Text style={s.title}>狼人殺</Text>
                        <Text style={s.muted}>第二階段開發</Text>
                      </View>
                    </ImageBackground>
                    <ImageBackground
                      source={art.arcade}
                      style={s.game}
                      imageStyle={{
                        borderRadius: 20,
                        width: "100%",
                        height: "100%",
                      }}
                    >
                      <View style={s.gameShade}>
                        <Text style={s.tag}>默契 × 想像力</Text>
                        <Text style={s.title}>誰是臥底・你畫我猜</Text>
                        <Text style={s.muted}>接續實作</Text>
                      </View>
                    </ImageBackground>
                  </View>
                  <View style={s.row}>
                    <Text style={s.title}>公開派對</Text>
                    <Button
                      secondary
                      label="重新整理"
                      disabled={busy}
                      onPress={() => run(refreshLobby)}
                    />
                  </View>
                  {lobby?.rooms.length ? (
                    lobby.rooms.map((r: Room) => (
                      <Pressable
                        key={r.id}
                        accessibilityRole="button"
                        accessibilityLabel={`加入 ${r.name}`}
                        style={s.roomCard}
                        onPress={() => {
                          setInvite(r.id);
                          setJoinPassword("");
                          if (r.locked) setPanel("join");
                          else run(() => enter(r.id, ""));
                        }}
                      >
                        <View style={s.roomIcon}>
                          <Text style={{ fontSize: 24 }}>✦</Text>
                        </View>
                        <View style={{ flex: 1, gap: 6 }}>
                          <Text style={s.title}>{r.name}</Text>
                          <Text style={s.muted}>
                            {Number(r.members)} / {r.capacity} 人 ·{" "}
                            {r.locked ? "密碼保護" : "自由加入"}
                          </Text>
                        </View>
                        <Text style={s.tag}>加入 →</Text>
                      </Pressable>
                    ))
                  ) : (
                    <View style={s.card}>
                      <Text style={s.title}>第一個故事，由你開始</Text>
                      <Text style={s.muted}>
                        目前沒有公開房間。建立房間並邀請另一個帳號加入。
                      </Text>
                    </View>
                  )}
                  {lobby?.announcements.map((a: any) => (
                    <View key={a.id} style={s.card}>
                      <Text style={s.tag}>島上公告</Text>
                      <Text style={s.title}>{a.title}</Text>
                      <Text style={s.body}>{a.body}</Text>
                    </View>
                  ))}
                </>
              )}
            </>
          )}
          <Text style={[s.muted, { textAlign: "center", paddingBottom: 20 }]}>
            PARTY ISLAND · 原創多人社交平台 · 第一階段
          </Text>
        </Animated.View>
      </ScrollView>
      {busy ? (
        <View style={s.busy}>
          <ActivityIndicator color="#fff" />
        </View>
      ) : null}
    </KeyboardAvoidingView>
  );
}
const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#0c0d17" },
  center: { alignItems: "center", justifyContent: "center", gap: 16 },
  container: {
    width: "100%",
    maxWidth: 760,
    alignSelf: "center",
    paddingHorizontal: 22,
    paddingTop: Platform.OS === "ios" ? 62 : 32,
    paddingBottom: 30,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  brand: { color: "#f4efff", fontSize: 25, fontWeight: "800" },
  eyebrow: { color: "#8c8ca8", fontSize: 10, letterSpacing: 1.5, marginTop: 7 },
  tag: { color: "#c5adff", fontSize: 11, fontWeight: "700" },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { color: "#fff", fontSize: 21, fontWeight: "700" },
  card: {
    backgroundColor: "#171827",
    borderRadius: 22,
    padding: 22,
    gap: 18,
    borderWidth: 1,
    borderColor: "#2a2a42",
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
    flexWrap: "wrap",
  },
  title: { color: "#f4f1ff", fontSize: 18, fontWeight: "700" },
  welcome: { color: "#fff", fontSize: 25, fontWeight: "800", marginTop: 10 },
  muted: { color: "#9696ae", fontSize: 12, lineHeight: 20 },
  body: { color: "#dedcec", fontSize: 14, lineHeight: 23 },
  label: { color: "#b7b4cd", fontSize: 12 },
  input: {
    backgroundColor: "#10111e",
    borderColor: "#34344e",
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    color: "#fff",
    fontSize: 15,
    minHeight: 48,
  },
  button: {
    backgroundColor: "#8360e7",
    borderRadius: 13,
    paddingVertical: 14,
    paddingHorizontal: 18,
    alignItems: "center",
  },
  secondary: { backgroundColor: "#292a40" },
  buttonText: { color: "#fff", fontWeight: "700", fontSize: 13 },
  tab: { fontSize: 15, color: "#87879f", paddingVertical: 8 },
  error: { backgroundColor: "#42232e", padding: 15, borderRadius: 12 },
  hero: {
    minHeight: 300,
    borderRadius: 24,
    overflow: "hidden",
    justifyContent: "flex-end",
  },
  heroShade: {
    backgroundColor: "rgba(10,9,28,.52)",
    padding: 24,
    gap: 14,
    paddingTop: 45,
  },
  heroTitle: { fontSize: 35, fontWeight: "900", color: "#fff", lineHeight: 43 },
  heroDescription: { fontSize: 13, color: "#e0d8ef", lineHeight: 21 },
  balance: { color: "#e5d6ff", fontSize: 22, fontWeight: "800", marginTop: 6 },
  games: { flexDirection: "row", gap: 12 },
  game: {
    flex: 1,
    minHeight: 220,
    justifyContent: "flex-end",
    borderRadius: 20,
    overflow: "hidden",
  },
  gameShade: { backgroundColor: "rgba(12,10,24,.7)", padding: 14, gap: 9 },
  roomCard: {
    backgroundColor: "#191a2b",
    borderWidth: 1,
    borderColor: "#2a2b43",
    borderRadius: 18,
    padding: 18,
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
  },
  roomIcon: { backgroundColor: "#36304f", padding: 12, borderRadius: 15 },
  seats: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 18,
    justifyContent: "center",
  },
  seat: { width: 83, alignItems: "center", gap: 7, paddingVertical: 12 },
  chat: { backgroundColor: "#222238", borderRadius: 14, padding: 14, gap: 7 },
  busy: {
    position: "absolute",
    right: 15,
    bottom: 20,
    backgroundColor: "#7452d0",
    padding: 14,
    borderRadius: 30,
  },
});
