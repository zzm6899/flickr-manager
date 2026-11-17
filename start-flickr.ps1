$ErrorActionPreference = 'Stop'

$node = Join-Path $PSScriptRoot 'runtime\node.exe'
if (-not (Test-Path -LiteralPath $node -PathType Leaf)) {
    $node = (Get-Command node.exe -CommandType Application -ErrorAction SilentlyContinue |
        Select-Object -First 1).Source
}
if (-not $node) {
    Write-Host 'Install Node.js 22 or newer, or add runtime\node.exe to the Flickr Manager folder.'
    Write-Host 'Download Node.js from https://nodejs.org/en/download'
    exit 1
}

$version = & $node --version
if ($LASTEXITCODE -ne 0 -or $version -notmatch '^v(\d+)\.' -or [int]$Matches[1] -lt 22) {
    Write-Host "Flickr Manager requires Node.js 22 or newer. Found: $version"
    exit 1
}

& $node (Join-Path $PSScriptRoot 'flickr-server.mjs') --open
exit $LASTEXITCODE
