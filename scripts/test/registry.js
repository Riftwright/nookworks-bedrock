// Test list, kept apart from runner.js so test modules can import it before the runner runs.
export const tests = [];
export function test(name, fn) {
  tests.push({ name, fn });
}
