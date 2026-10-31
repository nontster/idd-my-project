const path = require('node:path');
const { inventory } = require('./scripts/security-files.cjs');
const security = inventory(__dirname).securityEmitted;
module.exports = {
  rootDir: __dirname,
  testEnvironment: 'node',
  transform: {},
  testMatch: ['<rootDir>/build/tests/**/*.test.js'],
  coverageProvider: 'v8',
  collectCoverageFrom: ['build/src/**/*.js'],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'json', 'json-summary'],
  coverageThreshold: Object.fromEntries(security.map(file => ['./' + path.relative(__dirname, file).split(path.sep).join('/'), { branches: 100 }])),
  maxWorkers: 1,
};
