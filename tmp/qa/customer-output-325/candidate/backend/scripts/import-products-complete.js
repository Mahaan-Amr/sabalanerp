const XLSX = require('xlsx');
const path = require('path');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const excelPath = path.join(__dirname, '../../excel/kala-kod.xls');

async function importProductsComplete() {
  try {
    console.log('🚀 Importing all products from kala-kod.xls Sheet2...');
    
    const workbook = XLSX.readFile(excelPath);
    const sheetName = 'Sheet2';
    const worksheet = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
    
    // Load all master data for lookup
    const [cutTypes, stoneMaterials, widths, thicknesses, mines, finishTypes, colors] = await Promise.all([
      prisma.cutType.findMany(),
      prisma.stoneMaterial.findMany(),
      prisma.cutWidth.findMany(),
      prisma.thickness.findMany(),
      prisma.mine.findMany(),
      prisma.finishType.findMany(),
      prisma.color.findMany()
    ]);
    
    // Create lookup maps
    const cutTypeMap = new Map(cutTypes.map(ct => [ct.code, ct]));
    const stoneMaterialMap = new Map(stoneMaterials.map(sm => [sm.code, sm]));
    const widthMap = new Map(widths.map(w => [w.code, w]));
    const thicknessMap = new Map(thicknesses.map(t => [t.code, t]));
    const mineMap = new Map(mines.map(m => [m.code, m]));
    const finishTypeMap = new Map(finishTypes.map(ft => [ft.code, ft]));
    const colorMap = new Map(colors.map(c => [c.code, c]));
    
    console.log('📊 Master data loaded for lookup');
    
    let importedCount = 0;
    let skippedCount = 0;
    let errorCount = 0;
    
    // Skip header row (Row 1)
    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      if (!row || row.length === 0 || row.every(cell => cell === undefined || cell === null || cell === '')) {
        continue; // Skip empty rows
      }
      
      try {
        // Extract data from row
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
        const productName = row[14]?.toString().trim();
        const productCode = row[15]?.toString().trim();
        
        // Skip if essential data is missing
        if (!cutType || !cutTypeCode || !stoneMaterial || !stoneMaterialCode || 
            !width || !widthCode || !thickness || !thicknessCode || 
            !mine || !mineCode || !finishType || !finishCode || !productCode) {
          console.log(`⚠️ Skipping row ${i + 1}: Missing essential data`);
          skippedCount++;
          continue;
        }
        
        // Get master data objects
        const cutTypeObj = cutTypeMap.get(cutTypeCode);
        const stoneMaterialObj = stoneMaterialMap.get(stoneMaterialCode);
        const widthObj = widthMap.get(widthCode);
        const thicknessObj = thicknessMap.get(thicknessCode);
        const mineObj = mineMap.get(mineCode);
        const finishTypeObj = finishTypeMap.get(finishCode);
        const colorObj = colorMap.get(colorCode || '00'); // Default to '00' if no color
        
        if (!cutTypeObj || !stoneMaterialObj || !widthObj || !thicknessObj || !mineObj || !finishTypeObj) {
          console.log(`⚠️ Skipping row ${i + 1}: Master data not found`, {
            cutTypeCode, stoneMaterialCode, widthCode, thicknessCode, mineCode, finishCode
          });
          skippedCount++;
          continue;
        }
        
        // Check if product already exists
        const existingProduct = await prisma.product.findUnique({
          where: { code: productCode }
        });
        
        if (existingProduct) {
          console.log(`⚠️ Product ${productCode} already exists, skipping`);
          skippedCount++;
          continue;
        }
        
        // Create product
        const product = await prisma.product.create({
          data: {
            code: productCode,
            name: productName || `${stoneMaterialObj.name} ${widthObj.name} ${thicknessObj.name}`,
            namePersian: productName || `${stoneMaterialObj.namePersian} ${widthObj.namePersian} ${thicknessObj.namePersian}`,
            cuttingDimensionCode: cutTypeCode,
            cuttingDimensionName: cutTypeObj.name || cutTypeObj.namePersian,
            cuttingDimensionNamePersian: cutTypeObj.namePersian,
            stoneTypeCode: stoneMaterialCode,
            stoneTypeName: stoneMaterialObj.name || stoneMaterialObj.namePersian,
            stoneTypeNamePersian: stoneMaterialObj.namePersian,
            widthCode: widthCode,
            widthValue: widthObj.value,
            widthName: widthObj.name || widthObj.namePersian,
            thicknessCode: thicknessCode,
            thicknessValue: thicknessObj.value,
            thicknessName: thicknessObj.name || thicknessObj.namePersian,
            mineCode: mineCode,
            mineName: mineObj.name || mineObj.namePersian,
            mineNamePersian: mineObj.namePersian,
            finishCode: finishCode,
            finishName: finishTypeObj.name || finishTypeObj.namePersian,
            finishNamePersian: finishTypeObj.namePersian,
            colorCode: colorCode || '00',
            colorName: colorObj ? (colorObj.name || colorObj.namePersian) : 'بدون رنگ',
            colorNamePersian: colorObj ? colorObj.namePersian : 'بدون رنگ',
            qualityCode: '1', // Default quality
            qualityName: 'Standard',
            qualityNamePersian: 'استاندارد',
            isActive: true,
            isAvailable: true
          }
        });
        
        importedCount++;
        if (importedCount % 50 === 0) {
          console.log(`📦 Imported ${importedCount} products...`);
        }
        
      } catch (error) {
        console.error(`❌ Error importing row ${i + 1}:`, error.message);
        errorCount++;
      }
    }
    
    console.log(`\n📊 Product Import Summary:`);
    console.log(`✅ Successfully imported: ${importedCount} products`);
    console.log(`⚠️ Skipped: ${skippedCount} products`);
    console.log(`❌ Errors: ${errorCount} products`);
    console.log(`🎉 Product import completed!`);
    
  } catch (error) {
    console.error('❌ Error importing products:', error);
  } finally {
    await prisma.$disconnect();
  }
}

importProductsComplete();
