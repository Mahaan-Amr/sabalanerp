const XLSX = require('xlsx');
const path = require('path');

const excelPath = path.join(__dirname, '../../excel/kala-kod.xls');

async function analyzeExcelComplete() {
  try {
    console.log('🔍 Deep analysis of kala-kod.xls Sheet2...');
    
    const workbook = XLSX.readFile(excelPath);
    const sheetName = 'Sheet2';
    const worksheet = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
    
    console.log(`📊 Total rows in Sheet2: ${data.length}`);
    
    // Analyze first few rows to understand structure
    console.log('\n📋 First 5 rows structure:');
    for (let i = 0; i < Math.min(5, data.length); i++) {
      const row = data[i];
      console.log(`\nRow ${i + 1}:`);
      row.forEach((cell, colIndex) => {
        if (cell !== undefined && cell !== null && cell !== '') {
          console.log(`  Col ${colIndex}: "${cell}" (${typeof cell})`);
        }
      });
    }
    
    // Extract all unique values for each master data category
    const masterData = {
      cutTypes: new Set(),
      stoneMaterials: new Set(),
      widths: new Set(),
      thicknesses: new Set(),
      mines: new Set(),
      finishTypes: new Set(),
      colors: new Set()
    };
    
    // Skip header row (Row 1)
    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      if (!row || row.length === 0 || row.every(cell => cell === undefined || cell === null || cell === '')) {
        continue; // Skip empty rows
      }
      
      // Extract master data based on column structure
      const cutType = row[0]?.toString().trim();
      const cutTypeCode = row[1]?.toString().trim();
      const stoneMaterial = row[2]?.toString().trim();
      const stoneMaterialCode = row[3]?.toString().trim();
      const width = row[4]?.toString().trim();
      const widthCode = row[5]?.toString().trim();
      const thickness = row[6]?.toString().trim();
      const thicknessCode = row[7]?.toString().trim();
      const mine = row[8]?.toString().trim();
      const mineCode = row[9]?.toString().trim();
      const finishType = row[10]?.toString().trim();
      const finishCode = row[11]?.toString().trim();
      const color = row[12]?.toString().trim();
      const colorCode = row[13]?.toString().trim();
      
      if (cutType && cutTypeCode) {
        masterData.cutTypes.add(`${cutTypeCode}|${cutType}`);
      }
      if (stoneMaterial && stoneMaterialCode) {
        masterData.stoneMaterials.add(`${stoneMaterialCode}|${stoneMaterial}`);
      }
      if (width && widthCode) {
        masterData.widths.add(`${widthCode}|${width}`);
      }
      if (thickness && thicknessCode) {
        masterData.thicknesses.add(`${thicknessCode}|${thickness}`);
      }
      if (mine && mineCode) {
        masterData.mines.add(`${mineCode}|${mine}`);
      }
      if (finishType && finishCode) {
        masterData.finishTypes.add(`${finishCode}|${finishType}`);
      }
      if (color && colorCode) {
        masterData.colors.add(`${colorCode}|${color}`);
      }
    }
    
    // Display extracted master data
    console.log('\n📊 Extracted Master Data:');
    console.log(`\n🔸 Cut Types (${masterData.cutTypes.size}):`);
    Array.from(masterData.cutTypes).sort().forEach(item => {
      const [code, name] = item.split('|');
      console.log(`  ${code}: ${name}`);
    });
    
    console.log(`\n🔸 Stone Materials (${masterData.stoneMaterials.size}):`);
    Array.from(masterData.stoneMaterials).sort().forEach(item => {
      const [code, name] = item.split('|');
      console.log(`  ${code}: ${name}`);
    });
    
    console.log(`\n🔸 Widths (${masterData.widths.size}):`);
    Array.from(masterData.widths).sort().forEach(item => {
      const [code, name] = item.split('|');
      console.log(`  ${code}: ${name}`);
    });
    
    console.log(`\n🔸 Thicknesses (${masterData.thicknesses.size}):`);
    Array.from(masterData.thicknesses).sort().forEach(item => {
      const [code, name] = item.split('|');
      console.log(`  ${code}: ${name}`);
    });
    
    console.log(`\n🔸 Mines (${masterData.mines.size}):`);
    Array.from(masterData.mines).sort().forEach(item => {
      const [code, name] = item.split('|');
      console.log(`  ${code}: ${name}`);
    });
    
    console.log(`\n🔸 Finish Types (${masterData.finishTypes.size}):`);
    Array.from(masterData.finishTypes).sort().forEach(item => {
      const [code, name] = item.split('|');
      console.log(`  ${code}: ${name}`);
    });
    
    console.log(`\n🔸 Colors (${masterData.colors.size}):`);
    Array.from(masterData.colors).sort().forEach(item => {
      const [code, name] = item.split('|');
      console.log(`  ${code}: ${name}`);
    });
    
    // Sample product data
    console.log('\n📦 Sample Product Data (first 3 products):');
    for (let i = 1; i < Math.min(4, data.length); i++) {
      const row = data[i];
      if (!row || row.length === 0) continue;
      
      const productName = row[14]?.toString().trim();
      const productCode = row[15]?.toString().trim();
      
      console.log(`\nProduct ${i}:`);
      console.log(`  Name: ${productName}`);
      console.log(`  Code: ${productCode}`);
      console.log(`  Cut Type: ${row[0]} (${row[1]})`);
      console.log(`  Stone Material: ${row[2]} (${row[3]})`);
      console.log(`  Width: ${row[4]} (${row[5]})`);
      console.log(`  Thickness: ${row[6]} (${row[7]})`);
      console.log(`  Mine: ${row[8]} (${row[9]})`);
      console.log(`  Finish: ${row[10]} (${row[11]})`);
      console.log(`  Color: ${row[12]} (${row[13]})`);
    }
    
    console.log('\n✅ Excel analysis completed!');
    
  } catch (error) {
    console.error('❌ Error analyzing Excel file:', error);
  }
}

analyzeExcelComplete();
