# 플래너 동기화 서버를 GCP library-vm 에 올리는 스크립트 (Windows PowerShell)
# 실행:  powershell -ExecutionPolicy Bypass -File deploy\deploy-planner.ps1
#
# 하는 일
#  1) 앱 파일을 tar 로 묶어 서버 /opt/planner 로 올린다 (데이터 볼륨은 건드리지 않음)
#  2) docker compose 로 planner 컨테이너를 빌드·기동한다
#  3) 서재 앱 Caddyfile 에 planner 블록이 없으면 덧붙이고 Caddy 를 다시 읽게 한다
param(
  [string]$HostIp = "34.50.58.33",
  [string]$User = "USER",
  [string]$Key = "$env:USERPROFILE\.ssh\google_compute_engine",
  [string]$RemoteDir = "/opt/planner",
  [string]$LibraryDir = "/opt/library"
)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$ssh = "ssh -i `"$Key`" -o StrictHostKeyChecking=accept-new $User@$HostIp"

Write-Host "1) 파일 묶는 중..."
$tar = Join-Path $env:TEMP "planner-deploy.tar"
if (Test-Path $tar) { Remove-Item $tar -Force }
Push-Location $root
tar -cf $tar index.html style.css app.js merge.js server.js manifest.webmanifest sw.js assets/icon.png assets/icon-192.png assets/icon-512.png assets/icon-maskable-192.png assets/icon-maskable-512.png assets/logo-1.png assets/logo-2.png assets/logo-3.png assets/logo-4.png assets/logo-5.png assets/logo-1-full.png assets/logo-2-full.png assets/logo-3-full.png assets/logo-4-full.png assets/logo-5-full.png assets/party/cat-dance.mp4 assets/party/cat-dance.gif assets/fish deploy/Dockerfile deploy/docker-compose.planner.yml deploy/Caddyfile.planner
Pop-Location

Write-Host "2) 서버로 올리는 중..."
Invoke-Expression "$ssh 'sudo mkdir -p $RemoteDir && sudo chown `$(id -u):`$(id -g) $RemoteDir'"
scp -i $Key $tar "${User}@${HostIp}:/tmp/planner-deploy.tar"

$remote = @"
set -e
cd $RemoteDir
tar -xf /tmp/planner-deploy.tar && rm -f /tmp/planner-deploy.tar
# Caddy 컨테이너와 그 네트워크 찾기
CADDY=`$(docker ps --format '{{.Names}} {{.Image}}' | awk '/caddy/ {print `$1; exit}')
if [ -z "`$CADDY" ]; then echo 'Caddy 컨테이너를 찾지 못했어요. 수동으로 Caddyfile.planner 블록을 추가해 주세요.'; NET=bridge; else
  NET=`$(docker inspect -f '{{range `$k, `$v := .NetworkSettings.Networks}}{{`$k}}{{end}}' "`$CADDY" | head -c 200)
fi
echo "Caddy=`$CADDY  network=`$NET"
export CADDY_NETWORK="`$NET"
docker compose -f deploy/docker-compose.planner.yml up -d --build
# Caddyfile 에 블록 추가 (한 번만)
CF=`$(ls $LibraryDir/deploy/Caddyfile $LibraryDir/Caddyfile 2>/dev/null | head -1 || true)
if [ -n "`$CF" ] && ! grep -q 'planner.34-50-58-33.sslip.io' "`$CF"; then
  echo "" | sudo tee -a "`$CF" >/dev/null
  sudo tee -a "`$CF" < deploy/Caddyfile.planner >/dev/null
  echo "Caddyfile 에 planner 블록을 추가했어요: `$CF"
  [ -n "`$CADDY" ] && docker exec "`$CADDY" caddy reload --config /etc/caddy/Caddyfile || docker restart "`$CADDY"
else
  echo "Caddyfile 은 그대로 둡니다 (이미 있거나 못 찾음: `$CF)"
fi
sleep 2
curl -s http://127.0.0.1:4311/api/health && echo
"@
$remote = $remote -replace "`r", ""
# 원격 스크립트는 파일로 올려 bash 로 실행한다 (PowerShell 5.1 이 ||, 따옴표를 잘못 해석하는 문제 회피)
$remoteFile = Join-Path $env:TEMP "planner-remote.sh"
[IO.File]::WriteAllText($remoteFile, $remote, (New-Object Text.UTF8Encoding $false))
scp -i $Key $remoteFile "${User}@${HostIp}:/tmp/planner-remote.sh"
Invoke-Expression "$ssh 'bash /tmp/planner-remote.sh; rm -f /tmp/planner-remote.sh'"

Write-Host "3) 확인: https://planner.34-50-58-33.sslip.io/api/health"
try { (Invoke-WebRequest -UseBasicParsing "https://planner.34-50-58-33.sslip.io/api/health" -TimeoutSec 20).Content } catch { Write-Host "아직 응답 없음(인증서 발급에 1분쯤 걸릴 수 있어요): $($_.Exception.Message)" }
