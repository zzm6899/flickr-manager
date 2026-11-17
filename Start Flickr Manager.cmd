@echo off
setlocal
title Flickr Manager
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-flickr.ps1"
set "launchResult=%errorlevel%"
if not "%launchResult%"=="0" pause
exit /b %launchResult%
