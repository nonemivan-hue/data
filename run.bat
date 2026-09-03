@echo off
chcp 65001 > nul
echo Запуск чтения карты через ACR1281U...
python acr1281_dump.py
pause
