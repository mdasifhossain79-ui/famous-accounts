' Opens Famous Accounts in its own app window (no browser tabs, no black console window).
' Starts the server in the background first if it is not already running.
' The first time it runs it also puts a "Famous Accounts" icon on your Desktop.
Option Explicit
Dim sh, fso, dir, url, i, paths, p, exe, lnk, mark
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
dir = fso.GetParentFolderName(WScript.ScriptFullName)
url = "http://localhost:3003/"
sh.CurrentDirectory = dir

Function IsUp()
  Dim h
  On Error Resume Next
  Set h = CreateObject("MSXML2.ServerXMLHTTP.6.0")
  h.setTimeouts 1000, 1000, 1000, 1000
  h.open "GET", url, False
  h.send
  IsUp = (Err.Number = 0)
  If IsUp Then IsUp = (h.status = 200)
  Err.Clear
  On Error GoTo 0
End Function

' one-time Desktop icon
mark = dir & "\.desktop-icon-made"
If Not fso.FileExists(mark) Then
  On Error Resume Next
  Set lnk = sh.CreateShortcut(sh.SpecialFolders("Desktop") & "\Famous Accounts.lnk")
  lnk.TargetPath = "wscript.exe"
  lnk.Arguments = """" & dir & "\famous-accounts-app.vbs"""
  lnk.WorkingDirectory = dir
  lnk.IconLocation = dir & "\icon.ico"
  lnk.Description = "Famous Accounts"
  lnk.Save
  fso.CreateTextFile(mark, True).Close
  On Error GoTo 0
End If

If Not IsUp() Then
  sh.Run """" & dir & "\start-server-hidden.bat""", 0, False
  For i = 1 To 90
    WScript.Sleep 1000
    If IsUp() Then Exit For
  Next
  If Not IsUp() Then
    MsgBox "Famous Accounts could not start." & vbCrLf & vbCrLf & "Please check that Node.js is installed and MySQL is running." & vbCrLf & "Details are in the file server.log in the program folder.", 48, "Famous Accounts"
    WScript.Quit 1
  End If
End If

paths = Array( _
  sh.ExpandEnvironmentStrings("%ProgramFiles(x86)%") & "\Microsoft\Edge\Application\msedge.exe", _
  sh.ExpandEnvironmentStrings("%ProgramFiles%") & "\Microsoft\Edge\Application\msedge.exe", _
  sh.ExpandEnvironmentStrings("%ProgramFiles%") & "\Google\Chrome\Application\chrome.exe", _
  sh.ExpandEnvironmentStrings("%ProgramFiles(x86)%") & "\Google\Chrome\Application\chrome.exe", _
  sh.ExpandEnvironmentStrings("%LocalAppData%") & "\Google\Chrome\Application\chrome.exe")
exe = ""
For Each p In paths
  If fso.FileExists(p) Then exe = p : Exit For
Next
If exe <> "" Then
  sh.Run """" & exe & """ --app=" & url, 1, False
Else
  sh.Run url
End If
