@echo off
echo ========================================
echo   Hotmart Group Tracker - Iniciando
echo ========================================
echo.

:: Verificar se ngrok está instalado
where ngrok >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERRO] ngrok nao encontrado!
    echo.
    echo Baixe em: https://ngrok.com/download
    echo Extraia e coloque o ngrok.exe nesta pasta ou no PATH
    echo.
    pause
    exit /b 1
)

echo [1/2] Iniciando servidor na porta 3000...
start "Hotmart Tracker Server" cmd /k "npm start"

:: Aguardar servidor iniciar
timeout /t 3 /nobreak >nul

echo [2/2] Iniciando ngrok...
echo.
echo ========================================
echo   IMPORTANTE: Copie a URL do ngrok
echo   e use na Hotmart!
echo ========================================
echo.

ngrok http 3000
