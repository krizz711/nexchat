const redis = require('../redis/redisClient');

// Simple profanity filter - add words as needed
const BAD_WORDS = ['spam', 'scam']; // extend as needed
const filterMessage = (text) => {
  let filtered = text;
  BAD_WORDS.forEach(word => {
    const re = new RegExp(word, 'gi');
    filtered = filtered.replace(re, '*'.repeat(word.length));
  });
  return filtered;
};

const sanitize = (str) => {
  if (typeof str !== 'string') return '';
  return str.replace(/<[^>]*>/g, '').trim().slice(0, 2000);
};

module.exports = (io) => {
  // Track typing timeouts
  const typingTimeouts = new Map();

  io.on('connection', async (socket) => {
    const user = socket.user;
    console.log(`✅ Connected: ${user.username} (${socket.id})`);

    // Set user online in Redis
    await redis.hset('online_users', user.id, JSON.stringify({
      id: user.id,
      username: user.username,
      avatar_url: user.avatar_url,
      socketId: socket.id,
    }));

    io.emit('user:online', { userId: user.id, username: user.username });

    // ─── JOIN ROOM ──────────────────────────────────────────────
    socket.on('room:join', async ({ roomId }) => {
      if (!roomId) return;
      socket.join(roomId);

      // Count members in room
      const roomSockets = await io.in(roomId).allSockets();
      io.to(roomId).emit('room:count', { roomId, count: roomSockets.size });

      socket.emit('room:joined', { roomId });
    });

    // ─── LEAVE ROOM ─────────────────────────────────────────────
    socket.on('room:leave', async ({ roomId }) => {
      socket.leave(roomId);
      const roomSockets = await io.in(roomId).allSockets();
      io.to(roomId).emit('room:count', { roomId, count: roomSockets.size });
    });

    // ─── SEND MESSAGE TO ROOM ────────────────────────────────────
    socket.on('message:send', ({ roomId, text, replyTo }) => {
      if (!roomId || !text) return;

      const clean = filterMessage(sanitize(text));
      if (!clean) return;

      const message = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        roomId,
        text: clean,
        sender: {
          id: user.id,
          username: user.username,
          avatar_url: user.avatar_url,
        },
        replyTo: replyTo || null,
        timestamp: new Date().toISOString(),
        type: 'text',
      };

      // Broadcast to everyone in room including sender
      io.to(roomId).emit('message:receive', message);
    });

    // ─── SEND FILE/IMAGE IN ROOM ─────────────────────────────────
    socket.on('message:file', ({ roomId, fileUrl, fileName, fileType, fileSize }) => {
      if (!roomId || !fileUrl) return;

      const message = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        roomId,
        text: '',
        fileUrl,
        fileName: sanitize(fileName),
        fileType,
        fileSize,
        sender: {
          id: user.id,
          username: user.username,
          avatar_url: user.avatar_url,
        },
        timestamp: new Date().toISOString(),
        type: 'file',
      };

      io.to(roomId).emit('message:receive', message);
    });

    // ─── TYPING INDICATOR ────────────────────────────────────────
    socket.on('typing:start', ({ roomId }) => {
      if (!roomId) return;
      socket.to(roomId).emit('typing:update', {
        userId: user.id,
        username: user.username,
        roomId,
        typing: true,
      });

      // Auto-clear typing after 3s
      const key = `${user.id}:${roomId}`;
      if (typingTimeouts.has(key)) clearTimeout(typingTimeouts.get(key));
      typingTimeouts.set(key, setTimeout(() => {
        socket.to(roomId).emit('typing:update', {
          userId: user.id, username: user.username, roomId, typing: false,
        });
        typingTimeouts.delete(key);
      }, 3000));
    });

    socket.on('typing:stop', ({ roomId }) => {
      if (!roomId) return;
      const key = `${user.id}:${roomId}`;
      if (typingTimeouts.has(key)) {
        clearTimeout(typingTimeouts.get(key));
        typingTimeouts.delete(key);
      }
      socket.to(roomId).emit('typing:update', {
        userId: user.id, username: user.username, roomId, typing: false,
      });
    });

    // ─── PRIVATE MESSAGES ────────────────────────────────────────
    socket.on('private:send', async ({ toUserId, text, fileUrl, fileName, fileType }) => {
      if (!toUserId || (!text && !fileUrl)) return;

      // Find recipient socket
      const recipientRaw = await redis.hget('online_users', toUserId);
      if (!recipientRaw) {
        return socket.emit('private:error', { error: 'User is offline' });
      }
      const recipient = typeof recipientRaw === 'string' ? JSON.parse(recipientRaw) : recipientRaw;

      const message = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        text: text ? filterMessage(sanitize(text)) : '',
        fileUrl: fileUrl || null,
        fileName: fileName ? sanitize(fileName) : null,
        fileType: fileType || null,
        sender: {
          id: user.id,
          username: user.username,
          avatar_url: user.avatar_url,
        },
        timestamp: new Date().toISOString(),
        type: fileUrl ? 'file' : 'text',
      };

      // Send to recipient
      io.to(recipient.socketId).emit('private:receive', message);
      // Echo to sender
      socket.emit('private:receive', { ...message, toUserId });
    });

    // ─── GET ONLINE USERS ────────────────────────────────────────
    socket.on('users:online', async () => {
      const all = await redis.hgetall('online_users');
      const users = all ? Object.values(all).map(u =>
        typeof u === 'string' ? JSON.parse(u) : u
      ) : [];
      socket.emit('users:list', users);
    });

    // ─── DISCONNECT ──────────────────────────────────────────────
    socket.on('disconnect', async () => {
      console.log(`❌ Disconnected: ${user.username}`);
      await redis.hdel('online_users', user.id);
      io.emit('user:offline', { userId: user.id });

      // Cleanup typing
      typingTimeouts.forEach((timeout, key) => {
        if (key.startsWith(user.id)) {
          clearTimeout(timeout);
          typingTimeouts.delete(key);
        }
      });
    });
  });
};
