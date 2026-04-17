#Requires -Version 5.1
# GRC Assessment Platform - Build and Sign Script
# Usage: Right-click -> Run with PowerShell
#   Or:  powershell -ExecutionPolicy Bypass -File scripts\build.ps1
#
# To build with a code signing certificate:
#   .\build.ps1 -CertPath "C:\mycert.pfx" -CertPassword "mypassword"

param(
    [string]$CertPath     = "",
    [string]$CertPassword = "",
    [string]$CertSha1     = "",
    [switch]$SkipSigning
)

$ErrorActionPreference = "Stop"

# ── Project root (one level up from scripts\) ─────────────────────
$ScriptDir = Split-Path $PSScriptRoot

# ── Helper functions ──────────────────────────────────────────────
function Write-Step {
    param([string]$msg)
    Write-Host ""
    Write-Host "==> $msg" -ForegroundColor Cyan
}

function Write-OK {
    param([string]$msg)
    Write-Host "    OK: $msg" -ForegroundColor Green
}

function Write-Warn {
    param([string]$msg)
    Write-Host "    WARN: $msg" -ForegroundColor Yellow
}

function Write-Fail {
    param([string]$msg)
    Write-Host ""
    Write-Host "ERROR: $msg" -ForegroundColor Red
    Write-Host ""
    Read-Host "Press Enter to exit"
    exit 1
}

function Refresh-Path {
    # Reload PATH from registry so newly installed tools are available
    # without needing to restart PowerShell
    $machinePath = [System.Environment]::GetEnvironmentVariable("Path", "Machine")
    $userPath    = [System.Environment]::GetEnvironmentVariable("Path", "User")
    $env:Path    = "$machinePath;$userPath"
}

function Get-NodeMajorVersion {
    try {
        $v = & node --version 2>$null
        if ($v -match 'v(\d+)') { return [int]$Matches[1] }
    } catch {}
    return 0
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
    Write-Host "  Tip:  Pass -CertPath and -CertPassword to enable signing" -ForegroundColor White
}

Write-Host ""
Read-Host "  Press Enter to continue (Ctrl+C to cancel)"

# ── Check Node.js ─────────────────────────────────────────────────
Write-Step "Checking Node.js..."

$nodeMajor = Get-NodeMajorVersion

if ($nodeMajor -ge 18) {
    $nodeVer = & node --version 2>$null
    Write-OK "Node.js $nodeVer already installed"
} else {
    # Try winget first (Windows 11 / updated Windows 10)
    $winget = Get-Command winget -ErrorAction SilentlyContinue

    if ($winget) {
        Write-Host "    Installing Node.js 20 LTS via winget..." -ForegroundColor White
        Write-Host "    (If asked about store terms, type Y and press Enter)" -ForegroundColor White

        # Use exact id without version filter - installs latest LTS
        & winget install --id OpenJS.NodeJS.LTS `
            --accept-source-agreements --accept-package-agreements --silent
        # winget exit code 0 = success, -1978335212 = already installed (also fine)
        if ($LASTEXITCODE -ne 0 -and $LASTEXITCODE -ne -1978335212) {
            Write-Warn "winget returned $LASTEXITCODE - trying direct download fallback..."
            $winget = $null  # fall through to direct download
        }
    }

    if (-not $winget) {
        # Direct download fallback - always works, no winget needed
        Write-Host "    Downloading Node.js 20 LTS installer directly..." -ForegroundColor White
        $nodeUrl       = "https://nodejs.org/dist/v20.17.0/node-v20.17.0-x64.msi"
        $nodeMsi       = "$env:TEMP\node-v20.17.0-x64.msi"
        Write-Host "    From: $nodeUrl" -ForegroundColor White

        try {
            [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
            Invoke-WebRequest -Uri $nodeUrl -OutFile $nodeMsi -UseBasicParsing
        } catch {
            Write-Fail "Failed to download Node.js: $_`n`nPlease download and install manually from https://nodejs.org then re-run this script."
        }

        Write-Host "    Running Node.js installer (silent)..." -ForegroundColor White
        Start-Process msiexec.exe -ArgumentList "/i `"$nodeMsi`" /quiet /norestart" -Wait
        Remove-Item $nodeMsi -ErrorAction SilentlyContinue
    }

    # Refresh PATH so node is visible in this session
    Refresh-Path

    # Also check common install paths manually if still not found
    $nodePaths = @(
        "$env:ProgramFiles\nodejs",
        "$env:LOCALAPPDATA\Programs\nodejs"
    )
    foreach ($p in $nodePaths) {
        if (Test-Path "$p\node.exe") {
            if ($env:Path -notlike "*$p*") {
                $env:Path = "$p;$env:Path"
            }
            break
        }
    }

    $nodeMajor = Get-NodeMajorVersion
    if ($nodeMajor -ge 18) {
        $nodeVer = & node --version 2>$null
        Write-OK "Node.js $nodeVer installed successfully"
    } else {
        Write-Fail "Node.js installation did not complete.`n`nPlease install Node.js 20 LTS manually from https://nodejs.org`nthen re-run this script."
    }
}

# ── Check npm ─────────────────────────────────────────────────────
$npmCmd = Get-Command npm -ErrorAction SilentlyContinue
if (-not $npmCmd) {
    # npm ships with Node but may not be on PATH yet - add node dir explicitly
    $nodeBin = Split-Path (Get-Command node).Source
    $env:Path = "$nodeBin;$env:Path"
}
$npmVer = & npm --version 2>$null
Write-OK "npm $npmVer"

# ── Check Visual Studio C++ Build Tools ───────────────────────────
Write-Step "Checking Visual Studio C++ Build Tools..."

$vsWherePath = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
$hasCppTools = $false

if (Test-Path $vsWherePath) {
    try {
        $vsJson     = & "$vsWherePath" -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -format json 2>$null
        $vsInstalls = $vsJson | ConvertFrom-Json
        if ($vsInstalls -and $vsInstalls.Count -gt 0) {
            $hasCppTools = $true
            Write-OK "Visual C++ Build Tools $($vsInstalls[0].installationVersion)"
        }
    } catch {}
}

if (-not $hasCppTools) {
    Write-Host "    Visual C++ Build Tools not found - installing..." -ForegroundColor White
    Write-Host "    This takes 5-15 minutes. Please wait." -ForegroundColor Yellow

    $winget2 = Get-Command winget -ErrorAction SilentlyContinue
    if ($winget2) {
        & winget install --id Microsoft.VisualStudio.2022.BuildTools `
            --override "--quiet --wait --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended" `
            --accept-source-agreements --accept-package-agreements
    } else {
        # Direct download fallback
        $vsUrl = "https://aka.ms/vs/17/release/vs_buildtools.exe"
        $vsExe = "$env:TEMP\vs_buildtools.exe"
        Write-Host "    Downloading VS Build Tools..." -ForegroundColor White

        try {
            [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
            Invoke-WebRequest -Uri $vsUrl -OutFile $vsExe -UseBasicParsing
        } catch {
            Write-Fail "Failed to download VS Build Tools: $_`n`nDownload manually from https://aka.ms/vs/17/release/vs_buildtools.exe"
        }

        Start-Process $vsExe -ArgumentList "--quiet --wait --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended" -Wait
        Remove-Item $vsExe -ErrorAction SilentlyContinue
    }

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
            Write-Fail "Certificate EXPIRED on $($cert.NotAfter)"
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
    Write-Warn "npm install reported errors. Trying manual native rebuild..."
    & npx @electron/rebuild -f -w better-sqlite3 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-Fail "SQLite native module build failed. See output above."
    }
}

Write-OK "Dependencies installed"

# ── Set signing env vars for electron-builder ─────────────────────
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

# ── Build ──────────────────────────────────────────────────────────
Write-Step "Building Windows installer..."

& npm run build:nsis 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Fail "Build failed. See output above."
}

# ── Find output file ──────────────────────────────────────────────
$installer = Get-ChildItem "$ScriptDir\dist\*.exe" |
             Sort-Object LastWriteTime -Descending |
             Select-Object -First 1

if (-not $installer) {
    Write-Fail "Installer .exe not found in dist\ - build may have failed silently."
}

# ── Verify signature (signed builds only) ─────────────────────────
if ($willSign) {
    Write-Step "Verifying Authenticode signature..."

    $sig = Get-AuthenticodeSignature $installer.FullName

    Write-Host "    File:   $($installer.Name)" -ForegroundColor White
    Write-Host "    Status: $($sig.Status)" -ForegroundColor White
    Write-Host "    Signer: $($sig.SignerCertificate.Subject)" -ForegroundColor White

    if ($sig.Status -ne 'Valid') {
        Write-Warn "Signature status '$($sig.Status)' - verify manually before distributing."
    } else {
        Write-OK "Authenticode signature verified"
    }
}

# ── Done ──────────────────────────────────────────────────────────
$sizeMB = [math]::Round($installer.Length / 1MB, 1)

Write-Host ""
Write-Host "  Build Complete!" -ForegroundColor Green
Write-Host "  ===============" -ForegroundColor Green
Write-Host ""
Write-Host "  File: $($installer.FullName)" -ForegroundColor White
Write-Host "  Size: $sizeMB MB" -ForegroundColor White

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
