$ErrorActionPreference = 'Stop'

$pluginRoot = Split-Path -Parent $PSScriptRoot
$defaultDeployRoot = Join-Path (Split-Path -Parent $pluginRoot) 'dsh-aida-deploy'
$deployRoot = if ($env:DSH_AIDA_DEPLOY_ROOT) { $env:DSH_AIDA_DEPLOY_ROOT } else { $defaultDeployRoot }
$target = Join-Path $deployRoot 'packages\client\ui-aida'

if (-not (Test-Path -LiteralPath (Join-Path $deployRoot 'pnpm-workspace.yaml'))) {
  throw "DSH integration workspace not found at '$deployRoot'. Set DSH_AIDA_DEPLOY_ROOT to a prepared DSH checkout."
}

$generatedLib = Join-Path $target 'lib'
if (Test-Path -LiteralPath $generatedLib) {
  Remove-Item -LiteralPath $generatedLib -Recurse -Force
}

$directories = @('assets', 'src', 'tests', 'scripts')
foreach ($directory in $directories) {
  $destination = Join-Path $target $directory
  if (Test-Path -LiteralPath $destination) {
    Remove-Item -LiteralPath $destination -Recurse -Force
  }
  Copy-Item -LiteralPath (Join-Path $pluginRoot $directory) -Destination $destination -Recurse -Force
}

$files = @(
  'CHANGELOG.md',
  'LICENSE',
  'package.json',
  'cordis.patch.yml',
  'tsconfig.json',
  'tsconfig.client.json',
  'tsconfig.host.json',
  'tsdown.config.ts'
)

# README.md carries the archive's own SHA-256 and therefore cannot be embedded
# in that same archive without creating a checksum recursion. Remove copies
# produced by older synchronization runs; the repository README remains the
# canonical external installation guide.
foreach ($staleReadme in @('README.md', 'README.zh.md')) {
  $stalePath = Join-Path $target $staleReadme
  if (Test-Path -LiteralPath $stalePath) {
    Remove-Item -LiteralPath $stalePath -Force
  }
}
foreach ($file in $files) {
  Copy-Item -LiteralPath (Join-Path $pluginRoot $file) -Destination (Join-Path $target $file) -Force
}

# The AIDA skin references this image from the Web host root. Keep the host's
# public asset in sync with the plugin source so local deployments do not
# silently fall back to a flat background.
$webPublic = Join-Path $deployRoot 'apps\web\public'
if (-not (Test-Path -LiteralPath $webPublic)) {
  throw "DSH Web public directory not found at '$webPublic'."
}
Copy-Item `
  -LiteralPath (Join-Path $pluginRoot 'assets\aida-background.png') `
  -Destination (Join-Path $webPublic 'aida-background.png') `
  -Force

# A running production preview serves the last Vite output. Refresh it too
# when present; the next full Web build will copy the public file normally.
$webDist = Join-Path $deployRoot 'apps\web\dist'
if (Test-Path -LiteralPath $webDist) {
  Copy-Item `
    -LiteralPath (Join-Path $pluginRoot 'assets\aida-background.png') `
    -Destination (Join-Path $webDist 'aida-background.png') `
    -Force
}

Push-Location $deployRoot
try {
  # A fresh DSH checkout needs the complete workspace link graph before the
  # AIDA project reference can resolve every generated remote subpath.
  pnpm install
  if ($LASTEXITCODE -ne 0) { throw 'DSH workspace dependency installation failed.' }

  # The client remotes consume host-generated Typert artifacts (the
  # `./remote` package exports), so a clean checkout must build that face
  # before a client project reference can typecheck.
  pnpm run build:lib:host
  if ($LASTEXITCODE -ne 0) { throw 'DSH host contract build failed.' }

  pnpm exec tsc -b packages/client/ui-aida/tsconfig.json
  if ($LASTEXITCODE -ne 0) { throw 'AIDA TypeScript validation failed.' }

  # Tests import the package's public `./client` export as well as source
  # modules, so materialize lib/client.js before Vitest resolves the package.
  pnpm --filter '@aida/aida-ui-dsh' bundle
  if ($LASTEXITCODE -ne 0) { throw 'AIDA bundle build failed.' }

  pnpm exec vitest run packages/client/ui-aida/tests
  if ($LASTEXITCODE -ne 0) { throw 'AIDA test validation failed.' }
}
finally {
  Pop-Location
}
