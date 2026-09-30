; Capture this at include time. Inside a hook macro, ${__FILEDIR__} points at
; Tauri's generated NSIS directory rather than this source directory.
!define DRIFTY_NSIS_HOOK_DIR "${__FILEDIR__}"
!define DRIFTY_VC_REDIST_X64_KEY "SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes\x64"
!define DRIFTY_VC_REDIST_MAJOR 14
!define DRIFTY_VC_REDIST_MINOR 51
!define DRIFTY_VC_REDIST_BLD 36247
!define DRIFTY_VC_REDIST_RBLD 0

!macro NSIS_HOOK_PREINSTALL
  ; Drifty's native updater stops the app and tracker before launching /UPDATE.
  ; A second forced kill here can interrupt database cleanup.
  StrCmp $UpdateMode "1" drifty_processes_stopped
  ; Interactive/manual installation may replace a still-running app.
  nsExec::Exec 'taskkill /F /IM drifty.exe'
  nsExec::Exec 'taskkill /F /IM drifty-tracker.exe'
  drifty_processes_stopped:

  ; The downloaded managed-AI runtime links the Microsoft VC++ runtime. Keep
  ; Drifty itself per-user, but install this machine prerequisite centrally so
  ; a clean Windows 10/11 machine can actually launch llama-server.exe.
  SetRegView 64
  StrCpy $2 0

  drifty_vcredist_check_installed:
  ReadRegDWord $0 HKLM "${DRIFTY_VC_REDIST_X64_KEY}" "Installed"
  StrCmp $0 1 drifty_vcredist_check_major drifty_vcredist_missing

  drifty_vcredist_check_major:
  ReadRegDWord $0 HKLM "${DRIFTY_VC_REDIST_X64_KEY}" "Major"
  IntCmp $0 ${DRIFTY_VC_REDIST_MAJOR} drifty_vcredist_check_minor drifty_vcredist_missing drifty_vcredist_ready

  drifty_vcredist_check_minor:
  ReadRegDWord $0 HKLM "${DRIFTY_VC_REDIST_X64_KEY}" "Minor"
  IntCmp $0 ${DRIFTY_VC_REDIST_MINOR} drifty_vcredist_check_bld drifty_vcredist_missing drifty_vcredist_ready

  drifty_vcredist_check_bld:
  ReadRegDWord $0 HKLM "${DRIFTY_VC_REDIST_X64_KEY}" "Bld"
  IntCmp $0 ${DRIFTY_VC_REDIST_BLD} drifty_vcredist_check_rbld drifty_vcredist_missing drifty_vcredist_ready

  drifty_vcredist_check_rbld:
  ReadRegDWord $0 HKLM "${DRIFTY_VC_REDIST_X64_KEY}" "Rbld"
  IntCmp $0 ${DRIFTY_VC_REDIST_RBLD} drifty_vcredist_ready drifty_vcredist_missing drifty_vcredist_ready

  drifty_vcredist_missing:
  StrCmp $2 1 drifty_vcredist_failed 0
  StrCpy $2 1
  DetailPrint "Installing Microsoft Visual C++ Redistributable (x64)..."
  InitPluginsDir
  SetOutPath "$PLUGINSDIR"
  File /oname=vc_redist.x64.exe "${DRIFTY_NSIS_HOOK_DIR}\generated\vc_redist.x64.exe"
  ClearErrors
  ExecWait '"$PLUGINSDIR\vc_redist.x64.exe" /install /quiet /norestart /log "$TEMP\drifty-vc-redist.log"' $1
  IfErrors drifty_vcredist_failed
  StrCmp $1 3010 0 drifty_vcredist_check_installed
  SetRebootFlag true
  Goto drifty_vcredist_check_installed

  drifty_vcredist_ready:
  ; $PLUGINSDIR is only initialized when this installer extracted the runtime.
  ; Do not form a root-relative cleanup path on machines that already satisfy
  ; the prerequisite.
  StrCmp $2 1 0 drifty_vcredist_restore_outpath
  Delete "$PLUGINSDIR\vc_redist.x64.exe"
  drifty_vcredist_restore_outpath:
  SetOutPath "$INSTDIR"
  Goto drifty_vcredist_done

  drifty_vcredist_failed:
  Delete "$PLUGINSDIR\vc_redist.x64.exe"
  IfSilent drifty_vcredist_abort 0
  MessageBox MB_ICONSTOP "Microsoft Visual C++ Redistributable (x64) is required for Drifty. Its installation was cancelled or failed, so Drifty was not installed."
  drifty_vcredist_abort:
  Abort

  drifty_vcredist_done:
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  ReadRegStr $1 HKCU "Software\Mozilla\NativeMessagingHosts\so.drifty.browser_bridge" ""
  StrCmp $1 "$INSTDIR\browser-bridge\so.drifty.browser_bridge.firefox.json" drifty_browser_bridge_cleanup_owned drifty_browser_bridge_cleanup_done
  drifty_browser_bridge_cleanup_owned:
  DeleteRegKey HKCU "Software\Mozilla\NativeMessagingHosts\so.drifty.browser_bridge"
  drifty_browser_bridge_cleanup_done:
  DeleteRegKey HKCU "Software\so.drifty.windows\UninstallState"
  StrCmp $UpdateMode "1" drifty_startup_cleanup_done 0
  ReadRegStr $0 HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "drifty"
  StrCmp $0 "$\"$INSTDIR\drifty.exe$\" --background" drifty_startup_cleanup_owned 0
  StrCmp $0 "" drifty_startup_cleanup_done 0
  WriteRegStr HKCU "Software\so.drifty.windows\UninstallState" "ForeignRunCommand" $0
  Goto drifty_startup_cleanup_done
  drifty_startup_cleanup_owned:
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "drifty"
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run" "drifty"
  drifty_startup_cleanup_done:
!macroend

!macro NSIS_HOOK_POSTINSTALL
  ; Keep browser authentication callbacks bound to the per-user installed app.
  ; A prior portable or development build may have registered its disposable
  ; source path, which otherwise leaves drifty:// pointing at deleted bytes.
  WriteRegStr HKCU "Software\Classes\drifty" "" "URL:so.drifty.windows protocol"
  WriteRegStr HKCU "Software\Classes\drifty" "URL Protocol" ""
  WriteRegStr HKCU "Software\Classes\drifty\DefaultIcon" "" "$\"$LOCALAPPDATA\drifty\drifty.exe$\",0"
  WriteRegStr HKCU "Software\Classes\drifty\shell\open\command" "" "$\"$LOCALAPPDATA\drifty\drifty.exe$\" $\"%1$\""

  WriteRegStr HKCU "Software\Mozilla\NativeMessagingHosts\so.drifty.browser_bridge" "" "$INSTDIR\browser-bridge\so.drifty.browser_bridge.firefox.json"

  ; Tauri has already created the shortcuts before this hook runs. Recreate
  ; only the shortcuts the user selected. Use the current shell user's local
  ; app-data directory explicitly: the generated installer can retain a
  ; build-account value in $INSTDIR even though a current-user install writes
  ; the payload below the interactive user's LocalAppData directory.
  IfFileExists "$SMPROGRAMS\drifty.lnk" 0 drifty_start_menu_shortcut_done
  Delete "$SMPROGRAMS\drifty.lnk"
  CreateShortCut "$SMPROGRAMS\drifty.lnk" "$LOCALAPPDATA\drifty\drifty.exe"
  drifty_start_menu_shortcut_done:

  IfFileExists "$DESKTOP\drifty.lnk" 0 drifty_desktop_shortcut_done
  Delete "$DESKTOP\drifty.lnk"
  CreateShortCut "$DESKTOP\drifty.lnk" "$LOCALAPPDATA\drifty\drifty.exe"
  drifty_desktop_shortcut_done:
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  ; The tracker bundle is materialized at runtime, so NSIS does not know the
  ; individual files from its install log. It is executable payload owned by
  ; this install directory, not user data, and must not survive uninstall.
  RMDir /r "$INSTDIR\drifty-tracker"
  StrCmp $UpdateMode "1" drifty_startup_restore_done 0
  ReadRegStr $0 HKCU "Software\so.drifty.windows\UninstallState" "ForeignRunCommand"
  StrCmp $0 "" drifty_startup_restore_done 0
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "drifty" $0
  DeleteRegValue HKCU "Software\so.drifty.windows\UninstallState" "ForeignRunCommand"
  DeleteRegKey /ifempty HKCU "Software\so.drifty.windows\UninstallState"
  drifty_startup_restore_done:
!macroend
