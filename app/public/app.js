let token = localStorage.getItem("token") || "";
let state = { servers: [], channels: [], me: null, currentChannelId: null, currentVoiceId: null, muted_mic: false, muted_all: false };
const socket = io();

const authView = document.getElementById("authView");
const appView = document.getElementById("appView");
const authMsg = document.getElementById("authMsg");

const api = async (url, method = "GET", body, isForm = false) => {
  const opts = { method, headers: {} };
  if (token) opts.headers.Authorization = `Bearer ${token}`;
  if (body) {
    if (isForm) {
      opts.body = body;
    } else {
      opts.headers["Content-Type"] = "application/json";
      opts.body = JSON.stringify(body);
    }
  }
  const res = await fetch(url, opts);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Błąd API");
  return data;
};

async function bootstrap() {
  if (!token) return;
  try {
    state = { ...state, ...(await api("/api/bootstrap")) };
    authView.classList.add("hidden");
    appView.classList.remove("hidden");
    render();
  } catch {
    token = "";
    localStorage.removeItem("token");
  }
}

function render() {
  const serversBox = document.getElementById("servers");
  serversBox.innerHTML = "";
  state.servers.forEach((s) => {
    const div = document.createElement("div");
    div.className = "server-pill";
    div.textContent = s.name[0].toUpperCase();
    serversBox.appendChild(div);
  });

  const textChannels = state.channels.filter((c) => c.type === "text");
  const voiceChannels = state.channels.filter((c) => c.type === "voice");

  const txt = document.getElementById("textChannels");
  const vc = document.getElementById("voiceChannels");
  txt.innerHTML = "";
  vc.innerHTML = "";

  for (const ch of textChannels) {
    const el = document.createElement("div");
    el.className = `channel-item ${state.currentChannelId === ch.id ? "active" : ""}`;
    el.textContent = `# ${ch.name}`;
    el.onclick = () => selectTextChannel(ch.id);
    txt.appendChild(el);
  }
  for (const ch of voiceChannels) {
    const el = document.createElement("div");
    el.className = `channel-item ${state.currentVoiceId === ch.id ? "active" : ""}`;
    el.textContent = `🔊 ${ch.name} (${ch.max_users})`;
    el.onclick = () => {
      state.currentVoiceId = ch.id;
      render();
      socket.emit("join-channel", ch.id);
    };
    vc.appendChild(el);
  }

  if (state.me) {
    document.getElementById("nickname").value = state.me.nickname || "";
    document.getElementById("audioInput").value = state.me.audio_input || "default";
    document.getElementById("audioOutput").value = state.me.audio_output || "default";
    document.getElementById("micSensitivity").value = state.me.mic_sensitivity ?? 50;
    document.getElementById("autoGain").checked = !!state.me.automatic_voice_gain;
    document.getElementById("speakerVolume").value = state.me.speaker_volume ?? 70;
    document.getElementById("micVolume").value = state.me.mic_volume ?? 70;
  }
}

async function selectTextChannel(id) {
  state.currentChannelId = id;
  document.getElementById("currentChannel").textContent = `Kanał #${state.channels.find((c) => c.id === id)?.name || ""}`;
  render();
  socket.emit("join-channel", id);
  const messages = await api(`/api/channels/${id}/messages`);
  paintMessages(messages);
}

function paintMessages(messages) {
  const box = document.getElementById("messages");
  box.innerHTML = "";
  for (const m of messages) box.appendChild(msgNode(m));
  box.scrollTop = box.scrollHeight;
}

function msgNode(m) {
  const div = document.createElement("article");
  div.className = "message";
  div.id = `msg-${m.id}`;
  div.innerHTML = `<strong>${m.nickname || m.username}</strong> <small>${m.created_at}</small>
    <p>${m.content || ""} ${m.emojis || ""}</p>`;
  if (m.image_url) {
    const img = document.createElement("img");
    img.src = m.image_url;
    img.className = "message-image";
    div.appendChild(img);
  }
  const actions = document.createElement("div");
  const edit = document.createElement("button");
  edit.textContent = "Edytuj";
  edit.onclick = async () => {
    const content = prompt("Nowa treść", m.content || "");
    if (content === null) return;
    await api(`/api/messages/${m.id}`, "PUT", { content, emojis: m.emojis || "" });
  };
  const del = document.createElement("button");
  del.textContent = "Usuń";
  del.onclick = async () => {
    await api(`/api/messages/${m.id}`, "DELETE");
  };
  actions.append(edit, del);
  div.appendChild(actions);
  return div;
}

document.getElementById("loginBtn").onclick = async () => {
  try {
    const data = await api("/api/auth/login", "POST", {
      username: document.getElementById("username").value,
      password: document.getElementById("password").value
    });
    token = data.token;
    localStorage.setItem("token", token);
    await bootstrap();
  } catch (err) {
    authMsg.textContent = err.message;
  }
};

document.getElementById("registerBtn").onclick = async () => {
  try {
    await api("/api/auth/register", "POST", {
      username: document.getElementById("username").value,
      password: document.getElementById("password").value
    });
    authMsg.textContent = "Konto utworzone. Zaloguj się.";
  } catch (err) {
    authMsg.textContent = err.message;
  }
};

document.getElementById("msgForm").onsubmit = async (e) => {
  e.preventDefault();
  if (!state.currentChannelId) return;
  const form = new FormData();
  form.append("content", document.getElementById("msgInput").value);
  form.append("emojis", document.getElementById("emojiInput").value);
  const file = document.getElementById("imageInput").files[0];
  if (file) form.append("image", file);
  await api(`/api/channels/${state.currentChannelId}/messages`, "POST", form, true);
  document.getElementById("msgInput").value = "";
  document.getElementById("emojiInput").value = "";
  document.getElementById("imageInput").value = "";
};

document.getElementById("saveProfile").onclick = async () => {
  const form = new FormData();
  form.append("nickname", document.getElementById("nickname").value);
  form.append("audio_input", document.getElementById("audioInput").value);
  form.append("audio_output", document.getElementById("audioOutput").value);
  form.append("mic_sensitivity", document.getElementById("micSensitivity").value);
  form.append("automatic_voice_gain", document.getElementById("autoGain").checked ? "1" : "0");
  form.append("speaker_volume", document.getElementById("speakerVolume").value);
  form.append("mic_volume", document.getElementById("micVolume").value);
  const avatar = document.getElementById("avatar").files[0];
  if (avatar) form.append("avatar", avatar);
  await api("/api/me", "PUT", form, true);
  alert("Zapisano profil");
};

document.getElementById("toggleMic").onclick = async () => {
  if (!state.currentVoiceId) return alert("Wejdź na kanał głosowy.");
  state.muted_mic = !state.muted_mic;
  await api(`/api/channels/${state.currentVoiceId}/voice-toggle`, "POST", { muted_mic: state.muted_mic, muted_all: state.muted_all });
};

document.getElementById("toggleAll").onclick = async () => {
  if (!state.currentVoiceId) return alert("Wejdź na kanał głosowy.");
  state.muted_all = !state.muted_all;
  await api(`/api/channels/${state.currentVoiceId}/voice-toggle`, "POST", { muted_mic: state.muted_mic, muted_all: state.muted_all });
};

document.getElementById("voiceSettingsBtn").onclick = () => {
  const ch = state.channels.find((c) => c.id === state.currentVoiceId) || state.channels.find((c) => c.type === "voice");
  if (!ch) return;
  state.currentVoiceId = ch.id;
  voiceName.value = ch.name;
  voiceMax.value = ch.max_users;
  voiceBitrate.value = ch.bitrate_kbps;
  voicePassword.value = ch.password || "";
  voiceDialog.showModal();
};

document.getElementById("saveVoice").onclick = async () => {
  if (!state.currentVoiceId) return;
  const updated = await api(`/api/channels/${state.currentVoiceId}/voice-settings`, "PUT", {
    name: voiceName.value,
    max_users: Number(voiceMax.value),
    bitrate_kbps: Number(voiceBitrate.value),
    password: voicePassword.value
  });
  state.channels = state.channels.map((c) => (c.id === updated.id ? updated : c));
  voiceDialog.close();
  render();
};

socket.on("new-message", (m) => {
  if (m.channel_id !== state.currentChannelId) return;
  document.getElementById("messages").appendChild(msgNode(m));
});

socket.on("updated-message", (m) => {
  const p = document.querySelector(`#msg-${m.id} p`);
  if (p) p.textContent = `${m.content || ""} ${m.emojis || ""}`;
});

socket.on("deleted-message", ({ id }) => {
  document.getElementById(`msg-${id}`)?.remove();
});

socket.on("voice-channel-updated", (channel) => {
  state.channels = state.channels.map((c) => (c.id === channel.id ? channel : c));
  render();
});

bootstrap();
