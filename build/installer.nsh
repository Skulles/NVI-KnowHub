; При in-place update electron-updater запускает NSIS до полного выхода процесса.
; Даём приложению время закрыться, затем — стандартная проверка/закрытие из electron-builder.
; getProcessInfo + pid нужны здесь: при !macrodef customCheckAppRunning
; allowOnlyOneInstallerInstance.nsh их больше не объявляет сам.
!include "getProcessInfo.nsh"
Var pid

!macro customCheckAppRunning
  ${if} ${isUpdated}
    DetailPrint "Waiting for ${PRODUCT_NAME} to exit before update..."
    Sleep 4000
  ${endIf}
  !insertmacro _CHECK_APP_RUNNING
!macroend
