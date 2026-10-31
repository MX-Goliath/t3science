function quotePowerShell(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

export function portableInstallScript(
  source: string,
  destination: string,
  restart: boolean,
): string {
  return `
$ErrorActionPreference = 'Stop'
$source = ${quotePowerShell(source)}
$destination = ${quotePowerShell(destination)}
$staged = $destination + '.update'
$backup = $destination + '.previous'
try {
  Copy-Item -LiteralPath $source -Destination $staged -Force
  $installed = $false
  for ($attempt = 0; $attempt -lt 120; $attempt++) {
    try {
      [System.IO.File]::Replace($staged, $destination, $backup)
      $installed = $true
      break
    } catch [System.IO.IOException] {
      Start-Sleep -Seconds 1
    }
  }
  if (!$installed) { throw 'Portable executable is still locked; update was not applied.' }
  Remove-Item -LiteralPath $backup -Force
  ${restart ? "Start-Process -FilePath $destination -WorkingDirectory (Split-Path -LiteralPath $destination)" : ""}
} catch {
  $_ | Out-File -LiteralPath ($destination + '.update-error.log')
  exit 1
}
`;
}
