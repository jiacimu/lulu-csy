$ErrorActionPreference = "Stop"

if (-not $env:JAVA_HOME) {
  $androidStudioJbr = "C:\Program Files\Android\Android Studio\jbr"
  $androidStudioJava = Join-Path $androidStudioJbr "bin\java.exe"
  if (Test-Path -LiteralPath $androidStudioJava) {
    $env:JAVA_HOME = $androidStudioJbr
  }
}

if ($env:JAVA_HOME) {
  $javaBin = Join-Path $env:JAVA_HOME "bin"
  $env:Path = "$javaBin$([IO.Path]::PathSeparator)$env:Path"
}

if (-not (Get-Command java -ErrorAction SilentlyContinue)) {
  throw "Java was not found. Install Android Studio or set JAVA_HOME before building the Android APK."
}

if (-not $env:ANDROID_HOME) {
  $defaultSdk = Join-Path $env:LOCALAPPDATA "Android\Sdk"
  if (Test-Path -LiteralPath $defaultSdk) {
    $env:ANDROID_HOME = $defaultSdk
  }
}

npm run build
npx cap sync android

$androidDir = Join-Path $PSScriptRoot "..\android"
Push-Location $androidDir
try {
  .\gradlew.bat assembleDebug --console=plain
} finally {
  Pop-Location
}
