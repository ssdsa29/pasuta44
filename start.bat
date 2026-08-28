@echo off
chcp 65001 >nul
title X タイムライン自動収集ツール
cd /d "%~dp0"

echo ======================================
echo  X タイムライン自動収集ツール
echo ======================================
echo.

REM --- Node.js の確認 ---
where node >nul 2>nul
if errorlevel 1 (
  echo [エラー] Node.js が見つかりません。
  echo https://nodejs.org/ja から LTS 版をインストールしてから、もう一度このファイルを実行してください。
  echo.
  pause
  exit /b 1
)

REM --- 初回のみ: 依存関係のインストール ---
if not exist "node_modules" (
  echo 初回セットアップ中です。数分かかる場合があります...
  call npm install
  if errorlevel 1 (
    echo [エラー] セットアップに失敗しました。インターネット接続を確認してください。
    pause
    exit /b 1
  )
)

REM --- 初回のみ: ブラウザのインストール ---
if not exist "%USERPROFILE%\AppData\Local\ms-playwright" (
  echo ブラウザをインストール中です...
  call npx playwright install chromium
)

REM --- アプリ起動(操作画面がブラウザで開きます) ---
echo 操作画面をブラウザで開いています...
echo.
node src\server.js

echo.
echo 終了しました。このウィンドウは閉じても大丈夫です。
pause
