/* 화면(app.js)과 데스크톱 앱 사이의 작은 다리: 아침 알림 띄우기, 창 앞으로 가져오기 */
'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('plannerDesktop', {
  notify: (title, body) => ipcRenderer.send('planner:notify', { title: String(title || ''), body: String(body || '') }),
  show: () => ipcRenderer.send('planner:show'),
  // 테마에 맞춰 창 버튼 영역 색 바꾸기
  setBar: (color, symbolColor) => ipcRenderer.send('planner:bar', { color: String(color || ''), symbolColor: String(symbolColor || '') })
});
