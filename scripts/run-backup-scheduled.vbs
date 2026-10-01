Option Explicit
' A GUI host keeps the scheduled runner independent of an interactive console.
' Wait for its exit code; never detach the runner or expose private config values.
Dim shell, files, runner, config, powershell, command, count
count = WScript.Arguments.Count
If count < 1 Or count > 2 Then WScript.Quit 64
Set shell = CreateObject("WScript.Shell")
Set files = CreateObject("Scripting.FileSystemObject")
runner = WScript.Arguments(0)
If Not SafeFile(runner, ".ps1") Then WScript.Quit 64
powershell = files.BuildPath(shell.ExpandEnvironmentStrings("%SystemRoot%"), "System32\WindowsPowerShell\v1.0\powershell.exe")
command = Quote(powershell) & " -NoProfile -NonInteractive -ExecutionPolicy Bypass -File " & Quote(runner) & " -Scheduled"
If count = 2 Then
  config = WScript.Arguments(1)
  If Not SafeFile(config, ".json") Then WScript.Quit 64
  command = command & " -OperationsConfig " & Quote(config)
End If
WScript.Quit shell.Run(command, 0, True)

Function SafeFile(path, suffix)
  SafeFile = False
  If InStr(path, Chr(34)) > 0 Or InStr(path, vbCr) > 0 Or InStr(path, vbLf) > 0 Then Exit Function
  If LCase(Right(path, Len(suffix))) <> suffix Then Exit Function
  If Len(files.GetDriveName(path)) = 0 Then Exit Function
  If StrComp(files.GetAbsolutePathName(path), path, vbTextCompare) <> 0 Then Exit Function
  SafeFile = files.FileExists(path)
End Function

Function Quote(value)
  Quote = Chr(34) & value & Chr(34)
End Function
