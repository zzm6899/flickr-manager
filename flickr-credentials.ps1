param([ValidateSet('Load', 'Save', 'Forget')][string]$Action)

$ErrorActionPreference = 'Stop'
$folder = Join-Path $env:LOCALAPPDATA 'Flickr Manager'
$file = Join-Path $folder 'credentials.dat'

switch ($Action) {
    'Load' {
        if (Test-Path -LiteralPath $file) {
            $secure = ConvertTo-SecureString ([IO.File]::ReadAllText($file))
            try {
                [Console]::Write([Net.NetworkCredential]::new('', $secure).Password)
            } finally {
                $secure.Dispose()
            }
        }
    }
    'Save' {
        $secure = ConvertTo-SecureString ([Console]::In.ReadToEnd()) -AsPlainText -Force
        try {
            $encrypted = ConvertFrom-SecureString $secure
        } finally {
            $secure.Dispose()
        }
        [IO.Directory]::CreateDirectory($folder) | Out-Null
        $temp = Join-Path $folder ([guid]::NewGuid().ToString() + '.tmp')
        try {
            [IO.File]::WriteAllText($temp, $encrypted)
            if ([IO.File]::Exists($file)) {
                [IO.File]::Replace($temp, $file, [NullString]::Value)
            } else {
                [IO.File]::Move($temp, $file)
            }
        } finally {
            [IO.File]::Delete($temp)
        }
    }
    'Forget' {
        if (Test-Path -LiteralPath $file) { [IO.File]::Delete($file) }
    }
}
