import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { getSocket } from '../socket';
import { usePrivateChat } from '../hooks/usePrivateChat';
import Sidebar from '../components/Sidebar';
import ChatRoom from '../components/ChatRoom';
import PrivateChat from '../components/PrivateChat';
import styles from './Home.module.css';

export default function Home() {
  const { user } = useAuth();
  const [activeRoom, setActiveRoom] = useState(null);
  const [onlineUsers, setOnlineUsers] = useState([]);
  const { activeChat, openChat, closeChat, getMessages, sendPrivateMessage, sendPrivateFile } = usePrivateChat();
  const [privateChatUser, setPrivateChatUser] = useState(null);

  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;

    // Get online users
    socket.emit('users:online');
    socket.on('users:list', (users) => {
      setOnlineUsers(users.filter(u => u.id !== user.id));
    });
    socket.on('user:online', () => socket.emit('users:online'));
    socket.on('user:offline', () => socket.emit('users:online'));

    return () => {
      socket.off('users:list');
      socket.off('user:online');
      socket.off('user:offline');
    };
  }, [user.id]);

  const handleUserClick = (u) => {
    setPrivateChatUser(u);
    openChat(u.id);
  };

  return (
    <div className={styles.layout}>
      <Sidebar
        activeRoom={activeRoom}
        onRoomSelect={setActiveRoom}
        onlineUsers={onlineUsers}
        onUserClick={handleUserClick}
      />

      <main className={styles.main}>
        {activeRoom ? (
          <ChatRoom key={activeRoom.id} room={activeRoom} />
        ) : (
          <div className={styles.welcome}>
            <div className={styles.welcomeInner}>
              <div className={styles.welcomeLogo}>NexChat</div>
              <p>Select a room from the sidebar to start chatting.</p>
              <p className={styles.hint}>Messages are not stored — they live only while you're connected.</p>
            </div>
          </div>
        )}
      </main>

      {/* Private chat popup */}
      {activeChat && privateChatUser && (
        <div className={styles.privateWrap}>
          <PrivateChat
            targetUser={privateChatUser}
            messages={getMessages(activeChat)}
            onSend={(text) => sendPrivateMessage(activeChat, text)}
            onSendFile={(url, name, type) => sendPrivateFile(activeChat, url, name, type)}
            onClose={closeChat}
          />
        </div>
      )}
    </div>
  );
}
