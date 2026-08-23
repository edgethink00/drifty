!macro NSIS_HOOK_PREUNINSTALL
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

!macro NSIS_HOOK_POSTUNINSTALL
  StrCmp $UpdateMode "1" drifty_startup_restore_done 0
  ReadRegStr $0 HKCU "Software\so.drifty.windows\UninstallState" "ForeignRunCommand"
  StrCmp $0 "" drifty_startup_restore_done 0
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "drifty" $0
  DeleteRegValue HKCU "Software\so.drifty.windows\UninstallState" "ForeignRunCommand"
  DeleteRegKey /ifempty HKCU "Software\so.drifty.windows\UninstallState"
  drifty_startup_restore_done:
!macroend
