// server.js
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const mongoose = require("mongoose");
const cors = require("cors");
const session = require("express-session");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});

mongoose.connect("mongodb://127.0.0.1:27017/chat-app", {
  useNewUrlParser: true,
  useUnifiedTopology: true
});

const Message = mongoose.model("Message", new mongoose.Schema({
  sender: String,
  receiver: String,
  content: String,
  timestamp: { type: Date, default: Date.now }
}));

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "client")));
app.use(session({
  secret: "secret-key",
  resave: false,
  saveUninitialized: true
}));

let onlineUsers = new Map();

io.on("connection", socket => {
  socket.on("login", username => {
    onlineUsers.set(username, socket.id);
    io.emit("userList", Array.from(onlineUsers.keys()));
  });

  socket.on("sendMessage", async ({ sender, receiver, content }) => {
    const message = new Message({ sender, receiver, content });
    await message.save();
    const receiverSocketId = onlineUsers.get(receiver);
    if (receiverSocketId) {
      io.to(receiverSocketId).emit("receiveMessage", message);
    }
  });

  socket.on("typing", ({ sender, receiver }) => {
    const receiverSocketId = onlineUsers.get(receiver);
    if (receiverSocketId) {
      io.to(receiverSocketId).emit("typing", sender);
    }
  });

  socket.on("disconnect", () => {
    for (let [username, id] of onlineUsers.entries()) {
      if (id === socket.id) {
        onlineUsers.delete(username);
        break;
      }
    }
    io.emit("userList", Array.from(onlineUsers.keys()));
  });
});

app.get("/history/:user1/:user2", async (req, res) => {
  const { user1, user2 } = req.params;
  const messages = await Message.find({
    $or: [
      { sender: user1, receiver: user2 },
      { sender: user2, receiver: user1 }
    ]
  }).sort("timestamp");
  res.json(messages);
});

server.listen(3000, () => {
  console.log("Server listening on port 3000");
});

// client/index.html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Real-Time Chat</title>
  <script src="https://cdn.socket.io/4.5.4/socket.io.min.js"></script>
  <script defer src="app.js"></script>
  <link href="https://cdn.jsdelivr.net/npm/tailwindcss@2.2.19/dist/tailwind.min.css" rel="stylesheet">
  <style>
    body {
      background-image: url('https://images.unsplash.com/photo-1525182008055-f88b95ff7980');
      background-size: cover;
      background-position: center;
    }
    .chat-box {
      background-color: rgba(255, 255, 255, 0.95);
      border-radius: 1rem;
      box-shadow: 0 10px 15px rgba(0, 0, 0, 0.1);
    }
  </style>
</head>
<body class="min-h-screen flex items-center justify-center">
  <div class="chat-box p-6 w-full max-w-2xl">
    <h1 class="text-3xl font-bold mb-4 text-center text-blue-700">🌐 Real-Time Chat App</h1>
    <div class="flex mb-4">
      <input id="username" placeholder="Enter username" class="p-2 flex-grow border rounded" />
      <button onclick="login()" class="bg-blue-600 text-white px-4 py-2 ml-2 rounded">Login</button>
    </div>
    <div class="grid grid-cols-3 gap-4">
      <div>
        <h2 class="font-semibold mb-2">👥 Online Users</h2>
        <ul id="users" class="space-y-2 text-blue-600 cursor-pointer"></ul>
      </div>
      <div class="col-span-2">
        <h2 class="font-semibold mb-2">💬 Chat Window</h2>
        <div id="chat" class="border rounded p-4 h-64 overflow-y-scroll bg-white"></div>
        <input id="message" placeholder="Type a message" class="p-2 border w-full mt-2 rounded" oninput="sendTyping()" />
        <button onclick="sendMessage()" class="bg-green-500 text-white px-4 py-2 mt-2 w-full rounded">Send</button>
      </div>
    </div>
  </div>
</body>
</html>

// client/app.js
const socket = io("http://localhost:3000");
let username = "";
let currentChatUser = "";

function login() {
  username = document.getElementById("username").value.trim();
  if (!username) return alert("Please enter a username.");
  socket.emit("login", username);
}

socket.on("userList", users => {
  const ul = document.getElementById("users");
  ul.innerHTML = "";
  users.filter(u => u !== username).forEach(user => {
    const li = document.createElement("li");
    li.textContent = user;
    li.className = "hover:underline";
    li.onclick = () => {
      currentChatUser = user;
      fetch(`/history/${username}/${user}`)
        .then(res => res.json())
        .then(data => {
          const chat = document.getElementById("chat");
          chat.innerHTML = "";
          data.forEach(msg => {
            const div = document.createElement("div");
            div.className = msg.sender === username ? "text-right text-green-600" : "text-left text-gray-800";
            div.textContent = `${msg.sender}: ${msg.content}`;
            chat.appendChild(div);
          });
        });
    };
    ul.appendChild(li);
  });
});

function sendMessage() {
  const msg = document.getElementById("message").value.trim();
  if (!msg || !currentChatUser) return;
  socket.emit("sendMessage", { sender: username, receiver: currentChatUser, content: msg });
  const chat = document.getElementById("chat");
  const div = document.createElement("div");
  div.className = "text-right text-green-600";
  div.textContent = `${username}: ${msg}`;
  chat.appendChild(div);
  document.getElementById("message").value = "";
}

function sendTyping() {
  if (currentChatUser) {
    socket.emit("typing", { sender: username, receiver: currentChatUser });
  }
}

socket.on("receiveMessage", msg => {
  if (msg.receiver === username && msg.sender === currentChatUser) {
    const chat = document.getElementById("chat");
    const div = document.createElement("div");
    div.className = "text-left text-gray-800";
    div.textContent = `${msg.sender}: ${msg.content}`;
    chat.appendChild(div);
  }
});

socket.on("typing", sender => {
  const chat = document.getElementById("chat");
  const typingDiv = document.createElement("div");
  typingDiv.textContent = `${sender} is typing...`;
  typingDiv.className = "italic text-sm text-gray-500";
  chat.appendChild(typingDiv);
  setTimeout(() = > {
    if (chat.contains(typingDiv)) chat.removeChild(typingDiv);
  }, 2000);
});
