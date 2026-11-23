import { assertStandardLocalStartup, localCompose, startStandardLocal } from './lib/standard-local-docker.mjs';

const args = process.argv.slice(2);
const compose = args[0] === '--acceptance'
  ? [...localCompose, '-f', 'docker-compose.performance-acceptance.yml']
  : localCompose;
if (compose !== localCompose) args.shift();

try {
  if (args.length === 1 && args[0] === '--check') {
    assertStandardLocalStartup(compose);
  } else {
    process.exitCode = startStandardLocal(compose, args);
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
