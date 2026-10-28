# 나만의 플래너

기록은 가볍게, 다시 시작은 언제든. 월간 달력과 일 다이어리 두 화면으로 이루어진 개인 플래너입니다.
`Claude_Code_나만의_플래너_동일구현_명세.md`의 화면 명세를 기준으로 구현했습니다.

## 데스크톱 앱으로 쓰기

`dist/` 폴더에 빌드된 파일이 있습니다.

| 파일 | 용도 |
|---|---|
| `나만의 플래너-1.0.0-win-x64.exe` | 설치 프로그램. 설치 위치를 고를 수 있고 바탕화면 바로가기를 만듭니다. |
| `나만의 플래너-1.0.0-portable.exe` | 설치 없이 바로 실행하는 단일 파일 |

- 앱을 켜면 내장 동기화 서버가 자동으로 함께 뜹니다(기본 4310번, 막혀 있으면 빈 포트 자동 선택).
- 창 위치와 크기를 기억하고, 화면이 준비된 뒤에 창을 보여 줍니다(빈 창 깜빡임 없음).
- 처음 실행하면 Windows 시작 프로그램에 자동 등록됩니다. 끄려면 메뉴 `플래너 → 컴퓨터 켤 때 자동 실행` 체크를 해제하세요.
- 창 상단의 "오늘 한눈에" 줄에서 오늘 할 일 진행률, 오늘 기록 수, 다가오는 기념일·일정을 바로 보고 누르면 해당 화면으로 이동합니다.
- 기록은 `%APPDATA%\나만의 플래너\data\` 에 저장됩니다. 메뉴 `플래너 → 데이터 폴더 열기`로 바로 갈 수 있습니다.
- 같은 Wi-Fi의 휴대폰에서 `http://<이 PC의 IP>:4310` 으로 접속해 같은 동기화 코드를 입력하면 기록을 이어 볼 수 있습니다. 메뉴 `플래너 → 서버 주소 보기`에서 확인합니다.

개발 중 실행과 다시 빌드:

```
npm install            # 처음 한 번
npm start              # 개발 모드로 앱 실행
npm run dist           # dist/ 에 설치 파일과 포터블 exe 생성
```

VS Code나 Claude Code 터미널에서 `npm start`가 바로 꺼지면 `ELECTRON_RUN_AS_NODE` 환경 변수 때문입니다.
PowerShell에서는 `Remove-Item Env:ELECTRON_RUN_AS_NODE` 를 먼저 실행하면 됩니다.

## 브라우저로만 쓰기 (서버 단독 실행)

```
node server.js
```

브라우저에서 http://localhost:4310 을 엽니다. 외부 패키지 설치는 필요 없습니다(Node 18 이상).
3000번은 다른 앱(트럼프 주식 레이더)이 쓰고 있어 4310번을 기본으로 둡니다.
포트를 바꾸려면 `PORT=8080 node server.js` 처럼 실행합니다.

`index.html`을 파일로 바로 열어도 동작하지만, 이때는 이 기기(브라우저 저장소)에만 저장됩니다.

## 파일

| 파일 | 역할 |
|---|---|
| `index.html` | 화면 구조 |
| `style.css` | 디자인 토큰과 레이아웃(760px 이하 1열) |
| `app.js` | 달력·다이어리·기념일·프로젝트·동기화 로직 |
| `merge.js` | 데이터 구조 정규화와 병합 규칙(브라우저·서버 공용) |
| `server.js` | 정적 파일 + 동기화 API 서버 |
| `electron/main.js` | 데스크톱 앱 진입점(내장 서버 실행 + 창 생성) |
| `package.json` | 앱 정보, 실행 스크립트, electron-builder 설정 |
| `dist/` | 빌드된 설치 파일과 포터블 exe |
| `data/` | 서버 단독 실행 시 동기화 코드별 JSON 저장 폴더 |

## 휴대폰(삼성·안드로이드)과 실시간 연동

구조: 인터넷의 동기화 서버(GCP library-vm, `https://planner.34-50-58-33.sslip.io`)에 데스크톱 앱과 휴대폰이 같이 붙습니다.
서버가 저장을 받으면 열려 있는 모든 기기에 실시간 알림(SSE)을 보내고, 각 기기는 즉시 받아옵니다. 알림이 끊겨도 15초 간격 확인이 계속됩니다.

1. 서버 배포(처음 한 번): `powershell -ExecutionPolicy Bypass -File deploy\deploy-planner.ps1`
   - 앱 파일을 `/opt/planner`로 올리고 Docker 컨테이너(`planner`)를 띄운 뒤, 서재 앱 Caddyfile에 `deploy/Caddyfile.planner` 블록을 덧붙여 HTTPS 주소를 엽니다.
   - 데이터는 Docker 볼륨 `planner-data`에 코드별 JSON으로 저장됩니다.
2. 데스크톱 앱에서 기기 연결 패널을 열어 `새 동기화 코드 만들기`. (데스크톱 앱은 기본으로 위 서버에 붙습니다. 패널의 "동기화 서버 주소"에서 바꿀 수 있습니다.)
3. 휴대폰 Chrome이나 삼성 인터넷으로 `https://planner.34-50-58-33.sslip.io` 를 열고, 브라우저 메뉴에서 **홈 화면에 추가**를 누르면 앱 아이콘으로 설치됩니다(PWA).
4. 휴대폰 앱의 기기 연결 패널에 같은 코드를 입력하고 `연결`.

인터넷 서버 없이 같은 Wi-Fi에서만 쓰려면: 데스크톱 앱의 "동기화 서버 주소"를 `http://<PC의 IP>:4310`으로 바꾸고, 휴대폰에서도 같은 주소를 엽니다(이 경우 홈 화면 설치는 안 되고 브라우저로 씁니다).

## 기기 간 동기화

1. 헤더 오른쪽 상태 문구를 눌러 기기 연결 패널을 엽니다.
2. `새 동기화 코드 만들기`를 누르면 이 기기의 기록이 서버에 올라가고 코드가 생깁니다.
3. 다른 기기에서 같은 패널에 코드를 입력하고 `연결`을 누르면 같은 데이터를 이어 봅니다.

- 데이터는 코드별로 완전히 분리되어 `data/<코드>.json`에 저장됩니다. 이메일 등 개인정보는 키로 쓰지 않습니다.
- 저장은 로컬 캐시에 먼저 쓰고 서버로 보냅니다. 서버 연결이 끊겨도 로컬 기록은 지워지지 않고 다시 연결되면 재시도합니다.
- 열린 다른 기기는 15초 간격, 그리고 탭이 다시 보일 때 서버 변경을 확인합니다.
- 최초 연결 시 로컬 기록과 서버 기록을 병합합니다. 할 일은 날짜+텍스트, 기록은 날짜+본문, 이벤트는 ID 기준으로 중복을 피합니다.

## 데이터 구조

```
days[YYYY-MM-DD].tasks[]   { id, text, done, createdAt, updatedAt }
notes[]                    { id, dayKey, text, mood, date, updatedAt, image? }   image는 JPEG data URL(긴 변 1200px로 축소)
events[]                   { id, title, date, endDate?, kind: anniversary|schedule, repeat: yearly|none, updatedAt }   endDate가 있으면 기간 일정
projects.work[] / personal[] { id, title, next, status: active|paused|done, memo, tasks[], log[], createdAt, updatedAt }
  tasks[]  { id, text, done, createdAt, updatedAt }     프로젝트 할 일 (일 다이어리 "오늘로" 복사 가능)
  log[]    { id, text, date, updatedAt }                진행 기록(한 줄)
deleted{ id: deletedAt }   삭제 흔적(기기 간 병합 시 되살아나지 않게 함)
```

헤더의 동기화 상태 문구를 눌러 여는 기기 연결 패널에서 `백업 파일 내려받기`로 전체 JSON을 내려받고, `백업 불러오기`로 복원(병합)합니다.
