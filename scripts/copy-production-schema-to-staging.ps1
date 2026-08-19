[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$productionRef = 'iarfxjhahzbhncsaohbg'
$stagingRef = 'beoutmqttgfyyzndcdxu'
$supabaseCli = Join-Path $env:TEMP 'auris360-supabase-cli\supabase.exe'
$dockerBin = Join-Path $env:LOCALAPPDATA 'Programs\DockerDesktop\resources\bin'
$dockerCli = Join-Path $dockerBin 'docker.exe'
$workDir = Join-Path $env:TEMP ("auris360-schema-transfer-{0}" -f (Get-Date -Format 'yyyyMMdd-HHmmss'))
$schemaFile = Join-Path $workDir 'public-schema.sql'

function ConvertFrom-SecureValue {
    param([Parameter(Mandatory)][Security.SecureString]$Value)

    $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Value)
    try {
        return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
    }
    finally {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
    }
}

function Read-DatabaseUrl {
    param(
        [Parameter(Mandatory)][string]$Label,
        [Parameter(Mandatory)][string]$ExpectedProjectRef
    )

    Write-Host ""
    Write-Host "$Label connection" -ForegroundColor Cyan
    $template = Read-Host 'Paste the Session pooler URI containing [YOUR-PASSWORD]'
    if ($template -notmatch [regex]::Escape($ExpectedProjectRef)) {
        throw "$Label URI does not contain the expected project reference $ExpectedProjectRef."
    }
    if ($template -notmatch '^postgres(?:ql)?://') {
        throw "$Label value is not a PostgreSQL URI."
    }
    if (-not $template.Contains('[YOUR-PASSWORD]')) {
        throw "$Label URI must retain the [YOUR-PASSWORD] placeholder. Do not paste a password into the visible prompt."
    }

    $securePassword = Read-Host "$Label database password" -AsSecureString
    $plainPassword = ConvertFrom-SecureValue -Value $securePassword
    try {
        if ([string]::IsNullOrWhiteSpace($plainPassword)) {
            throw "$Label database password is empty."
        }
        $url = $template.Replace('[YOUR-PASSWORD]', [Uri]::EscapeDataString($plainPassword))
    }
    finally {
        $plainPassword = $null
        $securePassword.Dispose()
    }

    if ($url -notmatch '(?:\?|&)sslmode=') {
        $separator = if ($url.Contains('?')) { '&' } else { '?' }
        $url = "$url${separator}sslmode=require"
    }
    return $url
}

function Invoke-Checked {
    param(
        [Parameter(Mandatory)][string]$Executable,
        [Parameter(Mandatory)][string[]]$Arguments,
        [Parameter(Mandatory)][string]$FailureMessage
    )

    & $Executable @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "$FailureMessage (exit code $LASTEXITCODE)."
    }
}

if (-not (Test-Path -LiteralPath $supabaseCli)) {
    throw "Verified Supabase CLI not found at $supabaseCli. Ask Codex to reinstall it."
}
if (-not (Test-Path -LiteralPath $dockerCli)) {
    throw "Docker CLI not found at $dockerCli."
}

$env:Path = "$dockerBin;$env:Path"
Invoke-Checked -Executable $dockerCli -Arguments @('version', '--format', '{{.Server.Version}}') -FailureMessage 'Docker engine is not available'

$sourceUrl = $null
$targetUrl = $null
try {
    $sourceUrl = Read-DatabaseUrl -Label 'PRODUCTION (read-only source)' -ExpectedProjectRef $productionRef
    $targetUrl = Read-DatabaseUrl -Label 'STAGING (write target)' -ExpectedProjectRef $stagingRef

    if ($sourceUrl -eq $targetUrl) {
        throw 'Source and target database URIs are identical.'
    }

    New-Item -ItemType Directory -Path $workDir -Force | Out-Null
    Write-Host ""
    Write-Host 'Exporting the production public schema only. No table rows are requested.' -ForegroundColor Cyan
    Invoke-Checked -Executable $supabaseCli -Arguments @(
        'db', 'dump',
        '--db-url', $sourceUrl,
        '--schema', 'public',
        '--file', $schemaFile
    ) -FailureMessage 'Schema export failed'

    if (-not (Test-Path -LiteralPath $schemaFile) -or (Get-Item -LiteralPath $schemaFile).Length -lt 100) {
        throw 'Schema export is empty or unexpectedly small.'
    }

    $schemaSql = Get-Content -LiteralPath $schemaFile -Raw
    $dataStatements = [regex]::Matches(
        $schemaSql,
        '(?im)^\s*(?:copy\s+[^\r\n]+\s+from\s+stdin|insert\s+into|update\s+[^\r\n]+\s+set|delete\s+from|truncate\b)'
    )
    if ($dataStatements.Count -gt 0) {
        throw "Export safety check rejected $($dataStatements.Count) data-changing statement(s). Nothing was imported."
    }

    $createTables = [regex]::Matches($schemaSql, '(?im)^\s*create\s+table').Count
    $createPolicies = [regex]::Matches($schemaSql, '(?im)^\s*create\s+policy').Count
    $createFunctions = [regex]::Matches($schemaSql, '(?im)^\s*create\s+(?:or\s+replace\s+)?function').Count
    $hash = (Get-FileHash -LiteralPath $schemaFile -Algorithm SHA256).Hash
    Write-Host "Schema validated: $createTables tables, $createPolicies policies, $createFunctions functions." -ForegroundColor Green
    Write-Host "Schema SHA-256: $hash"

    Write-Host ""
    Write-Host 'Checking that the staging public schema is empty...' -ForegroundColor Cyan
    $query = "select count(*) from pg_catalog.pg_tables where schemaname = 'public';"
    $tableCountOutput = & $dockerCli run --rm postgres:17-alpine psql --dbname $targetUrl --tuples-only --no-align --command $query
    if ($LASTEXITCODE -ne 0) {
        throw 'Could not inspect the staging database.'
    }
    $tableCount = 0
    if (-not [int]::TryParse(($tableCountOutput | Select-Object -Last 1).Trim(), [ref]$tableCount)) {
        throw 'Could not determine the staging public-table count.'
    }
    if ($tableCount -ne 0) {
        throw "Staging already contains $tableCount public table(s). Import was stopped to avoid overwriting an existing schema."
    }

    Write-Host ""
    Write-Host "Target confirmed: staging project $stagingRef" -ForegroundColor Yellow
    $confirmation = Read-Host "Type IMPORT SCHEMA TO $stagingRef to continue"
    if ($confirmation -cne "IMPORT SCHEMA TO $stagingRef") {
        throw 'Confirmation did not match. Nothing was imported.'
    }

    Write-Host 'Importing the validated schema into staging...' -ForegroundColor Cyan
    $dockerWorkDir = $workDir.Replace('\', '/')
    Invoke-Checked -Executable $dockerCli -Arguments @(
        'run', '--rm',
        '--mount', "type=bind,source=$dockerWorkDir,target=/work,readonly",
        'postgres:17-alpine',
        'psql', '--dbname', $targetUrl,
        '--set', 'ON_ERROR_STOP=1',
        '--file', '/work/public-schema.sql'
    ) -FailureMessage 'Schema import failed'

    Write-Host ""
    Write-Host "Production public schema copied successfully to staging $stagingRef." -ForegroundColor Green
    Write-Host 'No production table data or Auth users were copied.' -ForegroundColor Green
}
finally {
    $sourceUrl = $null
    $targetUrl = $null
    if (Test-Path -LiteralPath $workDir) {
        Remove-Item -LiteralPath $workDir -Recurse -Force
    }
}
