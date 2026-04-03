#Requires -Version 5.1
# GRC Assessment Platform - Build and Sign Script
# Usage: Right-click -> Run with PowerShell
#   Or:  powershell -ExecutionPolicy Bypass -File scripts\build.ps1
#
# To build with a code signing certificate, pass parameters:
#   .\build.ps1 -CertPath "C:\mycert.pfx" -CertPassword "mypassword"

param(
    [string]$CertPath     = "",
    [string]$CertPassword = "",
    [string]$CertSha1     = "",
    [switch]$SkipSigning
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# ── Project root (one level up from scripts\) ─────────────────────
$ScriptDir = Split-Path $PSScriptRoot

# ── Helper functions ──────────────────────────────────────────────
function Write-Step { param([string]$msg)
    Write-Host ""
    Write-Host "==> $msg" -ForegroundColor Cyan
}

function Write-OK { param([string]$msg)
    Write-Host "    OK: $msg" -ForegroundColor Green
}

function Write-Warn { param([string]$msg)
    Write-Host "    WARN: $msg" -ForegroundColor Yellow
}

function Write-Fail { param([string]$msg)
    Write-Host ""
    Write-Host "ERROR: $msg" -ForegroundColor Red
    Write-Host ""
    Read-Host "Press Enter to exit"
    exit 1
}

# ── Banner ────────────────────────────────────────────────────────
Clear-Host
Write-Host ""
Write-Host "  GRC Assessment Platform - Build Tool" -ForegroundColor Blue
Write-Host "  =====================================" -ForegroundColor Blue
Write-Host ""

$willSign = ($CertPath -ne "" -and (-not $SkipSigning))

if ($willSign) {
    Write-Host "  Mode: SIGNED BUILD" -ForegroundColor Green
    Write-Host "  Cert: $CertPath" -ForegroundColor White
} else {
    Write-Host "  Mode: UNSIGNED BUILD" -ForegroundColor Yellow
    Write-Host "  Tip: Pass -CertPath and -CertPassword to enable signing" -ForegroundColor White
}

Write-Host ""
Read-Host "  Press Enter to continue (Ctrl+C to cancel)"

# ── Check winget ──────────────────────────────────────────────────
Write-Step "Checking Windows Package Manager (winget)..."

$winget = Get-Command winget -ErrorAction SilentlyContinue
if (-not $winget) {
    Write-Fail "winget not found. Install 'App Installer' from the Microsoft Store, then re-run."
}
Write-OK "winget is available"

# ── Check Node.js ─────────────────────────────────────────────────
Write-Step "Checking Node.js..."

$nodeCmd  = Get-Command node -ErrorAction SilentlyContinue
$needNode = $true

if ($nodeCmd) {
    $nodeVer   = & node --version 2>$null
    $nodeMajor = [int]($nodeVer -replace 'v(\d+).*', '$1')
    if ($nodeMajor -ge 18) {
        Write-OK "Node.js $nodeVer already installed"
        $needNode = $false
    } else {
        Write-Warn "Node.js $nodeVer is too old - need v18 or later"
    }
}

if ($needNode) {
    Write-Host "    Installing Node.js 20 LTS via winget..." -ForegroundColor White
    & winget install --id OpenJS.NodeJS.LTS --version "20.*" `
        --accept-source-agreements --accept-package-agreements --silent

    # Refresh PATH so node is available in this session
    $machinePath = [System.Environment]::GetEnvironmentVariable("PATH", "Machine")
    $userPath    = [System.Environment]::GetEnvironmentVariable("PATH", "User")
    $env:PATH    = "$machinePath;$userPath"

    $nodeVer = & node --version 2>$null
    Write-OK "Node.js $nodeVer installed"
}

# ── Check Visual Studio C++ Build Tools ───────────────────────────
Write-Step "Checking Visual Studio C++ Build Tools..."

$vsWherePath = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
$hasCppTools = $false

if (Test-Path $vsWherePath) {
    $vsJson = & "$vsWherePath" -products * `
        -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 `
        -format json 2>$null
    $vsInstalls = $vsJson | ConvertFrom-Json
    if ($vsInstalls -and $vsInstalls.Count -gt 0) {
        $hasCppTools = $true
        Write-OK "Visual C++ Build Tools $($vsInstalls[0].installationVersion)"
    }
}

if (-not $hasCppTools) {
    Write-Host "    Visual C++ Build Tools not found - installing..." -ForegroundColor White
    Write-Host "    This may take 5-15 minutes on first run." -ForegroundColor Yellow

    & winget install --id Microsoft.VisualStudio.2022.BuildTools `
        --override "--quiet --wait --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended" `
        --accept-source-agreements --accept-package-agreements

    Write-OK "Visual C++ Build Tools installed"
}

# ── Validate certificate (if signing) ─────────────────────────────
if ($willSign) {
    Write-Step "Validating code signing certificate..."

    if (-not (Test-Path $CertPath)) {
        Write-Fail "Certificate file not found at: $CertPath"
    }

    try {
        if ($CertPassword -ne "") {
            $securePw = ConvertTo-SecureString $CertPassword -AsPlainText -Force
            $cert     = Get-PfxCertificate -FilePath $CertPath -Password $securePw
        } else {
            $cert = Get-PfxCertificate -FilePath $CertPath
        }

        Write-Host "    Subject:  $($cert.Subject)" -ForegroundColor White
        Write-Host "    Expires:  $($cert.NotAfter)" -ForegroundColor White
        Write-Host "    SHA1:     $($cert.Thumbprint)" -ForegroundColor White

        if ($cert.NotAfter -lt (Get-Date)) {
            Write-Fail "Certificate has EXPIRED on $($cert.NotAfter)"
        }

        Write-OK "Certificate is valid"

        if ($CertSha1 -eq "") {
            $CertSha1 = $cert.Thumbprint
        }
    } catch {
        Write-Fail "Could not read certificate: $_"
    }
}

# ── npm install ───────────────────────────────────────────────────
Write-Step "Installing npm dependencies (compiles SQLite for Electron)..."

Set-Location $ScriptDir
$env:npm_config_msvs_version = "2022"

& npm install 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Warn "npm install reported errors. Attempting manual native rebuild..."
    & npx @electron/rebuild -f -w better-sqlite3 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-Fail "SQLite native module build failed. See output above."
    }
}

Write-OK "Dependencies installed"

# ── Set environment variables for electron-builder ────────────────
Write-Step "Building Windows installer..."

if ($willSign) {
    $env:WIN_CERT_PATH     = $CertPath
    $env:WIN_CERT_PASSWORD = $CertPassword
    $env:WIN_CERT_SHA1     = $CertSha1
    $env:WIN_CERT_SUBJECT  = ""
} else {
    $env:WIN_CERT_PATH     = ""
    $env:WIN_CERT_PASSWORD = ""
    $env:WIN_CERT_SHA1     = ""
    $env:WIN_CERT_SUBJECT  = "__skip__"
}

# ── Run electron-builder ──────────────────────────────────────────
& npm run build:nsis 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Fail "Build failed. See output above."
}

# ── Find the output installer ─────────────────────────────────────
$installer = Get-ChildItem "$ScriptDir\dist\*.exe" |
             Sort-Object LastWriteTime -Descending |
             Select-Object -First 1

if (-not $installer) {
    Write-Fail "Installer .exe not found in dist\ - build may have failed."
}

# ── Verify Authenticode signature (signed builds only) ────────────
if ($willSign) {
    Write-Step "Verifying Authenticode signature..."

    $sig = Get-AuthenticodeSignature $installer.FullName

    Write-Host "    File:   $($installer.Name)" -ForegroundColor White
    Write-Host "    Status: $($sig.Status)" -ForegroundColor White
    Write-Host "    Signer: $($sig.SignerCertificate.Subject)" -ForegroundColor White

    if ($sig.Status -ne 'Valid') {
        Write-Warn "Signature status is '$($sig.Status)' - verify the installer manually."
    } else {
        Write-OK "Authenticode signature verified"
    }
}

# ── Summary ───────────────────────────────────────────────────────
$sizeMB = [math]::Round($installer.Length / 1MB, 1)

Write-Host ""
Write-Host "  Build Complete!" -ForegroundColor Green
Write-Host "  ===============" -ForegroundColor Green
Write-Host ""
Write-Host "  File:   $($installer.FullName)" -ForegroundColor White
Write-Host "  Size:   $sizeMB MB" -ForegroundColor White

if ($willSign) {
    Write-Host "  Signed: Yes" -ForegroundColor Green
} else {
    Write-Host "  Signed: No (unsigned build)" -ForegroundColor Yellow
}

Write-Host ""

$open = Read-Host "  Open the dist folder now? (Y/n)"
if ($open -ne 'n' -and $open -ne 'N') {
    Start-Process explorer.exe -ArgumentList "$ScriptDir\dist"
}

Write-Host ""
