@echo off
title 保连接设置 - 电脑永不睡眠，屏幕可正常变黑

:: ==================== 自动请求管理员权限 ====================
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo 需要管理员权限，正在请求提权...
    powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
    exit /b
)

echo ============================================
echo   保连接设置：整机永不睡眠，屏幕可正常关闭
echo ============================================
echo.

echo [1/2] 设置电源方案：睡眠/休眠 = 从不（屏幕保持原有设置）
powercfg /change standby-timeout-ac 0
powercfg /change standby-timeout-dc 0
powercfg /change hibernate-timeout-ac 0
powercfg /change hibernate-timeout-dc 0
echo      完成。

echo.
echo [2/2] 关闭网卡省电（防止网卡休眠断网）
powershell -NoProfile -Command "Get-NetAdapter | Where-Object Status -eq 'Up' | ForEach-Object { Disable-NetAdapterPowerManagement -Name $_.Name -ErrorAction SilentlyContinue; Write-Host ('  已关闭: ' + $_.Name) }"
echo      完成（如无输出表示无需处理）。

echo.
echo ============================================
echo   设置完成！
echo   - 屏幕仍会按原有设置自动变黑（不伤电脑）
echo   - 电脑将永不睡眠/休眠，连接保持不断
echo ============================================
pause
