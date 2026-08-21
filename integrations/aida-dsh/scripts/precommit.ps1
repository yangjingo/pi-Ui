$ErrorActionPreference = 'Stop'

$pluginRoot = Split-Path -Parent $PSScriptRoot
$defaultDeployRoot = Join-Path (Split-Path -Parent (Split-Path -Parent $pluginRoot)) 'dsh-aida-deploy'
$deployRoot = if ($env:DSH_AIDA_DEPLOY_ROOT) { $env:DSH_AIDA_DEPLOY_ROOT } else { $defaultDeployRoot }
$target = Join-Path $deployRoot 'packages\client\ui-aida'

if (-not (Test-Path -LiteralPath (Join-Path $deployRoot 'pnpm-workspace.yaml'))) {
  throw "DSH integration workspace not found at '$deployRoot'. Set DSH_AIDA_DEPLOY_ROOT to a prepared DSH checkout."
}

$directories = @('src', 'tests')
foreach ($directory in $directories) {
  $destination = Join-Path $target $directory
  if (Test-Path -LiteralPath $destination) {
    Remove-Item -LiteralPath $destination -Recurse -Force
  }
  Copy-Item -LiteralPath (Join-Path $pluginRoot $directory) -Destination $destination -Recurse -Force
}

$files = @(
  'package.json',
  'tsconfig.json',
  'tsconfig.client.json',
  'tsconfig.host.json',
  'tsdown.config.ts'
)
foreach ($file in $files) {
  Copy-Item -LiteralPath (Join-Path $pluginRoot $file) -Destination (Join-Path $target $file) -Force
}

Push-Location $deployRoot
try {
  pnpm exec tsc -b packages/client/ui-aida/tsconfig.json
  if ($LASTEXITCODE -ne 0) { throw 'AIDA TypeScript validation failed.' }

  pnpm exec vitest run packages/client/ui-aida/tests
  if ($LASTEXITCODE -ne 0) { throw 'AIDA test validation failed.' }
}
finally {
  Pop-Location
}
