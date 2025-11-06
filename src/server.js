import express from "express";
import http from "http";
import { Server } from "socket.io";
import cors from "cors";
import { fileURLToPath } from "url";
import path from "path";
import fs from "fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);

app.use(cors());
app.use(express.json());

const publicPath = path.join(__dirname, "..", "public");
app.use(express.static(publicPath));

// Simple JSON "DB"
const dataFilePath = path.join(__dirname, "..", "data.json");

/** @type {{id:string,name:string}[]} */
let groups = [];
/** @type {{id:number,type:"group",groupId:string,author:string,text:string,createdAt:string}[]} */
let groupMessages = [];
/** @type {{id:number,type:"pm",from:string,to:string,text:string,createdAt:string}[]} */
let pmMessages = [];

function ensureNewsGroup() {
  if (!groups) groups = [];
  const hasNews = groups.some((g) => g.id === "news");
  if (!hasNews) {
    groups.unshift({ id: "news", name: "новости" });
  }
}

function loadData() {
  try {
    if (fs.existsSync(dataFilePath)) {
      const raw = fs.readFileSync(dataFilePath, "utf-8");
      const parsed = JSON.parse(raw);
      groups = parsed.groups || [];
      groupMessages = parsed.groupMessages || [];
      pmMessages = parsed.pmMessages || [];
      console.log(
        "Data loaded:",
        groups.length, "groups,",
        groupMessages.length, "group msgs,",
        pmMessages.length, "pm msgs"
      );
    }
  } catch (e) {
    console.error("Failed to load data.json:", e.message);
  }
  ensureNewsGroup();
}

function saveData() {
  const payload = { groups, groupMessages, pmMessages };
  fs.writeFile(dataFilePath, JSON.stringify(payload, null, 2), (err) => {
    if (err) {
      console.error("Failed to save data.json:", err.message);
    }
  });
}

loadData();

// Online users: nick -> Set(socketId)
const onlineUsers = new Map();

function broadcastUsers() {
  const list = [];
  for (const [nick, sockets] of onlineUsers.entries()) {
    if (sockets.size > 0) list.push(nick);
  }
  list.sort((a, b) => a.localeCompare(b, "ru"));
  io.emit("users:update", list);
}

function broadcastGroups() {
  io.emit("groups:update", groups);
}

function addOnlineUser(nick, socketId) {
  if (!nick) return;
  let set = onlineUsers.get(nick);
  if (!set) {
    set = new Set();
    onlineUsers.set(nick, set);
  }
  set.add(socketId);
  broadcastUsers();
}

function removeOnlineUser(nick, socketId) {
  if (!nick) return;
  const set = onlineUsers.get(nick);
  if (!set) return;
  set.delete(socketId);
  if (set.size === 0) {
    onlineUsers.delete(nick);
  }
  broadcastUsers();
}

// REST API

// groups
app.get("/groups", (req, res) => {
  ensureNewsGroup();
  res.json(groups);
});

// create group (not "news")
app.post("/groups", (req, res) => {
  let name = (req.body?.name || "").toString().trim();
  if (!name || name.length < 2 || name.length > 32) {
    return res
      .status(400)
      .json({ error: "Название группы должно быть от 2 до 32 символов" });
  }

  const slug =
    name
      .toLowerCase()
      .replace(/[^a-z0-9а-яё_-]/gi, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "") || "group";

  const id = slug + "-" + Date.now().toString(36);

  const group = { id, name };
  groups.push(group);
  saveData();
  broadcastGroups();

  res.json(group);
});

// group messages
app.get("/messages", (req, res) => {
  const { groupId } = req.query;
  const filtered = groupMessages.filter((m) =>
    groupId ? m.groupId === groupId : true
  );
  res.json(filtered);
});

// private messages
app.get("/private", (req, res) => {
  const me = (req.query.me || "").toString();
  const withNick = (req.query.withNick || "").toString();
  if (!me || !withNick) {
    return res.json([]);
  }
  const filtered = pmMessages.filter(
    (m) =>
      (m.from === me && m.to === withNick) ||
      (m.from === withNick && m.to === me)
  );
  res.json(filtered);
});

// Simple admin endpoint to post news
// Use: POST /admin/news?token=YOUR_TOKEN { text: "..." }
const ADMIN_NEWS_TOKEN = process.env.ADMIN_NEWS_TOKEN || "changeme";
app.post("/admin/news", (req, res) => {
  const token = (req.query.token || "").toString();
  if (!token || token !== ADMIN_NEWS_TOKEN) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  const text = (req.body?.text || "").toString().trim();
  if (!text) {
    return res.status(400).json({ error: "Текст пустой" });
  }
  ensureNewsGroup();
  const message = {
    id: Date.now() + Math.floor(Math.random() * 1000),
    type: "group",
    groupId: "news",
    author: "Новости",
    text: text.slice(0, 4000),
    createdAt: new Date().toISOString(),
  };
  groupMessages.push(message);
  if (groupMessages.length > 3000) {
    groupMessages = groupMessages.slice(-2000);
  }
  saveData();
  io.emit("chat:newGroup", message);
  res.json({ ok: true, message });
});

// Socket.io
const io = new Server(server, {
  cors: {
    origin: "*",
  },
});

io.on("connection", (socket) => {
  console.log("user connected", socket.id);

  socket.on("user:hello", (nick) => {
    const cleanNick = (nick || "").toString().trim().slice(0, 32) || "Anon";
    const oldNick = socket.data.nick;
    socket.data.nick = cleanNick;
    if (oldNick && oldNick !== cleanNick) {
      removeOnlineUser(oldNick, socket.id);
    }
    addOnlineUser(cleanNick, socket.id);
  });

  // send group message
  socket.on("chat:sendGroup", (msg) => {
    const groupId = (msg.groupId || "").toString();
    const group = groups.find((g) => g.id === groupId);
    if (!group) return;

    // "news" is read-only
    if (group.id === "news") {
      return;
    }

    const text = (msg.text || "").toString().slice(0, 2000);
    if (!text) return;

    const author =
      (msg.author || socket.data.nick || "Anon").toString().slice(0, 32);

    const message = {
      id: Date.now() + Math.floor(Math.random() * 1000),
      type: "group",
      groupId: group.id,
      author,
      text,
      createdAt: new Date().toISOString(),
    };
    groupMessages.push(message);
    if (groupMessages.length > 3000) {
      groupMessages = groupMessages.slice(-2000);
    }
    saveData();
    io.emit("chat:newGroup", message);
  });

  // private message
  socket.on("chat:sendPm", (msg) => {
    const from = (msg.from || socket.data.nick || "Anon")
      .toString()
      .slice(0, 32);
    const to = (msg.to || "").toString().slice(0, 32);
    const text = (msg.text || "").toString().slice(0, 2000);
    if (!to || !text) return;

    const message = {
      id: Date.now() + Math.floor(Math.random() * 1000),
      type: "pm",
      from,
      to,
      text,
      createdAt: new Date().toISOString(),
    };
    pmMessages.push(message);
    if (pmMessages.length > 5000) {
      pmMessages = pmMessages.slice(-3500);
    }
    saveData();

    socket.emit("chat:newPm", message);

    const toSockets = onlineUsers.get(to);
    if (toSockets) {
      for (const sid of toSockets) {
        if (sid === socket.id) continue;
        io.to(sid).emit("chat:newPm", message);
      }
    }
  });

  // typing indicator
  socket.on("typing", (payload) => {
    const nick = socket.data.nick || "Anon";
    const clean = {
      chatType: payload.chatType === "pm" ? "pm" : "group",
      groupId: payload.groupId || null,
      withNick: payload.withNick || null,
      isTyping: !!payload.isTyping,
      nick,
    };
    io.emit("typing:update", clean);
  });

  // ----- ЛИЧНЫЕ ЗВОНКИ: оповещение о входящем вызове -----

  // когда кто-то НАЧИНАЕТ звонок в ЛС
  socket.on("call:pm:start", ({ to, callId }) => {
    const from = socket.data.nick;
    if (!from || !to || !callId) return;

    const toSockets = onlineUsers.get(to);
    if (!toSockets) return;

    for (const sid of toSockets) {
      io.to(sid).emit("call:pm:incoming", {
        callId,
        from,
      });
    }
  });

  // когда второй ОТКЛОНЯЕТ звонок
  socket.on("call:pm:reject", ({ to, callId }) => {
    const from = socket.data.nick;
    if (!from || !to || !callId) return;

    const toSockets = onlineUsers.get(to);
    if (!toSockets) return;

    for (const sid of toSockets) {
      io.to(sid).emit("call:pm:rejected", {
        callId,
        from,
      });
    }
  });

  // WebRTC signalling
  socket.on("webrtc:join", ({ callId }) => {
    if (!callId) return;
    socket.join(callId);
    if (!socket.data.calls) socket.data.calls = new Set();
    socket.data.calls.add(callId);

    const room = io.sockets.adapter.rooms.get(callId) || new Set();
    const peers = [...room].filter((id) => id !== socket.id);
    socket.emit("webrtc:joined", { callId, peers });

    socket.to(callId).emit("webrtc:peer-joined", {
      callId,
      socketId: socket.id,
    });
    console.log("socket", socket.id, "joined call", callId);
  });

  socket.on("webrtc:leave", ({ callId }) => {
    if (!callId) return;
    socket.leave(callId);
    if (socket.data.calls) {
      socket.data.calls.delete(callId);
    }
    socket.to(callId).emit("webrtc:peer-left", {
      callId,
      socketId: socket.id,
    });
    console.log("socket", socket.id, "left call", callId);
  });

  socket.on("webrtc:signal", ({ callId, to, data }) => {
    if (!callId || !to || !data) return;
    io.to(to).emit("webrtc:signal", {
      callId,
      from: socket.id,
      data,
    });
  });

  socket.on("disconnect", () => {
    const nick = socket.data.nick;
    removeOnlineUser(nick, socket.id);

    const calls = socket.data.calls;
    if (calls) {
      for (const callId of calls) {
        socket.to(callId).emit("webrtc:peer-left", {
          callId,
          socketId: socket.id,
        });
      }
    }

    console.log("user disconnected", socket.id);
  });
});

const PORT = process.env.PORT || 4000;

server.listen(PORT, () => {
  console.log(`FriendHub server listening on port ${PORT}`);
});
