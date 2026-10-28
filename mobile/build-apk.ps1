# 안드로이드 앱(APK) 다시 빌드
# 실행: powershell -ExecutionPolicy Bypass -File mobile\build-apk.ps1
# 결과: downloads\planner.apk, dist\planner-android.apk
#
# 앱은 서버 주소(https://planner.34-50-58-33.sslip.io)를 그대로 띄우므로 화면을 고칠 땐 서버에만 올리면 되고,
# 앱 이름·아이콘·주소·플러그인을 바꿀 때만 다시 빌드해 휴대폰에 재설치하면 된다.
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$env:JAVA_HOME = "C:\Users\USER\tools\jdk-21.0.12.1+1"
$env:ANDROID_HOME = "C:\Users\USER\tools\android-sdk"

Push-Location $root
try {
  npx cap sync android
  Push-Location (Join-Path $root "android")
  try { .\gradlew.bat assembleRelease --no-daemon -q } finally { Pop-Location }
  if (-not (Test-Path "dist")) { New-Item -ItemType Directory "dist" | Out-Null }
  Copy-Item "android\app\build\outputs\apk\release\app-release.apk" "downloads\planner.apk" -Force
  Copy-Item "downloads\planner.apk" "dist\planner-android.apk" -Force
  Write-Host "완료: downloads\planner.apk"
  Write-Host "서버에 올리려면 Claude 에게 '서버에 올려줘' 라고 하면 됩니다."
} finally { Pop-Location }
