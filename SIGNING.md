# Code Signing Setup Guide
# GRC Assessment Platform

Digital signing removes the Windows SmartScreen warning and shows
your organization's name in the installer's security dialog.

────────────────────────────────────────────────────────────────
## OPTION A — OV Certificate (.pfx file)
   Cost: ~$200-400/yr | SmartScreen: passes after ~100-500 installs
────────────────────────────────────────────────────────────────

### Step 1 — Buy the certificate
Go to one of these Certificate Authorities and buy an
"OV Code Signing Certificate":

  DigiCert:  https://www.digicert.com/signing/code-signing-certificates
  Sectigo:   https://sectigo.com/ssl-certificates-tls/code-signing
  SSL.com:   https://www.ssl.com/certificates/code-signing/

During purchase they will ask you to prove your organization's
identity (business registration, phone call, etc). This usually
takes 1-3 business days.

### Step 2 — Export the .pfx file
After the CA validates your identity, they will provide the
certificate. Export it as a .pfx file with a strong password.

In the CA's portal there is usually an "Export" or "Download"
button. Choose "PFX / PKCS#12" format and set a password.

### Step 3 — Convert to base64 (for GitHub Actions)
Open PowerShell and run:

  $bytes = [IO.File]::ReadAllBytes("C:\path\to\cert.pfx")
  [Convert]::ToBase64String($bytes) | Set-Clipboard

This copies the base64 string to your clipboard.

### Step 4 — Add GitHub Secrets
Go to: GitHub repo → Settings → Secrets and variables → Actions

Add these Repository Secrets:
  WIN_CERT_BASE64    paste the base64 string from Step 3
  WIN_CERT_PASSWORD  the .pfx password you set

Add this Repository Variable (not Secret):
  SIGNING_METHOD     pfx

### Step 5 — Build
Push a tag or run the workflow manually:
  git tag v1.0.0 && git push origin v1.0.0

The workflow will decode the cert, sign the installer, verify
the signature, and upload the signed .exe.

### Local signing (optional)
To sign locally instead of in CI:
  .\scripts\build.ps1 -CertPath "C:\cert.pfx" -CertPassword "yourpassword"


────────────────────────────────────────────────────────────────
## OPTION B — EV Certificate via Azure Trusted Signing
   Cost: ~$10/mo | SmartScreen: INSTANT trust from first install
────────────────────────────────────────────────────────────────

This is the best option for public distribution. EV certificates
get immediate SmartScreen reputation — no "More info" needed.

### Step 1 — Set up Azure Trusted Signing
1. Go to portal.azure.com → search "Trusted Signing"
2. Create a Trusted Signing Account
   - Choose a region (e.g. West US 3)
   - Note the Endpoint URL (e.g. https://wus3.codesigning.azure.net)
3. Inside the account, create a Certificate Profile
   - Type: Public Trust (for software distributed publicly)
   - Note the profile name

Microsoft will validate your organization (similar to OV process).

### Step 2 — Create an App Registration in Azure AD
1. Azure portal → Azure Active Directory → App registrations
2. New registration → name it "GRC Platform CI Signing"
3. Note the Application (client) ID and Directory (tenant) ID
4. Go to Certificates & secrets → New client secret
5. Note the secret value (shown once)

### Step 3 — Assign the signing role
1. Go to your Trusted Signing Account in Azure portal
2. Access control (IAM) → Add role assignment
3. Role: "Trusted Signing Certificate Profile Signer"
4. Assign to: the App Registration from Step 2

### Step 4 — Add GitHub Secrets
Go to: GitHub repo → Settings → Secrets and variables → Actions

Add these Repository Secrets:
  AZURE_TENANT_ID          Directory (tenant) ID from Step 2
  AZURE_CLIENT_ID          Application (client) ID from Step 2
  AZURE_CLIENT_SECRET      Client secret value from Step 2
  AZURE_ENDPOINT           Endpoint URL from Step 1
  AZURE_CODE_SIGNING_NAME  Trusted Signing account name
  AZURE_CERT_PROFILE_NAME  Certificate profile name

Add this Repository Variable:
  SIGNING_METHOD            azure-ev

### Step 5 — Build
  git tag v1.0.0 && git push origin v1.0.0

The workflow builds the installer, signs it via Azure (no .pfx
file ever stored in GitHub), verifies the signature, and publishes.


────────────────────────────────────────────────────────────────
## OPTION C — No signing (development / internal use only)
────────────────────────────────────────────────────────────────

Leave SIGNING_METHOD unset or set it to: none

Users will see the SmartScreen "Windows protected your PC" warning.
They can click "More info" then "Run anyway" to install.

This is fine for internal tools where you distribute directly to
known users who expect it.


────────────────────────────────────────────────────────────────
## What signing does to the installer dialog
────────────────────────────────────────────────────────────────

Unsigned:
  Windows protected your PC
  Windows SmartScreen prevented an unrecognized app from starting.
  [More info]    [Don't run]

OV Signed (before reputation builds):
  Same warning but shows: "GRC Assessment Platform | Publisher: Your Org"
  After ~100-500 installs: no warning at all

EV Signed (immediate):
  Standard UAC prompt only:
  "Do you want to allow this app to make changes to your device?
   Publisher: Your Org (verified)"
  No SmartScreen warning at all, from the very first install


────────────────────────────────────────────────────────────────
## Timestamp server (already configured)
────────────────────────────────────────────────────────────────

The build config uses DigiCert's RFC3161 timestamp server:
  http://timestamp.digicert.com

This embeds a trusted timestamp in the signature so the installer
remains valid even after your certificate expires. Do not skip this.


────────────────────────────────────────────────────────────────
## Checking a signature
────────────────────────────────────────────────────────────────

In PowerShell:
  Get-AuthenticodeSignature "GRC-Assessment-Platform-Setup-1.0.0.exe"

Or right-click the .exe → Properties → Digital Signatures tab.

Expected result: Status = Valid, Signer = your organization name.
