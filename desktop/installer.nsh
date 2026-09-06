!macro customInstall
  DetailPrint "GEREH prerequisite check started..."

  ; 1) Optional VC++ Redistributable installer (silent, non-blocking on failure)
  IfFileExists "$INSTDIR\resources\prereqs\vc_redist.x64.exe" 0 +6
  DetailPrint "Running vc_redist.x64.exe..."
  ExecWait '"$INSTDIR\resources\prereqs\vc_redist.x64.exe" /install /quiet /norestart' $0
  IntCmp $0 0 0 +2 0
  DetailPrint "vc_redist.x64.exe exited with code: $0 (continuing)"

  ; 2) Optional machine/USB driver installer (silent, non-blocking on failure)
  IfFileExists "$INSTDIR\resources\prereqs\driver-setup.exe" 0 +6
  DetailPrint "Running driver-setup.exe..."
  ExecWait '"$INSTDIR\resources\prereqs\driver-setup.exe" /quiet /norestart' $1
  IntCmp $1 0 0 +2 0
  DetailPrint "driver-setup.exe exited with code: $1 (continuing)"

  ; 3) Optional custom prerequisite script (you can customize install flow safely here)
  IfFileExists "$INSTDIR\resources\prereqs\install-prereqs.cmd" 0 +6
  DetailPrint "Running install-prereqs.cmd..."
  ExecWait '"$SYSDIR\cmd.exe" /c ""$INSTDIR\resources\prereqs\install-prereqs.cmd""' $2
  IntCmp $2 0 0 +2 0
  DetailPrint "install-prereqs.cmd exited with code: $2 (continuing)"

  DetailPrint "Prerequisite check completed."
!macroend
