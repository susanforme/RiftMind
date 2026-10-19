; Runtime downloads must be writable without elevating the application.
; Used by both the directory page and the silent install path.
!include LogicLib.nsh
!include FileFunc.nsh
!define MUI_DIRECTORYPAGE_VERIFYONLEAVE
!define MUI_DIRECTORYPAGE_TEXT_TOP "请选择当前用户可写的独立空目录。已有 RiftMind 安装目录可用于升级，assets 资源将保留。 / Choose a dedicated empty writable folder. Existing RiftMind installations may be upgraded while keeping assets."

Function RiftMindCheckDirectory
  StrCpy $R9 ""
  System::Call 'kernel32::GetFullPathNameW(w "$INSTDIR", i ${NSIS_MAX_STRLEN}, w .r0, p 0) i.r1'
  ${If} $1 == 0
  ${OrIf} $1 >= ${NSIS_MAX_STRLEN}
    StrCpy $R9 "Invalid installation directory"
    Return
  ${EndIf}
  StrCpy $INSTDIR $0
  ${GetRoot} "$INSTDIR" $R0
  ${If} "$INSTDIR" == "$R0\"
  ${OrIf} "$INSTDIR" == "$R0"
  ${OrIf} "$INSTDIR" == "$PROFILE"
  ${OrIf} "$INSTDIR" == "$DESKTOP"
  ${OrIf} "$INSTDIR" == "$DOCUMENTS"
  ${OrIf} "$INSTDIR" == "$LOCALAPPDATA"
  ${OrIf} "$INSTDIR" == "$APPDATA"
    StrCpy $R9 "Choose a dedicated empty RiftMind folder. / 请选择独立的空目录。"
    Return
  ${EndIf}
  ; Check protected roots even when the installer was launched elevated.
  StrCpy $R0 $INSTDIR
  StrLen $R1 "$PROGRAMFILES"
  StrCpy $R2 $R0 $R1
  ${If} $R2 == "$PROGRAMFILES"
    StrCpy $R9 "Program Files is read-only for this app. Choose a user-writable folder. / 请选择当前用户可写的目录。"
    Return
  ${EndIf}
  StrLen $R1 "$PROGRAMFILES64"
  StrCpy $R2 $R0 $R1
  ${If} $R2 == "$PROGRAMFILES64"
    StrCpy $R9 "Choose a user-writable folder outside Program Files. / 请选择 Program Files 之外的可写目录。"
    Return
  ${EndIf}
  StrLen $R1 "$WINDIR"
  StrCpy $R2 $R0 $R1
  ${If} $R2 == "$WINDIR"
    StrCpy $R9 "Choose a user-writable folder outside Windows. / 请选择 Windows 之外的可写目录。"
    Return
  ${EndIf}
  System::Call 'kernel32::GetFileAttributesW(w "$INSTDIR") i.r0'
  ${If} $0 != -1
    IntOp $0 $0 & 0x400
    ${If} $0 <> 0
      StrCpy $R9 "The installation directory must not be a link. / 安装目录不能是链接或联接点。"
      Return
    ${EndIf}
  ${EndIf}
  System::Call 'kernel32::GetFileAttributesW(w "$INSTDIR\assets") i.r0'
  ${If} $0 != -1
    IntOp $0 $0 & 0x400
    ${If} $0 <> 0
      StrCpy $R9 "The assets directory must not be a link. / 资源目录不能是链接或联接点。"
      Return
    ${EndIf}
  ${EndIf}

  ; Only an identified previous installation may use a non-empty directory.
  StrCpy $R5 0
  ClearErrors
  FileOpen $R0 "$INSTDIR\.riftmind-install" r
  ${IfNot} ${Errors}
    FileRead $R0 $R1
    FileClose $R0
    ${If} $R1 == "com.springbreeze.riftmind"
      StrCpy $R5 1
    ${EndIf}
  ${EndIf}
  ReadRegStr $R0 HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\riftmind" "InstallLocation"
  ${If} $R0 == '$\"$INSTDIR$\"'
  ${AndIf} ${FileExists} "$INSTDIR\riftmind.exe"
  ${AndIf} ${FileExists} "$INSTDIR\uninstall.exe"
    StrCpy $R5 1
  ${EndIf}
  FindFirst $R0 $R1 "$INSTDIR\*.*"
  loop_directory:
    ${If} $R1 == ""
      Goto directory_checked
    ${EndIf}
    ${If} $R1 != "."
    ${AndIf} $R1 != ".."
      ${If} $R5 != 1
        StrCpy $R9 "New installations require a dedicated empty folder. / 新安装必须选择独立空目录。"
        Goto directory_checked
      ${EndIf}
      ${If} $R1 != "riftmind.exe"
      ${AndIf} $R1 != "uninstall.exe"
      ${AndIf} $R1 != ".riftmind-install"
      ${AndIf} $R1 != "assets"
        StrCpy $R9 "This folder contains unrelated files. Choose a dedicated empty folder. / 此目录含其他文件，请选择独立空目录。"
        Goto directory_checked
      ${EndIf}
    ${EndIf}
    FindNext $R0 $R1
    Goto loop_directory
  directory_checked:
    FindClose $R0
FunctionEnd

Function .onVerifyInstDir
  Call RiftMindCheckDirectory
  ${If} $R9 != ""
    IfSilent +2
      MessageBox MB_OK|MB_ICONSTOP "$R9"
    SetErrorLevel 2
    Abort
  ${EndIf}
  ClearErrors
  SetErrorLevel 0
FunctionEnd

!macro NSIS_HOOK_PREINSTALL
  Call RiftMindCheckDirectory
  ${If} $R9 != ""
    IfSilent +2
      MessageBox MB_OK|MB_ICONSTOP "$R9"
    SetErrorLevel 2
    Abort "$R9"
  ${EndIf}
  ClearErrors
  CreateDirectory "$INSTDIR\assets"
  FileOpen $R0 "$INSTDIR\assets\.riftmind-write-test" w
  ${If} ${Errors}
    IfSilent +2
      MessageBox MB_OK|MB_ICONSTOP "Cannot write assets. Choose a user-writable installation folder. / 无法写入资源目录，请选择可写的安装目录。"
    SetErrorLevel 3
    Abort
  ${EndIf}
  FileWrite $R0 "riftmind"
  ${If} ${Errors}
    FileClose $R0
    SetErrorLevel 3
    Abort "Cannot write assets"
  ${EndIf}
  FileClose $R0
  Delete "$INSTDIR\assets\.riftmind-write-test"
  FileOpen $R0 "$INSTDIR\.riftmind-install" w
  ${If} ${Errors}
    SetErrorLevel 3
    Abort "Cannot write installation marker"
  ${EndIf}
  FileWrite $R0 "com.springbreeze.riftmind"
  FileClose $R0
  SetErrorLevel 0
!macroend

; Keep assets and the ownership marker during upgrades and normal uninstalls.
; The next installer can therefore recognize and reuse this application's files.
