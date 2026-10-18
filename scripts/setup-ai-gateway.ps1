# setup-ai-gateway.ps1
# Script para configurar a chave de API do Vercel AI Gateway no projeto ASP

$envFile = ".env"
$varName = "AI_GATEWAY_API_KEY"

Write-Host "--- Configuração do Vercel AI Gateway ---" -ForegroundColor Cyan

# 1. Solicita a chave de forma segura
$apiKey = Read-Host "Digite a sua AI_GATEWAY_API_KEY"

if ([string]::IsNullOrWhiteSpace($apiKey)) {
    Write-Error "A chave da API não pode estar vazia."
    exit 1
}

# 2. Salva no arquivo .env
try {
    $envContent = Get-Content $envFile -ErrorAction SilentlyContinue
    $updated = $false

    if ($envContent) {
        for ($i = 0; $i -lt $envContent.Count; $i++) {
            if ($envContent[$i] -match "^$varName=") {
                $envContent[$i] = "$varName=$apiKey"
                $updated = $true
                break
            }
        }
    }

    if (-not $updated) {
        $envContent += "$varName=$apiKey"
    }

    $envContent | Set-Content $envFile
    Write-Host "✓ Chave salva com sucesso em $envFile" -ForegroundColor Green
}
catch {
    Write-Error "Erro ao salvar no arquivo .env: $($_.Exception.Message)"
    exit 1
}

# 3. Garante que o .env esteja no .gitignore
try {
    $gitignoreFile = ".gitignore"
    if (Test-Path $gitignoreFile) {
        $gitignoreContent = Get-Content $gitignoreFile
        if ($gitignoreContent -notcontains $envFile) {
            Add-Content $gitignoreFile "`n$envFile"
            Write-Host "✓ $envFile adicionado ao .gitignore para segurança" -ForegroundColor Green
        }
    } else {
        New-Item $gitignoreFile -ItemType File
        Add-Content $gitignoreFile $envFile
        Write-Host "✓ Arquivo .gitignore criado e $envFile adicionado" -ForegroundColor Green
    }
}
catch {
    Write-Warning "Não foi possível atualizar o .gitignore automaticamente."
}

# 4. Define na sessão atual do PowerShell
[Environment]::SetEnvironmentVariable($varName, $apiKey, "User")
$env:$varName = $apiKey

Write-Host "`nConfiguração concluída!" -ForegroundColor Cyan
Write-Host "A chave foi definida para o usuário e salva no arquivo .env."
Write-Host "Lembre-se de reiniciar seu terminal ou IDE para que as alterações de ambiente façam efeito."
