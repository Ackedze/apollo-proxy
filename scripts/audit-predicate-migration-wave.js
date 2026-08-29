#!/usr/bin/env node

const path = require('node:path');

const { auditMigrationWave } = require('../src/predicate-engine/migration-wave-audit');

const designSystemRoot = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.resolve(__dirname, '../../../shared/design-system_ab');
const result = auditMigrationWave(designSystemRoot);

process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
if (!result.safeToPromote) process.exitCode = 2;
