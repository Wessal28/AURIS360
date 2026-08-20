[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$stagingRef = 'beoutmqttgfyyzndcdxu'
$repoRoot = Split-Path -Parent $PSScriptRoot
$migrationDir = Join-Path $repoRoot 'supabase\migrations'
$baselineFile = Join-Path $migrationDir '20260820000000_production_schema_baseline.sql'
$dockerBin = Join-Path $env:LOCALAPPDATA 'Programs\DockerDesktop\resources\bin'
$dockerCli = Join-Path $dockerBin 'docker.exe'
$createdBaseline = $false

function ConvertFrom-SecureValue {
    param([Parameter(Mandatory)][Security.SecureString]$Value)
    $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Value)
    try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
}

if (-not (Test-Path -LiteralPath $dockerCli)) {
    throw "Docker CLI not found at $dockerCli. Start Docker Desktop before retrying."
}
if (Test-Path -LiteralPath $baselineFile) {
    throw "Baseline already exists at $baselineFile. It will not be overwritten."
}

$env:Path = "$dockerBin;$env:Path"
& $dockerCli version --format '{{.Server.Version}}'
if ($LASTEXITCODE -ne 0) { throw 'Docker engine is not available.' }

Write-Host ''
Write-Host 'STAGING schema baseline capture' -ForegroundColor Cyan
Write-Host 'This reads schema metadata only. It does not export table rows or Auth users.'
$template = Read-Host 'Paste the STAGING Session pooler URI containing [YOUR-PASSWORD]'
if ($template -notmatch [regex]::Escape($stagingRef)) {
    throw "URI does not contain the approved staging project reference $stagingRef."
}
if ($template -notmatch '^postgres(?:ql)?://' -or -not $template.Contains('[YOUR-PASSWORD]')) {
    throw 'Use the PostgreSQL Session pooler URI and retain its [YOUR-PASSWORD] placeholder.'
}

$securePassword = Read-Host 'STAGING database password' -AsSecureString
$plainPassword = ConvertFrom-SecureValue -Value $securePassword
try {
    if ([string]::IsNullOrWhiteSpace($plainPassword)) { throw 'Database password is empty.' }
    $databaseUrl = $template.Replace('[YOUR-PASSWORD]', [Uri]::EscapeDataString($plainPassword))
}
finally {
    $plainPassword = $null
    $securePassword.Dispose()
}
if ($databaseUrl -notmatch '(?:\?|&)sslmode=') {
    $databaseUrl += $(if ($databaseUrl.Contains('?')) { '&sslmode=require' } else { '?sslmode=require' })
}

try {
    $companySafetyQuery = "select count(*) from public.companies where coalesce(name, '') <> 'AURIS360 Staging Test';"
    $companyOutput = & $dockerCli run --rm postgres:17-alpine psql --dbname $databaseUrl --tuples-only --no-align --command $companySafetyQuery
    if ($LASTEXITCODE -ne 0) { throw 'Could not verify the staging tenant boundary.' }
    $nonStagingCompanies = 0
    if (-not [int]::TryParse(($companyOutput | Select-Object -Last 1).Trim(), [ref]$nonStagingCompanies)) {
        throw 'Could not interpret the staging tenant boundary result.'
    }
    if ($nonStagingCompanies -ne 0) {
        throw "Safety stop: staging contains $nonStagingCompanies non-test company record(s)."
    }

    Write-Host ''
    Write-Host "Target confirmed: isolated staging project $stagingRef" -ForegroundColor Yellow
    $confirmation = Read-Host "Type CAPTURE BASELINE FROM $stagingRef to continue"
    if ($confirmation -cne "CAPTURE BASELINE FROM $stagingRef") { throw 'Confirmation did not match.' }

    New-Item -ItemType Directory -Path $migrationDir -Force | Out-Null
    $dockerMigrationDir = $migrationDir.Replace('\', '/')
    & $dockerCli run --rm `
        --mount "type=bind,source=$dockerMigrationDir,target=/migrations" `
        postgres:17-alpine `
        pg_dump --dbname $databaseUrl --schema-only --no-owner --no-privileges --schema public `
        --file /migrations/20260820000000_production_schema_baseline.sql
    if ($LASTEXITCODE -ne 0) { throw 'Schema-only baseline export failed.' }
    $createdBaseline = $true

    if (-not (Test-Path -LiteralPath $baselineFile) -or (Get-Item -LiteralPath $baselineFile).Length -lt 10000) {
        throw 'Generated baseline is empty or unexpectedly small.'
    }

    & node (Join-Path $PSScriptRoot 'validate-migrations.cjs') --write-manifest
    if ($LASTEXITCODE -ne 0) { throw 'Generated migration baseline failed validation.' }

    $hash = (Get-FileHash -LiteralPath $baselineFile -Algorithm SHA256).Hash
    Write-Host ''
    Write-Host 'Staging schema baseline captured and validated.' -ForegroundColor Green
    Write-Host "SHA-256: $hash"
    Write-Host 'No table rows, passwords, or Auth users were written to the repository.' -ForegroundColor Green
}
catch {
    if ($createdBaseline -and (Test-Path -LiteralPath $baselineFile)) {
        Remove-Item -LiteralPath $baselineFile -Force
    }
    throw
}
finally { $databaseUrl = $null }
