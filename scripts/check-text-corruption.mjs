import fs from 'fs';
import path from 'path';

const inventoryPath = path.join(process.cwd(), 'reports', 'text-corruption-inventory.json');

if (!fs.existsSync(inventoryPath)) {
  console.error('Missing inventory file. Run: npm run text:scan');
  process.exit(2);
}

const records = JSON.parse(fs.readFileSync(inventoryPath, 'utf8'));

if (!Array.isArray(records)) {
  console.error('Inventory format is invalid.');
  process.exit(2);
}

if (records.length === 0) {
  console.log('No corruption signatures detected.');
  process.exit(0);
}

const first = records[0];
console.error(`Detected ${records.length} corruption signatures.`);
console.error(`Example: ${first.file}:${first.line} [${first.class}] ${first.token}`);
process.exit(1);
