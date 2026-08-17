/* eslint-disable @typescript-eslint/explicit-function-return-type */
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { lstat, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const productName = 'desktop-app'
const checksumManifestName = 'SHA256SUMS'

export function releaseArtifactName(version, kind, arch) {
  const suffixByKind = {
    appimage: 'AppImage',
    deb: 'deb',
    dmg: 'dmg',
    nsis: 'exe',
    snap: 'snap'
  }
  const suffix = suffixByKind[kind]
  if (!suffix) throw new Error(`Unsupported release artifact kind: ${kind}`)

  const setupSuffix = kind === 'nsis' ? '-setup' : ''
  return `${productName}-${version}-${arch}${setupSuffix}.${suffix}`
}

export function expectedReleaseAssetNames(version) {
  return [
    releaseArtifactName(version, 'dmg', 'x64'),
    releaseArtifactName(version, 'dmg', 'arm64'),
    releaseArtifactName(version, 'nsis', 'x64'),
    releaseArtifactName(version, 'appimage', 'x64'),
    releaseArtifactName(version, 'deb', 'x64'),
    releaseArtifactName(version, 'snap', 'x64')
  ].sort()
}

export async function verifyReleaseAssets(assetDirectory, version) {
  const expectedNames = expectedReleaseAssetNames(version)
  const entries = await readdir(assetDirectory, { withFileTypes: true })
  const actualNames = entries
    .map((entry) => entry.name)
    .filter((name) => name !== checksumManifestName)
    .sort()

  if (JSON.stringify(actualNames) !== JSON.stringify(expectedNames)) {
    throw new Error(
      `Release assets do not match the ${version} manifest.\nExpected: ${expectedNames.join(', ')}\nActual: ${actualNames.join(', ')}`
    )
  }

  const checksumLines = []
  for (const name of expectedNames) {
    const assetPath = join(assetDirectory, name)
    const metadata = await lstat(assetPath)
    if (!metadata.isFile() || metadata.size === 0) {
      throw new Error(`Release asset must be a non-empty regular file: ${name}`)
    }
    const checksum = await sha256File(assetPath)
    checksumLines.push(`${checksum}  ${name}`)
  }

  const manifestPath = join(assetDirectory, checksumManifestName)
  await writeFile(manifestPath, `${checksumLines.join('\n')}\n`, 'utf8')
  return { assetNames: expectedNames, manifestPath }
}

async function sha256File(path) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}

export { checksumManifestName }
