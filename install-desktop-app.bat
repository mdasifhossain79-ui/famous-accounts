@echo off
setlocal
cd /d "%~dp0"
echo This puts a "Famous Accounts" icon on your Desktop. It opens the app in its own window, with no
echo browser tabs and no black console window, and starts the server by itself.
echo.
powershell -NoProfile -ExecutionPolicy Bypass -Command "$s=(New-Object -ComObject WScript.Shell).CreateShortcut([Environment]::GetFolderPath('Desktop')+'\Famous Accounts.lnk'); $s.TargetPath='wscript.exe'; $s.Arguments='\"%~dp0famous-accounts-app.vbs\"'; $s.WorkingDirectory='%~dp0'; $s.IconLocation='%~dp0icon.ico'; $s.Save()"
echo Desktop icon created.
echo.
choice /m "Also open Famous Accounts automatically when Windows starts"
if errorlevel 2 goto done
powershell -NoProfile -ExecutionPolicy Bypass -Command "$s=(New-Object -ComObject WScript.Shell).CreateShortcut([Environment]::GetFolderPath('Startup')+'\Famous Accounts.lnk'); $s.TargetPath='wscript.exe'; $s.Arguments='\"%~dp0famous-accounts-app.vbs\"'; $s.WorkingDirectory='%~dp0'; $s.IconLocation='%~dp0icon.ico'; $s.Save()"
echo Famous Accounts will now start with Windows. Delete "Famous Accounts" from the Startup folder to undo this.
:done
echo.
pause
