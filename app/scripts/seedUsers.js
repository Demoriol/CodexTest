const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");
const bcrypt = require("bcryptjs");

const dbPath = process.env.DB_PATH || "/data/gaduly.db";
const templatePath = process.env.USERS_TEMPLATE || path.join(__dirname, "..", "users.template.json");

const db = new Database(dbPath);
const users = JSON.parse(fs.readFileSync(templatePath, "utf8"));

const server = db.prepare("SELECT id FROM servers LIMIT 1").get();
const role = db.prepare("SELECT id FROM roles WHERE server_id = ? ORDER BY id LIMIT 1").get(server.id);

for (const user of users) {
  const exists = db.prepare("SELECT id FROM users WHERE username = ?").get(user.username);
  if (exists) {
    console.log(`skip: ${user.username}`);
    continue;
  }
  const hash = bcrypt.hashSync(user.password, 10);
  const result = db.prepare("INSERT INTO users(username,password_hash,nickname) VALUES (?,?,?)")
    .run(user.username, hash, user.nickname || user.username);
  db.prepare("INSERT INTO server_members(server_id,user_id,role_id) VALUES (?,?,?)")
    .run(server.id, result.lastInsertRowid, role?.id || null);
  console.log(`created: ${user.username}`);
}
