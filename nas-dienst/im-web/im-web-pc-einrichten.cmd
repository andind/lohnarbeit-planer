@echo off
rem im-web v1.0 - Notbetrieb am PC: http://localhost:8788 wird an das NAS weitergeleitet.
rem Einmalig mit Rechtsklick "Als Administrator ausfuehren" starten.
net session >/dev/null 2>&1
if errorlevel 1 (
  echo Bitte mit Rechtsklick "Als Administrator ausfuehren" starten.
  pause
  exit /b 1
)
echo im-web v1.0 - Weiterleitung localhost:8788 zum NAS einrichten
echo.
set /p NAS=IP-Adresse des NAS (z.B. 192.168.1.20): 
if "%NAS%"=="" exit /b 1
netsh interface portproxy delete v4tov4 listenport=8788 listenaddress=127.0.0.1 >/dev/null 2>&1
netsh interface portproxy add v4tov4 listenport=8788 listenaddress=127.0.0.1 connectport=8788 connectaddress=%NAS%
if errorlevel 1 (
  echo Einrichten fehlgeschlagen.
  pause
  exit /b 1
)
netsh interface portproxy show v4tov4
echo.
echo Fertig. Test im Browser: http://localhost:8788/nas-stand.json
start "" http://localhost:8788/nas-stand.json
pause
