const XLSX = require('xlsx');
const path = require('path');

// Read Excel file
const excelPath = path.join(__dirname, '../../excel/kala-kod.xls');
const workbook = XLSX.readFile(excelPath);

console.log('📊 Excel File Analysis');
console.log('====================');
console.log(`File: ${excelPath}`);
console.log(`Sheets: ${workbook.SheetNames.join(', ')}`);

// Analyze each sheet
workbook.SheetNames.forEach((sheetName, index) => {
  console.log(`\n📋 Sheet ${index + 1}: ${sheetName}`);
  console.log('='.repeat(50));
  
  const worksheet = workbook.Sheets[sheetName];
  const data = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
  
  console.log(`Total rows: ${data.length}`);
  
  if (data.length > 0) {
    console.log(`Columns: ${data[0].length}`);
    console.log('\nFirst 10 rows:');
    data.slice(0, 10).forEach((row, rowIndex) => {
      console.log(`Row ${rowIndex + 1}:`, row);
    });
    
    if (data.length > 10) {
      console.log('...');
      console.log(`Last row:`, data[data.length - 1]);
    }
  }
});

// Look for the sheet with product data (likely Sheet3 based on analysis)
const targetSheet = workbook.SheetNames[2]; // Sheet3
if (targetSheet) {
  console.log(`\n🔍 Detailed Analysis of ${targetSheet}`);
  console.log('='.repeat(50));
  
  const worksheet = workbook.Sheets[targetSheet];
  const data = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
  
  // Find rows with actual data (not empty)
  const dataRows = data.filter(row => row.some(cell => cell !== undefined && cell !== null && cell !== ''));
  
  console.log(`Rows with data: ${dataRows.length}`);
  
  if (dataRows.length > 0) {
    console.log('\nFirst 5 data rows:');
    dataRows.slice(0, 5).forEach((row, index) => {
      console.log(`Data Row ${index + 1}:`, row);
    });
    
    // Analyze column structure
    const maxColumns = Math.max(...dataRows.map(row => row.length));
    console.log(`\nMax columns: ${maxColumns}`);
    
    // Check if first row might be headers
    const firstRow = dataRows[0];
    console.log('\nFirst row (potential headers):', firstRow);
    
    // Look for patterns in the data
    console.log('\nData patterns:');
    dataRows.slice(0, 10).forEach((row, index) => {
      const nonEmptyCells = row.filter(cell => cell !== undefined && cell !== null && cell !== '');
      console.log(`Row ${index + 1}: ${nonEmptyCells.length} non-empty cells:`, nonEmptyCells);
    });
  }
}
