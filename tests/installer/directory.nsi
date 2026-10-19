Unicode true
RequestExecutionLevel user
!include MUI2.nsh
!include "${__FILEDIR__}/../../src-tauri/installer/hooks.nsh"
Name "RiftMind directory validation test"
OutFile "${OUTPUT}"
InstallDir "$LOCALAPPDATA\riftmind-installer-test"
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"
Section
  !insertmacro NSIS_HOOK_PREINSTALL
SectionEnd
