param(
  [string]$Repo = "https://github.com/HPAINH/As-Sarir.git",
  [string]$Message = "Обновление игры"
)
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot
if (-not (Test-Path ".git")) {
  git init -b main
  git remote add origin $Repo
}
git add -A
git commit -m $Message
if ($LASTEXITCODE -ne 0) { Write-Host "Нет изменений для коммита" }
git push -u origin main
if ($LASTEXITCODE -ne 0) { throw "Не удалось отправить изменения" }
Write-Host "Готово: https://hpainh.github.io/As-Sarir/"
