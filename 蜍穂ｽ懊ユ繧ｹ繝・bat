@echo off
rem ドットパックをこのパソコンで動作テストするためのファイル（ダブルクリックで起動）
cd /d "%~dp0"
set PORT=8000

echo.
echo  ドットパック 動作テスト
echo  ----------------------------------------
echo   1 : テストデータを入れて試す（丸のカードが並んだ状態から。前の確認用データは消えます）
echo   2 : 確認モードを開く（前回の続きから）
echo   3 : 管理画面を開く（確認モード。ログインを押すと管理者として入れます）
echo   4 : 本物の Firebase につないで試す（本番のデータに書き込まれるので注意）
echo.
choice /c 1234 /n /m "番号を選んでください [1/2/3/4]: "
if errorlevel 4 (set OPEN=index.html?mock=0& goto run)
if errorlevel 3 (set OPEN=admin.html?mock& goto run)
if errorlevel 2 (set OPEN=index.html?mock& goto run)
set OPEN=tools/testdata.html

:run
echo.
echo  ブラウザで http://localhost:%PORT%/%OPEN% を開きます。
echo  終わるときは、この黒い画面を閉じてください。
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\serve.ps1" -Port %PORT% -Open "%OPEN%"
pause
