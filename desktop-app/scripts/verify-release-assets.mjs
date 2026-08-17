import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { verifyReleaseAssets } from './release-artifacts.mjs'

const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
const assetDirectory = resolve(process.cwd(), process.argv[2] ?? 'release-assets')
const result = await verifyReleaseAssets(assetDirectory, packageJson.version)

console.log(`Verified ${result.assetNames.length} release assets for ${packageJson.version}.`)
console.log(`Wrote checksum manifest: ${result.manifestPath}`)
