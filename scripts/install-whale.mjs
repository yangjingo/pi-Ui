#!/usr/bin/env node

import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { installPets, main } from './install-pets.mjs'

/** Backward-compatible archive command: install every AIDA pet, report the whale. */
export function installWhale(options) {
  const result = installPets(options)
  return { ...result, ...result.pets.find(pet => pet.id === 'healing-whale-hit') }
}

const invokedPath = process.argv[1] === undefined ? '' : resolve(process.argv[1])
if (invokedPath !== '' && invokedPath === resolve(fileURLToPath(import.meta.url))) main()
