; ── GRC Assessment Platform — Custom NSIS installer script ──────
; Included by electron-builder into the generated installer

; Welcome page text
!define MUI_WELCOMEPAGE_TITLE "Welcome to GRC Assessment Platform"
!define MUI_WELCOMEPAGE_TEXT "This wizard will install GRC Assessment Platform on your computer.$\r$\n$\r$\nGRC Assessment Platform is a self-contained compliance assessment tool supporting:$\r$\n  • ISO 27001:2022$\r$\n  • FedRAMP Moderate$\r$\n  • SOC 2$\r$\n  • NIST CSF 2.0$\r$\n  • PCI DSS v4.0$\r$\n  • HIPAA Security Rule$\r$\n  • FISMA High$\r$\n  • FISMA Moderate$\r$\n$\r$\nAll data is stored locally on your machine. No internet connection is required for normal use.$\r$\n$\r$\nClick Next to continue."

; Finish page
!define MUI_FINISHPAGE_TITLE "Installation Complete"
!define MUI_FINISHPAGE_TEXT "GRC Assessment Platform has been installed successfully.$\r$\n$\r$\nYour assessment database will be created at:$\r$\n%APPDATA%\GRC Assessment Platform\grc_assessments.db$\r$\n$\r$\nTo enable AI-powered control assessment, open Settings after launch and enter your Anthropic API key."
!define MUI_FINISHPAGE_RUN "$INSTDIR\GRC Assessment Platform.exe"
!define MUI_FINISHPAGE_RUN_TEXT "Launch GRC Assessment Platform"
!define MUI_FINISHPAGE_SHOWREADME ""
!define MUI_FINISHPAGE_SHOWREADME_NOTCHECKED
