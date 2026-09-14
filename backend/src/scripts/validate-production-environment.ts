import { validateProductionEnvironment } from '../services/productionEnvironment';

try {
  validateProductionEnvironment();
  console.log('Production runtime environment validation passed.');
} catch (error) {
  // The shared startup validator reports setting names, never their values.
  console.error(error instanceof Error ? error.message : 'Production runtime environment validation failed.');
  process.exitCode = 1;
}
