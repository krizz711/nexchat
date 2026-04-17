import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import { format } from 'date-fns';

// Download chat as .txt
export const downloadChatTxt = (messages, roomName) => {
  const lines = messages.map(msg => {
    const time = format(new Date(msg.timestamp), 'HH:mm:ss');
    if (msg.type === 'file') {
      return `[${time}] ${msg.sender.username}: [File: ${msg.fileName}] ${msg.fileUrl}`;
    }
    return `[${time}] ${msg.sender.username}: ${msg.text}`;
  });

  const header = `Chat Export — ${roomName}\nDate: ${format(new Date(), 'PPP')}\n${'─'.repeat(40)}\n\n`;
  const content = header + lines.join('\n');
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  saveAs(blob, `${roomName.replace(/[^a-z0-9]/gi, '_')}_chat.txt`);
};

// Download single file from URL
export const downloadFile = async (url, fileName) => {
  try {
    const res = await fetch(url);
    const blob = await res.blob();
    saveAs(blob, fileName);
  } catch {
    window.open(url, '_blank');
  }
};

// Download all media + chat as zip
export const downloadChatZip = async (messages, roomName) => {
  const zip = new JSZip();
  const folder = zip.folder(roomName.replace(/[^a-z0-9]/gi, '_'));

  // Add chat txt
  const lines = messages.map(msg => {
    const time = format(new Date(msg.timestamp), 'HH:mm:ss');
    if (msg.type === 'file') return `[${time}] ${msg.sender.username}: [File: ${msg.fileName}]`;
    return `[${time}] ${msg.sender.username}: ${msg.text}`;
  });
  folder.file('chat.txt', lines.join('\n'));

  // Add files
  const fileMessages = messages.filter(m => m.type === 'file' && m.fileUrl);
  for (const msg of fileMessages) {
    try {
      const res = await fetch(msg.fileUrl);
      const blob = await res.blob();
      folder.file(msg.fileName || 'file', blob);
    } catch { /* skip failed files */ }
  }

  const content = await zip.generateAsync({ type: 'blob' });
  saveAs(content, `${roomName.replace(/[^a-z0-9]/gi, '_')}_export.zip`);
};
