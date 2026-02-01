const XLSX = require('xlsx');
const path = require('path');

// Read Excel file
const excelPath = path.join(__dirname, '../../excel/kala-kod.xls');
const workbook = XLSX.readFile(excelPath);
const worksheet = workbook.Sheets['Sheet2'];
const data = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

console.log('📊 Sheet2 Detailed Analysis');
console.log('============================');
console.log(`Total rows: ${data.length}`);

// Show first 20 rows with detailed structure
console.log('\n📋 First 20 rows with column analysis:');
data.slice(0, 20).forEach((row, index) => {
  console.log(`\nRow ${index + 1}:`);
  row.forEach((cell, colIndex) => {
    console.log(`  Col ${colIndex}: "${cell}" (${typeof cell})`);
  });
});

// Look for patterns in the data structure
console.log('\n🔍 Data Structure Analysis:');
console.log('============================');

// Check if there are different patterns in the data
const patterns = {};
data.forEach((row, index) => {
  if (index === 0) return; // Skip header
  
  const nonEmptyCells = row.filter(cell => cell !== undefined && cell !== null && cell !== '');
  const pattern = nonEmptyCells.length;
  
  if (!patterns[pattern]) {
    patterns[pattern] = [];
  }
  patterns[pattern].push({ row: index + 1, data: nonEmptyCells });
});

console.log('\nPatterns found:');
Object.keys(patterns).forEach(pattern => {
  console.log(`\nPattern ${pattern} (${patterns[pattern].length} rows):`);
  patterns[pattern].slice(0, 3).forEach(item => {
    console.log(`  Row ${item.row}:`, item.data);
  });
  if (patterns[pattern].length > 3) {
    console.log(`  ... and ${patterns[pattern].length - 3} more rows`);
  }
});

// Look for the most common pattern
const mostCommonPattern = Object.keys(patterns).reduce((a, b) => 
  patterns[a].length > patterns[b].length ? a : b
);

console.log(`\n🎯 Most common pattern: ${mostCommonPattern} columns (${patterns[mostCommonPattern].length} rows)`);

// Analyze the most common pattern in detail
console.log('\n📊 Detailed analysis of most common pattern:');
patterns[mostCommonPattern].slice(0, 10).forEach((item, index) => {
  console.log(`\nExample ${index + 1} (Row ${item.row}):`);
  item.data.forEach((cell, colIndex) => {
    console.log(`  [${colIndex}]: "${cell}"`);
  });
});

// Look for specific patterns that might indicate the structure
console.log('\n🔍 Looking for specific patterns:');

// Check for rows that might have the expected structure
const expectedStructureRows = patterns[mostCommonPattern].filter(item => {
  const data = item.data;
  // Look for rows that have cut dimension, stone material, width, thickness, mine, finish
  return data.length >= 6 && 
         (data[0] === 'تایل' || data[0] === 'طولی' || data[0] === 'حجمی') &&
         (data[1] === 'کریستال' || data[1] === 'مرمریت' || data[1] === 'تراورتن');
});

console.log(`\nRows with expected structure: ${expectedStructureRows.length}`);
if (expectedStructureRows.length > 0) {
  console.log('\nFirst 5 examples:');
  expectedStructureRows.slice(0, 5).forEach((item, index) => {
    console.log(`\nExample ${index + 1} (Row ${item.row}):`);
    item.data.forEach((cell, colIndex) => {
      console.log(`  [${colIndex}]: "${cell}"`);
    });
  });
}
