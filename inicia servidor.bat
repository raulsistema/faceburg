@echo off
setlocal
cd /d "%~dp0"

if not exist ".next\standalone\server.js" (
  echo Build de producao nao encontrado. Gerando build...
  call npm run build
  if errorlevel 1 (
    echo Falha ao gerar build de producao.
    pause
    exit /b 1
  )
)

call npm start
if errorlevel 1 pause
