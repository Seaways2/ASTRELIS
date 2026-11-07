!include "nsDialogs.nsh"
Var DataPath
!ifndef BUILD_UNINSTALLER
Var DataInput
Var DataDialog
!endif

!macro customPageAfterChangeDir
  Page custom DataPage DataPageLeave
!macroend

!ifndef BUILD_UNINSTALLER
Function DataPage
  Call instFilesPre
  ReadRegStr $DataPath HKCU "Software\ASTRELIS\Data" "Path"
  ${If} $DataPath == ""
    StrCpy $DataPath "$INSTDIR\UserData"
  ${EndIf}
  nsDialogs::Create 1018
  Pop $DataDialog
  ${NSD_CreateLabel} 0 0 100% 64u "UserData 用于保存设置、音乐库、封面、音频缓存、登录记录和插件参数。可放在其他磁盘以节省系统盘空间；只有 C 盘也可正常使用。请选择可写的专用文件夹，升级会保留已有数据。"
  Pop $0
  ${NSD_CreateDirRequest} 0 72u 78% 14u "$DataPath"
  Pop $DataInput
  ${NSD_CreateBrowseButton} 80% 72u 20% 14u "浏览…"
  Pop $0
  ${NSD_OnClick} $0 BrowseData
  nsDialogs::Show
FunctionEnd
Function BrowseData
  Pop $0
  nsDialogs::SelectFolderDialog "选择空目录或已有 ASTRELIS UserData" "$DataPath"
  Pop $0
  ${If} $0 != "error"
    ${NSD_SetText} $DataInput $0
  ${EndIf}
FunctionEnd
Function DataPageLeave
  ${NSD_GetText} $DataInput $DataPath
  InitPluginsDir
  SetOutPath "$PLUGINSDIR"
  File /oname=data-lifecycle.ps1 "${BUILD_RESOURCES_DIR}\data-lifecycle.ps1"
  nsExec::ExecToStack '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\data-lifecycle.ps1" -Action Prepare -Target "$DataPath"'
  Pop $0
  Pop $1
  ${If} $0 != 0
    MessageBox MB_ICONSTOP "数据目录不可用，请选择可写的空目录或已有 ASTRELIS UserData 目录。$\r$\n$1"
    Abort
  ${EndIf}
FunctionEnd
!endif

!macro customInstall
  ${If} $DataPath == ""
    ReadRegStr $DataPath HKCU "Software\ASTRELIS\Data" "Path"
    ${If} $DataPath == ""
      StrCpy $DataPath "$INSTDIR\UserData"
    ${EndIf}
  ${EndIf}
  ; Revalidate after application extraction, for both interactive and silent installs.
  Call DataPageLeaveSilent
  IfFileExists "$DataPath\.astrelis-owner" dataReady
    SetErrorLevel 2
    Abort "用户数据目录初始化失败，请重新选择可写的空目录或已有 ASTRELIS UserData 目录。"
  dataReady:
  ClearErrors
  FileOpen $0 "$INSTDIR\astrelis-data.ini" w
  FileWriteUTF16LE /BOM $0 "[UserData]$\r$\nPath=$DataPath$\r$\n"
  FileClose $0
  ${If} ${Errors}
    SetErrorLevel 2
    Abort "无法保存用户数据目录配置。"
  ${EndIf}
  WriteRegStr HKCU "Software\ASTRELIS\Data" "Path" "$DataPath"
  nsExec::ExecToStack '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$INSTDIR\resources\localize-install.ps1" -Executable "$INSTDIR\ASTRELIS.exe"'
  Pop $0
  Pop $1
  ${If} $0 != 0
    DetailPrint "Display-name update failed: $1"
  ${EndIf}
!macroend

!ifndef BUILD_UNINSTALLER
Function DataPageLeaveSilent
  nsExec::ExecToStack '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$INSTDIR\resources\data-lifecycle.ps1" -Action Prepare -Target "$DataPath"'
  Pop $0
  Pop $1
  ${If} $0 != 0
    SetErrorLevel 2
    Abort "$1"
  ${EndIf}
FunctionEnd
!endif

!macro customUnInstall
  ReadINIStr $DataPath "$INSTDIR\astrelis-data.ini" "UserData" "Path"
  InitPluginsDir
  CopyFiles /SILENT "$INSTDIR\resources\data-lifecycle.ps1" "$PLUGINSDIR\data-lifecycle.ps1"
  CopyFiles /SILENT "$INSTDIR\resources\installed-files.json" "$PLUGINSDIR\installed-files.json"
  ${IfNot} ${isUpdated}
  ${AndIfNot} ${Silent}
    MessageBox MB_YESNO|MB_DEFBUTTON2 "是否同时清除 ASTRELIS 用户数据？$\r$\n$DataPath\Profile$\r$\n包含设置、音乐库记录、封面缓存、登录记录和插件参数。不会删除外部音乐和 VST。$\r$\n选择“否”保留数据。" IDNO preserveData
    nsExec::ExecToStack '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\data-lifecycle.ps1" -Action RemoveData -Target "$DataPath"'
    Pop $0
    Pop $1
    ${If} $0 != 0
      MessageBox MB_ICONSTOP "清理未完成，数据已保留：$\r$\n$1"
    ${Else}
      DeleteRegKey HKCU "Software\ASTRELIS\Data"
    ${EndIf}
    preserveData:
  ${EndIf}
!macroend

!macro customRemoveFiles
  SetOutPath "$TEMP"
  nsExec::ExecToStack '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\data-lifecycle.ps1" -Action RemoveProgram -Target "$INSTDIR" -Manifest "$PLUGINSDIR\installed-files.json"'
  Pop $0
  Pop $1
  ${If} $0 != 0
    Abort "无法安全移除程序文件：$1"
  ${EndIf}
  Delete "$INSTDIR\Uninstall ASTRELIS.exe"
  ; Keep the data-location INI for reinstall and preserve all non-program files.
!macroend
