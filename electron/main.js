/* 나만의 플래너 — 데스크톱 앱 진입점 (Electron)
 * 앱 안에서 동기화 서버를 띄우고, 그 주소를 창에 띄운다.
 * 데이터는 사용자 앱 데이터 폴더(예: %APPDATA%\나만의 플래너\data)에 저장된다.
 */
'use strict';

const electron = require('electron');
const path = require('path');
const server = require('../server.js');

// VS Code·Claude Code 터미널처럼 ELECTRON_RUN_AS_NODE=1 이 설정된 곳에서 실행하면
// Electron이 일반 Node로 동작해 app 객체가 없다. 친절하게 알려주고 끝낸다.
if (typeof electron === 'string' || !electron.app) {
  console.error('Electron이 Node 모드로 실행됐어요. 터미널에서 ELECTRON_RUN_AS_NODE 변수를 지우고 다시 실행해 주세요.');
  console.error('  PowerShell: Remove-Item Env:ELECTRON_RUN_AS_NODE; npm start');
  console.error('  Git Bash  : env -u ELECTRON_RUN_AS_NODE npm start');
  process.exit(1);
}

const { app, BrowserWindow, Menu, shell, dialog, screen, Tray, Notification, ipcMain, nativeImage } = electron;
const fs = require('fs');

// 윈도우 알림 센터에 앱 이름이 제대로 보이도록 (설치판만: 설치할 때 같은 ID의 바로가기가 만들어진다.
// 개발 실행에서 이 ID를 쓰면 작업 표시줄이 창 아이콘 대신 electron.exe 아이콘을 보여준다.)
// 개발 실행에서도 같은 ID를 쓰고, 시작 메뉴에 같은 ID를 가진 바로가기를 만들어 둔다(작업 표시줄 아이콘·알림용).
app.setAppUserModelId('com.osense.diary');
let tray = null;
let quitting = false;

const PREFERRED_PORT = Number(process.env.PLANNER_PORT) || 4310;
const PROJECT_DIR = path.resolve(__dirname, '..');
let mainWindow = null;
let serverInfo = null;

// ---------------------------------------------------------------- 설정 파일
function settingsPath() { return path.join(app.getPath('userData'), 'settings.json'); }
function readSettings() {
  try { return JSON.parse(fs.readFileSync(settingsPath(), 'utf8')) || {}; } catch (e) { return {}; }
}
function writeSettings(patch) {
  const next = Object.assign(readSettings(), patch);
  try { fs.writeFileSync(settingsPath(), JSON.stringify(next, null, 2)); } catch (e) { /* 무시 */ }
  return next;
}

// ---------------------------------------------------------------- 자동 시작
// 개발 모드에서는 electron.exe + 프로젝트 폴더, 배포판에서는 exe 자체를 등록한다.
function loginItemOptions() {
  return app.isPackaged
    ? { path: process.execPath, args: [] }
    : { path: process.execPath, args: [PROJECT_DIR] };
}
function isAutoStart() {
  try { return !!app.getLoginItemSettings(loginItemOptions()).openAtLogin; } catch (e) { return false; }
}
function setAutoStart(on) {
  try {
    app.setLoginItemSettings(Object.assign({ openAtLogin: !!on, name: '나만의 플래너' }, loginItemOptions()));
    writeSettings({ autoStart: !!on });
  } catch (e) { /* 무시 */ }
}

// ---------------------------------------------------------------- 창 위치·크기 기억
function loadWindowState() {
  const s = readSettings().window || null;
  const work = screen.getPrimaryDisplay().workAreaSize;
  const fallback = {
    width: Math.min(1180, Math.round(work.width * 0.9)),
    height: Math.min(880, Math.round(work.height * 0.92)),
    maximized: false
  };
  if (!s || !s.width || !s.height) return fallback;
  // 저장된 위치가 현재 모니터 안에 있는지 확인(모니터 구성이 바뀐 경우 대비)
  const visible = screen.getAllDisplays().some((d) => {
    const a = d.workArea;
    return s.x >= a.x - 50 && s.y >= a.y - 50 && s.x < a.x + a.width - 100 && s.y < a.y + a.height - 100;
  });
  return visible ? s : Object.assign({}, fallback, { maximized: !!s.maximized });
}

let saveStateTimer = null;
function saveWindowState() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const maximized = mainWindow.isMaximized();
  const b = maximized ? (readSettings().window || mainWindow.getNormalBounds()) : mainWindow.getNormalBounds();
  writeSettings({ window: { x: b.x, y: b.y, width: b.width, height: b.height, maximized } });
}
function scheduleSaveWindowState() {
  clearTimeout(saveStateTimer);
  saveStateTimer = setTimeout(saveWindowState, 300);
}

// 두 번 실행해도 창 하나만 유지
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

async function startServer() {
  const dataDir = path.join(app.getPath('userData'), 'data');
  // 같은 PC의 다른 기기(휴대폰 등)가 접속할 수 있도록 모든 인터페이스에서 듣는다.
  // 선호 포트가 막혀 있으면 빈 포트를 자동으로 고른다.
  try {
    return await server.start({ port: PREFERRED_PORT, dataDir });
  } catch (e) {
    return server.start({ port: 0, dataDir });
  }
}

// 창·작업 표시줄 아이콘: 화면(app.js)과 같은 순서로 다섯 장을 하루에 한 장씩
const LOGO_COUNT = 5;
function dailyLogoIndex() {
  const d = new Date();
  const dayOfYear = Math.floor((d - new Date(d.getFullYear(), 0, 1)) / 86400000);
  return (dayOfYear % LOGO_COUNT) + 1;
}
// 창·작업 표시줄 아이콘은 윈도우가 확실히 알아보는 ICO 파일로 (없으면 PNG)
function dailyLogoPath() {
  const ico = path.join(PROJECT_DIR, 'assets', 'logo-' + dailyLogoIndex() + '.ico');
  return fs.existsSync(ico) ? ico : path.join(PROJECT_DIR, 'assets', 'logo-' + dailyLogoIndex() + '.png');
}
function dailyLogoPng() { return path.join(PROJECT_DIR, 'assets', 'logo-' + dailyLogoIndex() + '.png'); }
let appliedLogo = '';
function applyDailyIcon() {
  if (!mainWindow) return;
  const p = dailyLogoPath();
  if (p === appliedLogo) return;
  try { mainWindow.setIcon(p); appliedLogo = p; refreshTrayIcon(); } catch (e) { /* 아이콘 적용 실패는 무시 */ }
}

function showWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) { createWindow(); return; }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}
function showNotification(title, body) {
  if (!Notification.isSupported()) return;
  try {
    const n = new Notification({ title, body, icon: dailyLogoPng() });
    n.on('click', showWindow);
    n.show();
  } catch (e) { /* 알림 실패는 무시 */ }
}
function createTray() {
  if (tray) return;
  try {
    const img = nativeImage.createFromPath(dailyLogoPng()).resize({ width: 16, height: 16 });
    tray = new Tray(img);
    tray.setToolTip('계.. 획..? 비슷한 걸 세워보려고 합니다.');
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: '열기', click: showWindow },
      { type: 'separator' },
      { label: '종료', click: () => { quitting = true; app.quit(); } }
    ]));
    tray.on('click', showWindow);
    tray.on('double-click', showWindow);
  } catch (e) { tray = null; }
}
function refreshTrayIcon() {
  if (!tray) return;
  try { tray.setImage(nativeImage.createFromPath(dailyLogoPng()).resize({ width: 16, height: 16 })); } catch (e) { /* 무시 */ }
}

function createWindow() {
  const state = loadWindowState();
  mainWindow = new BrowserWindow({
    x: state.x,
    y: state.y,
    width: state.width,
    height: state.height,
    minWidth: 380,
    minHeight: 600,
    title: '계.. 획..? 비슷한 걸 세워보려고 합니다.',
    icon: dailyLogoPath(),
    backgroundColor: '#F5F4EF',
    autoHideMenuBar: true,
    show: false, // 화면이 준비된 뒤에 보여서 빈 창 깜빡임이 없다
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false // 창이 숨겨져 있어도 아침 알림 시계가 멈추지 않게
    }
  });

  // 창을 닫아도 앱은 트레이에 남아 아침 알림을 보낸다 (메뉴·트레이의 '종료'로 완전히 끝냄)
  let toldAboutTray = !!readSettings().toldAboutTray;
  mainWindow.on('close', (e) => {
    if (quitting) return;
    e.preventDefault();
    saveWindowState();
    mainWindow.hide();
    if (!toldAboutTray) {
      toldAboutTray = true;
      writeSettings({ toldAboutTray: true });
      showNotification('트레이에서 계속 실행 중이에요', '아침 알림을 보내기 위해 작업 표시줄 오른쪽 아이콘에 남아 있어요. 완전히 끝내려면 아이콘을 오른쪽 클릭 → 종료.');
    }
  });

  mainWindow.once('ready-to-show', () => {
    if (state.maximized) mainWindow.maximize();
    mainWindow.show();
    applyDailyIcon();
  });
  // 자정이 지나면 아이콘도 다음 사진으로
  const iconTimer = setInterval(applyDailyIcon, 60000);
  mainWindow.on('closed', () => clearInterval(iconTimer));
  mainWindow.on('resize', scheduleSaveWindowState);
  mainWindow.on('move', scheduleSaveWindowState);
  mainWindow.on('maximize', scheduleSaveWindowState);
  mainWindow.on('unmaximize', scheduleSaveWindowState);
  mainWindow.on('close', saveWindowState);

  // 새 사용자용 설치판(package.json clean: true)은 예시 데이터 없이 깨끗하게 시작한다
  let clean = false;
  try { clean = !!require('../package.json').clean; } catch (e) { /* 무시 */ }
  mainWindow.loadURL(`http://127.0.0.1:${serverInfo.port}/` + (clean ? '?clean=1' : ''));

  // 외부 링크는 기본 브라우저로
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => { mainWindow = null; });
}

function buildMenu() {
  const template = [
    {
      label: '플래너',
      submenu: [
        {
          label: '서버 주소 보기',
          click: () => {
            dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: '동기화 서버',
              message: `이 PC의 플래너 서버: http://localhost:${serverInfo.port}`,
              detail: '같은 Wi-Fi의 휴대폰에서 이 PC의 IP 주소와 포트로 접속하면 동기화 코드로 기록을 이어 볼 수 있어요.\n데이터 폴더: ' + serverInfo.dataDir
            });
          }
        },
        { label: '데이터 폴더 열기', click: () => shell.openPath(serverInfo.dataDir) },
        { type: 'separator' },
        {
          label: '컴퓨터 켤 때 자동 실행',
          type: 'checkbox',
          checked: isAutoStart(),
          click: (item) => setAutoStart(item.checked)
        },
        { type: 'separator' },
        { role: 'reload', label: '새로 고침' },
        { role: 'toggleDevTools', label: '개발자 도구' },
        { type: 'separator' },
        { label: '종료', click: () => { quitting = true; app.quit(); } }
      ]
    },
    {
      label: '편집',
      submenu: [
        { role: 'undo', label: '실행 취소' },
        { role: 'redo', label: '다시 실행' },
        { type: 'separator' },
        { role: 'cut', label: '잘라내기' },
        { role: 'copy', label: '복사' },
        { role: 'paste', label: '붙여넣기' },
        { role: 'selectAll', label: '모두 선택' }
      ]
    },
    {
      label: '보기',
      submenu: [
        { role: 'zoomIn', label: '확대' },
        { role: 'zoomOut', label: '축소' },
        { role: 'resetZoom', label: '원래 크기' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: '전체 화면' }
      ]
    }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.whenReady().then(async () => {
  try {
    serverInfo = await startServer();
  } catch (e) {
    dialog.showErrorBox('플래너를 시작할 수 없어요', e.message);
    app.quit();
    return;
  }
  // 처음 실행할 때 한 번 자동 시작을 켠다. 이후에는 메뉴에서 바꾼 값을 따른다.
  if (readSettings().autoStart === undefined) setAutoStart(true);
  buildMenu();
  createTray();
  createWindow();

  // 화면에서 보내는 요청: 아침 알림 띄우기 / 창 앞으로
  ipcMain.on('planner:notify', (e, msg) => { if (msg && msg.title) showNotification(msg.title, msg.body || ''); });
  ipcMain.on('planner:show', showWindow);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('second-instance', showWindow);

app.on('window-all-closed', () => {
  // 트레이에 남아 있으므로 창이 모두 닫혀도 끝내지 않는다
});

app.on('before-quit', () => {
  quitting = true;
  if (serverInfo && serverInfo.server) serverInfo.server.close();
});
