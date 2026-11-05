/* 화면(app.js)과 데스크톱 앱 사이의 작은 다리: 아침 알림 띄우기, 창 앞으로 가져오기 */
'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('plannerDesktop', {
  notify: (title, body) => ipcRenderer.send('planner:notify', { title: String(title || ''), body: String(body || '') }),
  show: () => ipcRenderer.send('planner:show'),
  // 테마에 맞춰 창 버튼 영역 색 바꾸기
  setBar: (color, symbolColor) => ipcRenderer.send('planner:bar', { color: String(color || ''), symbolColor: String(symbolColor || '') }),
  // 업데이트: 지금 버전, 새 버전 알림 받기, 확인·설치 요청
  version: () => ipcRenderer.invoke('planner:version'),
  checkUpdate: () => ipcRenderer.invoke('planner:check-update'),
  installUpdate: () => ipcRenderer.send('planner:install-update'),
  onUpdate: (cb) => ipcRenderer.on('planner:update', (e, info) => { try { cb(info); } catch (err) { /* 무시 */ } })
});
