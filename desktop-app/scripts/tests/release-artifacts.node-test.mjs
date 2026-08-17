/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import {
  checksumManifestName,
  expectedReleaseAssetNames,
  verifyReleaseAssets
} from '../release-artifacts.mjs'

const version = '9.8.7'

test('verifies exact release assets and writes a SHA256 manifest', async () => {
  const directory = await createAssetDirectory()
  try {
    const result = await verifyReleaseAssets(directory, version)
    const manifest = await readFile(join(directory, checksumManifestName), 'utf8')

    assert.deepEqual(result.assetNames, expectedReleaseAssetNames(version))
    for (const name of result.assetNames) {
      assert.match(manifest, new RegExp(`^[a-f0-9]{64}  ${escapeRegExp(name)}$`, 'mu'))
    }
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('rejects stale or unexpected release assets', async () => {
  const directory = await createAssetDirectory()
  try {
    await writeFile(join(directory, 'desktop-app-0.0.1-x64.dmg'), 'stale')
    await assert.rejects(
      verifyReleaseAssets(directory, version),
      /Release assets do not match the 9\.8\.7 manifest/u
    )
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('rejects empty release assets', async () => {
  const directory = await createAssetDirectory()
  try {
    const [firstAsset] = expectedReleaseAssetNames(version)
    await writeFile(join(directory, firstAsset), '')
    await assert.rejects(verifyReleaseAssets(directory, version), /non-empty regular file/u)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

async function createAssetDirectory() {
  const directory = await mkdtemp(join(tmpdir(), 'dascowork-release-assets-'))
  await Promise.all(
    expectedReleaseAssetNames(version).map((name) => writeFile(join(directory, name), name))
  )
  return directory
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
}
