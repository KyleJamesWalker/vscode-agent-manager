/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['<rootDir>/src/test/unit/**/*.test.ts'],
  globals: {
    'ts-jest': {
      tsconfig: '<rootDir>/src/test/unit/tsconfig.json',
    },
  },
};
