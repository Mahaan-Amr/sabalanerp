const XLSX = require('xlsx');
const path = require('path');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const excelPath = path.join(__dirname, '../../excel/kala-kod.xls');

async function importMasterDataComplete() {
  try {
    console.log('🚀 Importing complete master data from kala-kod.xls Sheet2...');
    
    const workbook = XLSX.readFile(excelPath);
    const sheetName = 'Sheet2';
    const worksheet = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
    
    // Extract all unique master data
    const masterData = {
      cutTypes: new Map(),
      stoneMaterials: new Map(),
      widths: new Map(),
      thicknesses: new Map(),
      mines: new Map(),
      finishTypes: new Map(),
      colors: new Map()
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
        masterData.cutTypes.set(cutTypeCode, cutType);
      }
      if (stoneMaterial && stoneMaterialCode) {
        masterData.stoneMaterials.set(stoneMaterialCode, stoneMaterial);
      }
      if (width && widthCode) {
        masterData.widths.set(widthCode, width);
      }
      if (thickness && thicknessCode) {
        masterData.thicknesses.set(thicknessCode, thickness);
      }
      if (mine && mineCode) {
        masterData.mines.set(mineCode, mine);
      }
      if (finishType && finishCode) {
        masterData.finishTypes.set(finishCode, finishType);
      }
      if (color && colorCode) {
        masterData.colors.set(colorCode, color);
      }
    }
    
    console.log(`📊 Found master data:`);
    console.log(`  - Cut Types: ${masterData.cutTypes.size}`);
    console.log(`  - Stone Materials: ${masterData.stoneMaterials.size}`);
    console.log(`  - Widths: ${masterData.widths.size}`);
    console.log(`  - Thicknesses: ${masterData.thicknesses.size}`);
    console.log(`  - Mines: ${masterData.mines.size}`);
    console.log(`  - Finish Types: ${masterData.finishTypes.size}`);
    console.log(`  - Colors: ${masterData.colors.size}`);
    
    let totalImported = 0;
    
    // Import Cut Types
    console.log('\n🔸 Importing Cut Types...');
    for (const [code, name] of masterData.cutTypes) {
      await prisma.cutType.create({
        data: {
          code,
          name: name,
          namePersian: name,
          isActive: true
        }
      });
      totalImported++;
    }
    console.log(`✅ Imported ${masterData.cutTypes.size} cut types`);
    
    // Import Stone Materials
    console.log('\n🔸 Importing Stone Materials...');
    for (const [code, name] of masterData.stoneMaterials) {
      await prisma.stoneMaterial.create({
        data: {
          code,
          name: name,
          namePersian: name,
          isActive: true
        }
      });
      totalImported++;
    }
    console.log(`✅ Imported ${masterData.stoneMaterials.size} stone materials`);
    
    // Import Widths
    console.log('\n🔸 Importing Widths...');
    for (const [code, name] of masterData.widths) {
      // Extract numeric value from width name (e.g., "ع60" -> 60)
      const numericValue = parseInt(name.replace(/[^\d]/g, '')) || 0;
      
      await prisma.cutWidth.create({
        data: {
          code,
          name: name,
          namePersian: name,
          value: numericValue,
          isActive: true
        }
      });
      totalImported++;
    }
    console.log(`✅ Imported ${masterData.widths.size} widths`);
    
    // Import Thicknesses
    console.log('\n🔸 Importing Thicknesses...');
    for (const [code, name] of masterData.thicknesses) {
      // Extract numeric value from thickness name (e.g., "ض2" -> 2)
      const numericValue = parseInt(name.replace(/[^\d]/g, '')) || 0;
      
      await prisma.thickness.create({
        data: {
          code,
          name: name,
          namePersian: name,
          value: numericValue,
          isActive: true
        }
      });
      totalImported++;
    }
    console.log(`✅ Imported ${masterData.thicknesses.size} thicknesses`);
    
    // Import Mines
    console.log('\n🔸 Importing Mines...');
    for (const [code, name] of masterData.mines) {
      await prisma.mine.create({
        data: {
          code,
          name: name,
          namePersian: name,
          isActive: true
        }
      });
      totalImported++;
    }
    console.log(`✅ Imported ${masterData.mines.size} mines`);
    
    // Import Finish Types
    console.log('\n🔸 Importing Finish Types...');
    for (const [code, name] of masterData.finishTypes) {
      await prisma.finishType.create({
        data: {
          code,
          name: name,
          namePersian: name,
          isActive: true
        }
      });
      totalImported++;
    }
    console.log(`✅ Imported ${masterData.finishTypes.size} finish types`);
    
    // Import Colors
    console.log('\n🔸 Importing Colors...');
    for (const [code, name] of masterData.colors) {
      await prisma.color.create({
        data: {
          code,
          name: name,
          namePersian: name,
          isActive: true
        }
      });
      totalImported++;
    }
    console.log(`✅ Imported ${masterData.colors.size} colors`);
    
    console.log(`\n🎉 Master data import completed! Total imported: ${totalImported} items`);
    
  } catch (error) {
    console.error('❌ Error importing master data:', error);
  } finally {
    await prisma.$disconnect();
  }
}

importMasterDataComplete();
