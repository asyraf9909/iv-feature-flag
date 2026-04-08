import type { Config } from 'jest';

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/index.ts',
    '!src/infrastructure/db.ts',
    '!src/infrastructure/migrations.ts',
  ],
  coverageThreshold: {
    global: {
      lines: 70,
    },
  },
};

export default config;
