@echo off
chcp 65001 >nul
title WhatsApp do SAC
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Instale o Node.js (versao 20 ou mais) em https://nodejs.org e abra este arquivo de novo.
  pause
  exit /b 1
)
if not exist node_modules (
  echo Preparando o programa pela primeira vez...
  call npm install --omit=dev
)
if not exist origens.txt (
  echo.
  echo Digite o endereco do sistema Jarvis, como aparece no navegador. Exemplo: https://meu-sistema.com.br
  set /p ORIGEM=Endereco: 
  call :salvar
)
set /p WA_ORIGENS=<origens.txt
set PORT=3939
echo.
echo WhatsApp do SAC ligado neste computador. Deixe esta janela aberta.
echo No Jarvis: Feedback de Faltas - Visao geral - Conectar pelo QR code.
echo.
node server.js
pause
exit /b 0
:salvar
>origens.txt echo %ORIGEM%
exit /b 0
