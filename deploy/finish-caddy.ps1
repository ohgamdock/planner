# 마지막 단계: Caddy 설정의 잘못된 줄을 고치고, 설정을 검사한 뒤, Caddy 컨테이너를 재시작해 새 파일을 읽게 한다.
# 실행: powershell -ExecutionPolicy Bypass -File deploy\finish-caddy.ps1
# (서재 앱은 재시작 중 2~3초만 잠깐 끊긴다)
param(
  [string]$HostIp = "34.50.58.33",
  [string]$User = "USER",
  [string]$Key = "$env:USERPROFILE\.ssh\google_compute_engine"
)
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

# 원격 명령은 한글·역슬래시 없이 작성 (PowerShell -> ssh 전달 중 깨짐 방지)
$remote = @(
  'CF=/opt/library/deploy/Caddyfile',
  'sudo cp "$CF" "$CF.bak-$(date +%Y%m%d-%H%M%S)"',
  'sudo sed -i "s/^n#/#/" "$CF"',
  'if ! grep -q "planner.34-50-58-33.sslip.io {" "$CF"; then { echo; cat /opt/planner/deploy/Caddyfile.planner; } | sudo tee -a "$CF" >/dev/null; echo BLOCK_ADDED; else echo BLOCK_PRESENT; fi',
  'echo "--- validate:"',
  'docker run --rm --env-file /opt/library/.env -v "$CF":/etc/caddy/Caddyfile:ro caddy:2.8.4 caddy validate --config /etc/caddy/Caddyfile 2>&1 | tail -2 || { echo VALIDATE_FAILED; exit 1; }',
  'echo "--- restart caddy:"',
  'docker restart deploy-caddy-1',
  'sleep 3',
  'docker exec deploy-caddy-1 caddy adapt --config /etc/caddy/Caddyfile 2>/dev/null | grep -o "planner.34-50-58-33.sslip.io" | head -1 && echo ROUTE_OK || echo ROUTE_MISSING'
) -join '; '

ssh -i $Key "$User@$HostIp" $remote
Write-Host ""
Write-Host "인증서 발급 확인 중 (최대 2분)..."
for ($i = 0; $i -lt 24; $i++) {
  try {
    $r = Invoke-WebRequest -UseBasicParsing "https://planner.34-50-58-33.sslip.io/api/health" -TimeoutSec 10
    Write-Host "성공: $($r.Content)"
    Write-Host "휴대폰에서 https://planner.34-50-58-33.sslip.io 를 열어 보세요."
    exit 0
  } catch { Start-Sleep -Seconds 5 }
}
Write-Host "아직 응답이 없어요. 이 출력을 그대로 알려주세요."
