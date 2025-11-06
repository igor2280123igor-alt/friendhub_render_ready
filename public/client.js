const API_URL = window.location.origin;
const socket = io(API_URL);

const nickInput = document.getElementById("nickname");
const nickStatus = document.getElementById("nick-status");
const nickPill = document.getElementById("nick-pill");

const createGroupBtn = document.getElementById("create-group-btn");
const groupsList = document.getElementById("groups-list");
const groupsCount = document.getElementById("groups-count");
const usersList = document.getElementById("users-list");
const usersCount = document.getElementById("users-count");

const messagesDiv = document.getElementById("messages");
const messagesEmpty = document.getElementById("messages-empty");
const typingIndicator = document.getElementById("typing-indicator");
const chatInputWrap = document.getElementById("chat-input-wrap");
const form = document.getElementById("form");
const textInput = document.getElementById("text");

const chatTitle = document.getElementById("chat-title");
const chatSubtitle = document.getElementById("chat-subtitle");

const callButton = document.getElementById("call-button");
const hangupButton = document.getElementById("hangup-button");
const callStatus = document.getElementById("call-status");
const callStatusText = document.getElementById("call-status-text");

const NICK_KEY = "friendhub_nickname";

let currentNick = "";
let groups = [];
let activeChat = { type: "group", id: null, label: "" }; // group | pm
let currentUsers = [];
let unreadChats = new Set();

let typingSendTimeout = null;
let typingViewTimeout = null;

// WebRTC
let inCall = false;
let callId = null;
let localStream = null;
let peers = {};
let remoteAudios = {};

function chatKey(type, id) {
  return type + ":" + id;
}

function getCallIdForActiveChat() {
  if (!activeChat.id) return null;
  if (activeChat.type === "group") {
    return "group:" + activeChat.id;
  } else if (activeChat.type === "pm") {
    if (!currentNick || !activeChat.id) return null;
    const arr = [currentNick, activeChat.id].sort();
    return "pm:" + arr.join(":");
  }
  return null;
}

function setNickStatus(text) {
  nickStatus.textContent = text || "";
}

function updateNickPill() {
  if (currentNick) {
    nickPill.textContent = currentNick;
    nickPill.style.color = "#e5e7eb";
  } else {
    nickPill.textContent = "не установлен";
    nickPill.style.color = "#9ca3af";
  }
}

function loadNickname() {
  const saved = localStorage.getItem(NICK_KEY);
  if (saved) {
    currentNick = saved;
    nickInput.value = saved;
    setNickStatus("ник сохранён");
  } else {
    setNickStatus("укажи ник, он сохранится на этом устройстве");
  }
  updateNickPill();
  if (currentNick) {
    socket.emit("user:hello", currentNick);
  }
}

function saveNickname() {
  const nick = nickInput.value.trim();
  if (nick) {
    currentNick = nick;
    localStorage.setItem(NICK_KEY, nick);
    setNickStatus("ник сохранён");
    socket.emit("user:hello", nick);
  } else {
    currentNick = "";
    localStorage.removeItem(NICK_KEY);
    setNickStatus("ник пустой");
  }
  updateNickPill();
  if (activeChat.type === "pm" && activeChat.id === currentNick) {
    setActiveGroup(groups[0]?.id, groups[0]?.name);
  }
}

nickInput.addEventListener("change", saveNickname);
nickInput.addEventListener("blur", saveNickname);

function formatTime(iso) {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString();
  } catch {
    return "";
  }
}

function clearMessages() {
  messagesDiv.innerHTML = "";
  messagesDiv.appendChild(messagesEmpty);
  messagesEmpty.style.display = "block";
  typingIndicator.textContent = "";
}

function addMessageToUI(msg, isMine) {
  if (messagesEmpty) {
    messagesEmpty.style.display = "none";
  }

  const row = document.createElement("div");
  row.className = "msg-row";

  const bubble = document.createElement("div");
  bubble.className = "msg-bubble " + (isMine ? "me" : "other");

  const authorEl = document.createElement("div");
  authorEl.className = "msg-author";

  if (msg.type === "pm") {
    const who = msg.from === currentNick ? msg.to : msg.from;
    authorEl.textContent = isMine ? "Вы → " + who : msg.from + " → Вам";
  } else {
    authorEl.textContent = msg.author || "Anon";
  }

  const textEl = document.createElement("div");
  textEl.className = "msg-text";
  textEl.textContent = msg.text;

  const metaEl = document.createElement("div");
  metaEl.className = "msg-meta";
  metaEl.textContent = formatTime(msg.createdAt);

  bubble.appendChild(authorEl);
  bubble.appendChild(textEl);
  bubble.appendChild(metaEl);

  row.appendChild(bubble);
  messagesDiv.appendChild(row);

  messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

async function fetchGroups() {
  const res = await fetch(API_URL + "/groups");
  groups = await res.json();
  renderGroups();
  if (!activeChat.id && groups.length > 0) {
    const newsGroup = groups.find((g) => g.id === "news");
    if (newsGroup) {
      setActiveGroup(newsGroup.id, newsGroup.name);
    } else {
      setActiveGroup(groups[0].id, groups[0].name);
    }
  }
}

function renderGroups() {
  groupsList.innerHTML = "";
  groupsCount.textContent = groups.length;
  groups.forEach((group) => {
    const li = document.createElement("li");
    li.className = "list-item";
    li.dataset.groupId = group.id;
    const key = chatKey("group", group.id);
    if (unreadChats.has(key)) {
      li.classList.add("has-unread");
    }

    if (activeChat.type === "group" && activeChat.id === group.id) {
      li.classList.add("active");
    }

    const badge = document.createElement("div");
    badge.className = "list-badge badge-group";
    badge.textContent = group.id === "news" ? "N" : "#";

    const label = document.createElement("div");
    label.className = "list-label";
    label.textContent = group.name;

    li.appendChild(badge);
    li.appendChild(label);

    li.addEventListener("click", () => {
      setActiveGroup(group.id, group.name);
    });

    groupsList.appendChild(li);
  });
}

function renderUsers(users) {
  currentUsers = users.slice();
  usersList.innerHTML = "";
  usersCount.textContent = users.length;
  users.forEach((nick) => {
    const li = document.createElement("li");
    li.className = "list-item";
    li.dataset.userNick = nick;
    const key = chatKey("pm", nick);
    if (unreadChats.has(key)) {
      li.classList.add("has-unread");
    }
    if (activeChat.type === "pm" && activeChat.id === nick) {
      li.classList.add("active");
    }

    const badge = document.createElement("div");
    badge.className = "list-badge badge-user";

    const dot = document.createElement("div");
    dot.className = "user-dot";
    badge.appendChild(dot);

    const label = document.createElement("div");
    label.className = "list-label";
    label.textContent = nick;

    li.appendChild(badge);
    li.appendChild(label);

    li.addEventListener("click", () => {
      if (!currentNick) {
        alert("Сначала установите свой ник слева сверху");
        nickInput.focus();
        return;
      }
      if (nick === currentNick) {
        alert("Личные сообщения самому себе не имеют смысла :)");
        return;
      }
      setActivePm(nick);
    });

    usersList.appendChild(li);
  });
}

async function loadGroupMessages(groupId) {
  clearMessages();
  const url = new URL(API_URL + "/messages");
  if (groupId) url.searchParams.set("groupId", groupId);
  const res = await fetch(url.toString());
  const data = await res.json();
  if (!Array.isArray(data) || data.length === 0) return;
  data.forEach((m) => {
    m.type = "group";
    const isMine = currentNick && m.author === currentNick;
    addMessageToUI(m, isMine);
  });
}

async function loadPrivateMessages(withNick) {
  clearMessages();
  if (!currentNick) return;
  const url = new URL(API_URL + "/private");
  url.searchParams.set("me", currentNick);
  url.searchParams.set("withNick", withNick);
  const res = await fetch(url.toString());
  const data = await res.json();
  if (!Array.isArray(data) || data.length === 0) return;
  data.forEach((m) => {
    m.type = "pm";
    const isMine = currentNick && m.from === currentNick;
    addMessageToUI(m, isMine);
  });
}

function clearUnreadForActive() {
  if (activeChat.id) {
    const key = chatKey(activeChat.type, activeChat.id);
    unreadChats.delete(key);
    renderGroups();
    renderUsers(currentUsers);
  }
}

function updateInputVisibility() {
  const isNews = activeChat.type === "group" && activeChat.id === "news";
  if (isNews) {
    chatInputWrap.style.display = "none";
    typingIndicator.textContent = "";
    chatSubtitle.textContent = "Канал только для чтения. Новости публикует администратор.";
  } else if (activeChat.type === "group") {
    chatInputWrap.style.display = "";
    chatSubtitle.textContent = "Групповой чат";
  } else if (activeChat.type === "pm") {
    chatInputWrap.style.display = "";
    chatSubtitle.textContent = "Переписка только между вами и " + activeChat.id;
  }
}

function maybeEndCallOnChatSwitch(newChatType, newChatId) {
  if (!inCall || !callId) return;
  let newCallId = null;
  if (newChatType === "group") {
    newCallId = "group:" + newChatId;
  } else if (newChatType === "pm") {
    if (!currentNick || !newChatId) return;
    const arr = [currentNick, newChatId].sort();
    newCallId = "pm:" + arr.join(":");
  }
  if (newCallId !== callId) {
    endCall();
  }
}

function setActiveGroup(groupId, groupName) {
  maybeEndCallOnChatSwitch("group", groupId);
  activeChat = { type: "group", id: groupId, label: groupName };
  chatTitle.textContent = groupId === "news" ? "Новости" : "#" + (groupName || "группа");
  clearUnreadForActive();
  updateInputVisibility();
  updateCallUI();
  loadGroupMessages(groupId).catch(console.error);
}

function setActivePm(withNick) {
  maybeEndCallOnChatSwitch("pm", withNick);
  activeChat = { type: "pm", id: withNick, label: withNick };
  chatTitle.textContent = "Личные сообщения с " + withNick;
  clearUnreadForActive();
  updateInputVisibility();
  updateCallUI();
  loadPrivateMessages(withNick).catch(console.error);
}

form.addEventListener("submit", (e) => {
  e.preventDefault();
  const text = textInput.value.trim();
  if (!text) return;

  if (!currentNick) {
    alert("Сначала укажите ник слева сверху");
    nickInput.focus();
    return;
  }

  if (!activeChat.id) {
    alert("Сначала выберите группу или пользователя");
    return;
  }

  if (activeChat.type === "group" && activeChat.id === "news") {
    alert("В канал 'Новости' писать нельзя. Его заполняет только админ.");
    return;
  }

  if (activeChat.type === "group") {
    socket.emit("chat:sendGroup", {
      groupId: activeChat.id,
      author: currentNick,
      text,
    });
  } else if (activeChat.type === "pm") {
    socket.emit("chat:sendPm", {
      from: currentNick,
      to: activeChat.id,
      text,
    });
  }

  textInput.value = "";
});

async function handleCreateGroup() {
  if (!currentNick) {
    alert("Сначала укажите свой ник");
    nickInput.focus();
    return;
  }
  let name = prompt("Введите название группы (2–32 символа):");
  if (!name) return;
  name = name.trim();
  if (name.length < 2 || name.length > 32) {
    alert("Название группы должно быть от 2 до 32 символов");
    return;
  }
  try {
    const res = await fetch(API_URL + "/groups", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      alert(err.error || "Ошибка при создании группы");
      return;
    }
    const group = await res.json();
    await fetchGroups();
    setActiveGroup(group.id, group.name);
  } catch (e) {
    console.error(e);
    alert("Не удалось создать группу");
  }
}

createGroupBtn.addEventListener("click", handleCreateGroup);

function notifyTyping() {
  if (!currentNick || !activeChat.id) return;
  if (activeChat.type === "group" && activeChat.id === "news") return;
  socket.emit("typing", {
    chatType: activeChat.type,
    groupId: activeChat.type === "group" ? activeChat.id : null,
    withNick: activeChat.type === "pm" ? activeChat.id : null,
    isTyping: true,
  });
  if (typingSendTimeout) clearTimeout(typingSendTimeout);
  typingSendTimeout = setTimeout(() => {
    socket.emit("typing", {
      chatType: activeChat.type,
      groupId: activeChat.type === "group" ? activeChat.id : null,
      withNick: activeChat.type === "pm" ? activeChat.id : null,
      isTyping: false,
    });
    typingSendTimeout = null;
  }, 2000);
}

textInput.addEventListener("input", notifyTyping);

// WebRTC

function updateCallUI() {
  if (inCall && callId) {
    callButton.style.display = "none";
    hangupButton.style.display = "";
    callStatus.style.display = "block";
    if (activeChat.type === "group") {
      callStatusText.textContent = "Групповой звонок в группе " + (activeChat.label || "");
    } else if (activeChat.type === "pm") {
      callStatusText.textContent = "Звонок с " + (activeChat.id || "");
    } else {
      callStatusText.textContent = "Идёт звонок";
    }
  } else {
    callButton.style.display = "";
    hangupButton.style.display = "none";
    callStatus.style.display = "none";
    callStatusText.textContent = "";
  }
}

async function startCall() {
  if (inCall) return;
  if (!currentNick) {
    alert("Сначала укажите ник");
    nickInput.focus();
    return;
  }
  if (!activeChat.id) {
    alert("Сначала выберите группу или пользователя");
    return;
  }
  const id = getCallIdForActiveChat();
  if (!id) {
    alert("Нельзя начать звонок для этого чата");
    return;
  }
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (e) {
    console.error(e);
    alert("Не удалось получить доступ к микрофону. Проверь разрешения и HTTPS.");
    return;
  }
  inCall = true;
  callId = id;
  updateCallUI();
  socket.emit("webrtc:join", { callId: id });
}

function cleanupPeer(peerId) {
  const pc = peers[peerId];
  if (pc) {
    try { pc.close(); } catch (e) {}
    delete peers[peerId];
  }
  const audio = remoteAudios[peerId];
  if (audio) {
    try { audio.remove(); } catch (e) {}
    delete remoteAudios[peerId];
  }
}

function endCall() {
  if (!inCall) return;
  if (callId) {
    socket.emit("webrtc:leave", { callId });
  }
  Object.keys(peers).forEach(cleanupPeer);
  peers = {};
  Object.keys(remoteAudios).forEach(cleanupPeer);
  remoteAudios = {};
  if (localStream) {
    localStream.getTracks().forEach((t) => t.stop());
    localStream = null;
  }
  inCall = false;
  callId = null;
  updateCallUI();
}

callButton.addEventListener("click", startCall);
hangupButton.addEventListener("click", endCall);

function getPeerConnection(peerId, isInitiator) {
  let pc = peers[peerId];
  if (pc) return pc;

  pc = new RTCPeerConnection({
    iceServers: [
      { urls: "stun:stun.l.google.com:19302" },
    ],
  });

  peers[peerId] = pc;

  if (localStream) {
    localStream.getTracks().forEach((track) => {
      pc.addTrack(track, localStream);
    });
  }

  pc.onicecandidate = (event) => {
    if (event.candidate && inCall && callId) {
      socket.emit("webrtc:signal", {
        callId,
        to: peerId,
        data: { type: "candidate", candidate: event.candidate },
      });
    }
  };

  pc.ontrack = (event) => {
    let audio = remoteAudios[peerId];
    if (!audio) {
      audio = document.createElement("audio");
      audio.autoplay = true;
      audio.playsInline = true;
      remoteAudios[peerId] = audio;
      document.body.appendChild(audio);
    }
    audio.srcObject = event.streams[0];
  };

  pc.onconnectionstatechange = () => {
    if (
      pc.connectionState === "failed" ||
      pc.connectionState === "disconnected" ||
      pc.connectionState === "closed"
    ) {
      cleanupPeer(peerId);
    }
  };

  if (isInitiator) {
    pc.onnegotiationneeded = async () => {
      try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        if (inCall && callId) {
          socket.emit("webrtc:signal", {
            callId,
            to: peerId,
            data: { type: "offer", sdp: pc.localDescription },
          });
        }
      } catch (e) {
        console.error(e);
      }
    };
  }

  return pc;
}

socket.on("webrtc:joined", ({ callId: joinedId, peers: peerIds }) => {
  if (!inCall || joinedId !== callId) return;
  (peerIds || []).forEach((peerId) => {
    getPeerConnection(peerId, true);
  });
});

socket.on("webrtc:peer-left", ({ callId: leftCallId, socketId }) => {
  if (!inCall || leftCallId !== callId) return;
  cleanupPeer(socketId);
});

socket.on("webrtc:signal", async ({ callId: sigCallId, from, data }) => {
  if (!inCall || sigCallId !== callId) return;
  try {
    const pc = getPeerConnection(from, false);
    if (data.type === "offer") {
      await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socket.emit("webrtc:signal", {
        callId,
        to: from,
        data: { type: "answer", sdp: pc.localDescription },
      });
    } else if (data.type === "answer") {
      await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
    } else if (data.type === "candidate") {
      if (data.candidate) {
        await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
      }
    }
  } catch (e) {
    console.error("Error handling webrtc signal", e);
  }
});

// basic socket handlers

socket.on("connect", () => {
  if (currentNick) {
    socket.emit("user:hello", currentNick);
  }
});

socket.on("users:update", (users) => {
  renderUsers(users);
});

socket.on("groups:update", (serverGroups) => {
  groups = serverGroups;
  renderGroups();
});

socket.on("chat:newGroup", (msg) => {
  msg.type = "group";
  const isActive =
    activeChat.type === "group" && activeChat.id === msg.groupId;
  const isMine = currentNick && msg.author === currentNick;

  if (isActive) {
    addMessageToUI(msg, isMine);
  } else if (!isMine) {
    const key = chatKey("group", msg.groupId);
    unreadChats.add(key);
    renderGroups();
    renderUsers(currentUsers);
  }
});

socket.on("chat:newPm", (msg) => {
  msg.type = "pm";
  if (!currentNick) return;
  const isMine = msg.from === currentNick;
  const other = isMine ? msg.to : msg.from;

  const isActive = activeChat.type === "pm" && activeChat.id === other;

  if (isActive) {
    addMessageToUI(msg, isMine);
  } else if (!isMine) {
    const key = chatKey("pm", other);
    unreadChats.add(key);
    renderGroups();
    renderUsers(currentUsers);
  }
});

socket.on("typing:update", (payload) => {
  if (!payload || !payload.isTyping) {
    if (typingIndicator.textContent && (!payload || payload.isTyping === false)) {
      typingIndicator.textContent = "";
    }
    return;
  }
  if (!currentNick) return;

  if (payload.nick === currentNick) return;

  let relevant = false;
  if (
    payload.chatType === "group" &&
    activeChat.type === "group" &&
    activeChat.id === payload.groupId &&
    activeChat.id !== "news"
  ) {
    relevant = true;
  }
  if (payload.chatType === "pm" && activeChat.type === "pm") {
    const other = activeChat.id;
    if (
      (payload.nick === other && payload.withNick === currentNick) ||
      (payload.nick === other && payload.withNick === other)
    ) {
      relevant = true;
    }
  }

  if (!relevant) return;

  typingIndicator.textContent = payload.nick + " печатает...";
  if (typingViewTimeout) clearTimeout(typingViewTimeout);
  typingViewTimeout = setTimeout(() => {
    typingIndicator.textContent = "";
    typingViewTimeout = null;
  }, 2500);
});

loadNickname();
fetchGroups().catch(console.error);
updateCallUI();
