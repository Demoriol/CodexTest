const express = require("express");
const cors = require("cors");
const http = require("http");
const path = require("path");
const fs = require("fs");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const multer = require("multer");
const Database = require("better-sqlite3");
const { Server } = require("socket.io");

const PORT = process.env.PORT || 8080;
const JWT_SECRET = process.env.JWT_SECRET || "change-me";
const DB_PATH = process.env.DB_PATH || "/data/gaduly.db";
const UPLOADS_DIR = process.env.UPLOADS_DIR || "/data/uploads";

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(cors());
app.use(express.json({ limit: "8mb" }));
app.use("/uploads", express.static(UPLOADS_DIR));
app.use(express.static(path.join(__dirname, "public")));

const avatarStorage = multer.diskStorage({
  destination: (_, __, cb) => cb(null, UPLOADS_DIR),
  filename: (_, file, cb) => cb(null, `${Date.now()}-${file.originalname.replace(/\s+/g, "_")}`)
});
const upload = multer({ storage: avatarStorage });

function initDb() {
  db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    nickname TEXT,
    avatar_url TEXT,
    audio_input TEXT DEFAULT 'default',
    audio_output TEXT DEFAULT 'default',
    mic_sensitivity INTEGER DEFAULT 50,
    automatic_voice_gain INTEGER DEFAULT 1,
    speaker_volume INTEGER DEFAULT 70,
    mic_volume INTEGER DEFAULT 70,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS servers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS server_members (
    server_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    role_id INTEGER,
    PRIMARY KEY (server_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS roles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    server_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    permissions TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS channels (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    server_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    type TEXT NOT NULL CHECK(type IN ('text','voice')),
    max_users INTEGER DEFAULT 10,
    bitrate_kbps INTEGER DEFAULT 64,
    password TEXT DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    channel_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    content TEXT,
    image_url TEXT,
    emojis TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT
  );

  CREATE TABLE IF NOT EXISTS voice_presence (
    channel_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    muted_mic INTEGER DEFAULT 0,
    muted_all INTEGER DEFAULT 0,
    PRIMARY KEY (channel_id, user_id)
  );
  `);

  const hasServer = db.prepare("SELECT id FROM servers LIMIT 1").get();
  if (!hasServer) {
    const s = db.prepare("INSERT INTO servers(name) VALUES (?)").run("Gaduly Hub");
    const serverId = s.lastInsertRowid;
    db.prepare("INSERT INTO roles(server_id,name,permissions) VALUES (?,?,?)").run(
      serverId,
      "Admin",
      JSON.stringify([
        "MANAGE_SERVER",
        "MANAGE_CHANNELS",
        "MANAGE_ROLES",
        "VIEW_CHANNEL",
        "SEND_MESSAGES",
        "MANAGE_MESSAGES",
        "CONNECT",
        "SPEAK",
        "MUTE_MEMBERS",
        "DEAFEN_MEMBERS"
      ])
    );
    db.prepare("INSERT INTO channels(server_id,name,type) VALUES (?,?,?)").run(serverId, "ogólny", "text");
    db.prepare("INSERT INTO channels(server_id,name,type,max_users,bitrate_kbps) VALUES (?,?,?,?,?)")
      .run(serverId, "General Voice", "voice", 10, 64);
  }
}

initDb();

function auth(req, res, next) {
  const token = req.headers.authorization?.replace("Bearer ", "");
  if (!token) return res.status(401).json({ error: "Brak tokenu" });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: "Nieprawidłowy token" });
  }
}

function userPublicData(userId) {
  return db
    .prepare("SELECT id, username, nickname, avatar_url FROM users WHERE id = ?")
    .get(userId);
}

app.post("/api/auth/register", (req, res) => {
  const { username, password } = req.body;
  if (!username || !password || password.length < 6) {
    return res.status(400).json({ error: "Użytkownik i hasło min. 6 znaków są wymagane." });
  }
  const hash = bcrypt.hashSync(password, 10);
  try {
    const result = db.prepare("INSERT INTO users(username,password_hash,nickname) VALUES (?,?,?)")
      .run(username, hash, username);
    const server = db.prepare("SELECT id FROM servers LIMIT 1").get();
    const adminRole = db.prepare("SELECT id FROM roles WHERE server_id = ? ORDER BY id LIMIT 1").get(server.id);
    db.prepare("INSERT INTO server_members(server_id,user_id,role_id) VALUES (?,?,?)")
      .run(server.id, result.lastInsertRowid, adminRole?.id || null);
    return res.json({ ok: true });
  } catch (err) {
    return res.status(409).json({ error: "Użytkownik już istnieje." });
  }
});

app.post("/api/auth/login", (req, res) => {
  const { username, password } = req.body;
  const user = db.prepare("SELECT * FROM users WHERE username = ?").get(username);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: "Błędny login lub hasło." });
  }
  const token = jwt.sign({ userId: user.id, username: user.username }, JWT_SECRET, { expiresIn: "7d" });
  return res.json({ token, user: userPublicData(user.id) });
});

app.get("/api/bootstrap", auth, (req, res) => {
  const servers = db.prepare("SELECT id,name FROM servers").all();
  const channels = db.prepare("SELECT * FROM channels").all();
  const me = db.prepare(`SELECT id, username, nickname, avatar_url, audio_input, audio_output,
    mic_sensitivity, automatic_voice_gain, speaker_volume, mic_volume FROM users WHERE id = ?`).get(req.user.userId);
  const roles = db.prepare("SELECT * FROM roles").all().map((r) => ({ ...r, permissions: JSON.parse(r.permissions) }));
  res.json({ servers, channels, me, roles });
});

app.get("/api/channels/:channelId/messages", auth, (req, res) => {
  const rows = db.prepare(`SELECT m.*, u.username, u.nickname, u.avatar_url
    FROM messages m JOIN users u ON m.user_id = u.id WHERE m.channel_id = ? ORDER BY m.id ASC`)
    .all(req.params.channelId);
  res.json(rows);
});

app.post("/api/channels/:channelId/messages", auth, upload.single("image"), (req, res) => {
  const { content = "", emojis = "" } = req.body;
  const channelId = Number(req.params.channelId);
  const imageUrl = req.file ? `/uploads/${req.file.filename}` : null;
  const ins = db.prepare("INSERT INTO messages(channel_id,user_id,content,image_url,emojis) VALUES (?,?,?,?,?)")
    .run(channelId, req.user.userId, content, imageUrl, emojis);
  const full = db.prepare(`SELECT m.*, u.username, u.nickname, u.avatar_url
    FROM messages m JOIN users u ON u.id = m.user_id WHERE m.id = ?`).get(ins.lastInsertRowid);
  io.to(`channel-${channelId}`).emit("new-message", full);
  res.json(full);
});

app.put("/api/messages/:messageId", auth, (req, res) => {
  const { content = "", emojis = "" } = req.body;
  const msg = db.prepare("SELECT * FROM messages WHERE id = ?").get(req.params.messageId);
  if (!msg || msg.user_id !== req.user.userId) return res.status(403).json({ error: "Brak uprawnień" });
  db.prepare("UPDATE messages SET content = ?, emojis = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
    .run(content, emojis, req.params.messageId);
  const updated = db.prepare("SELECT * FROM messages WHERE id = ?").get(req.params.messageId);
  io.to(`channel-${msg.channel_id}`).emit("updated-message", updated);
  res.json(updated);
});

app.delete("/api/messages/:messageId", auth, (req, res) => {
  const msg = db.prepare("SELECT * FROM messages WHERE id = ?").get(req.params.messageId);
  if (!msg || msg.user_id !== req.user.userId) return res.status(403).json({ error: "Brak uprawnień" });
  db.prepare("DELETE FROM messages WHERE id = ?").run(req.params.messageId);
  io.to(`channel-${msg.channel_id}`).emit("deleted-message", { id: Number(req.params.messageId) });
  res.json({ ok: true });
});

app.put("/api/channels/:channelId/voice-settings", auth, (req, res) => {
  const { name, max_users, bitrate_kbps, password } = req.body;
  db.prepare("UPDATE channels SET name=?, max_users=?, bitrate_kbps=?, password=? WHERE id = ? AND type='voice'")
    .run(name, max_users, bitrate_kbps, password || "", req.params.channelId);
  const updated = db.prepare("SELECT * FROM channels WHERE id = ?").get(req.params.channelId);
  io.emit("voice-channel-updated", updated);
  res.json(updated);
});

app.post("/api/channels/:channelId/voice-toggle", auth, (req, res) => {
  const { muted_mic = 0, muted_all = 0 } = req.body;
  db.prepare(`INSERT INTO voice_presence(channel_id,user_id,muted_mic,muted_all)
    VALUES(?,?,?,?) ON CONFLICT(channel_id,user_id)
    DO UPDATE SET muted_mic=excluded.muted_mic, muted_all=excluded.muted_all`)
    .run(req.params.channelId, req.user.userId, muted_mic ? 1 : 0, muted_all ? 1 : 0);
  io.to(`channel-${req.params.channelId}`).emit("voice-state", {
    userId: req.user.userId,
    channelId: Number(req.params.channelId),
    muted_mic: !!muted_mic,
    muted_all: !!muted_all
  });
  res.json({ ok: true });
});

app.put("/api/me", auth, upload.single("avatar"), (req, res) => {
  const {
    nickname,
    audio_input,
    audio_output,
    mic_sensitivity,
    automatic_voice_gain,
    speaker_volume,
    mic_volume
  } = req.body;
  let avatar_url;
  if (req.file) avatar_url = `/uploads/${req.file.filename}`;

  db.prepare(`UPDATE users SET
    nickname = COALESCE(?, nickname),
    avatar_url = COALESCE(?, avatar_url),
    audio_input = COALESCE(?, audio_input),
    audio_output = COALESCE(?, audio_output),
    mic_sensitivity = COALESCE(?, mic_sensitivity),
    automatic_voice_gain = COALESCE(?, automatic_voice_gain),
    speaker_volume = COALESCE(?, speaker_volume),
    mic_volume = COALESCE(?, mic_volume)
    WHERE id = ?`)
    .run(
      nickname,
      avatar_url,
      audio_input,
      audio_output,
      mic_sensitivity,
      automatic_voice_gain,
      speaker_volume,
      mic_volume,
      req.user.userId
    );

  res.json(userPublicData(req.user.userId));
});

app.post("/api/roles", auth, (req, res) => {
  const { server_id, name, permissions } = req.body;
  const ins = db.prepare("INSERT INTO roles(server_id,name,permissions) VALUES (?,?,?)")
    .run(server_id, name, JSON.stringify(permissions || []));
  res.json({ id: ins.lastInsertRowid, server_id, name, permissions: permissions || [] });
});

io.on("connection", (socket) => {
  socket.on("join-channel", (channelId) => {
    socket.join(`channel-${channelId}`);
  });
});

app.get("/health", (_, res) => res.send("ok"));
app.get("*", (_, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

server.listen(PORT, () => {
  console.log(`Gaduly running at http://0.0.0.0:${PORT}`);
});
