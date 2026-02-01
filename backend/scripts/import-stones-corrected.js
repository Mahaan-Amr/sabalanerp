const { PrismaClient } = require('@prisma/client');
const XLSX = require('xlsx');
const path = require('path');

const prisma = new PrismaClient();

// Color mapping for the color codes found in the Excel
const COLOR_MAPPING = {
  '00': '1', // Default white
  '01': '1', // White
  '02': '2', // Light Cream
  '03': '3', // Cream
  '04': '4', // Honey
  '05': '5', // Chocolate
  '06': '6', // Gray
  '07': '7', // Beige
  '08': '8', // Silver
  '09': '9', // Black
  '10': '10', // Red
  '11': '11', // Yellow
  '12': '12', // Blue
  '13': '13', // Peach
  '14': '14', // Plum
  '15': '15', // Tomato
  '16': '16', // Salt Pepper
  '17': '9', // Black (for مشکی)
  '18': '18', // Coffee
  '19': '19' // Turquoise
};

// Quality mapping - we'll use a default quality for now
const DEFAULT_QUALITY_CODE = '1';
const DEFAULT_QUALITY_NAME = 'Default';
const DEFAULT_QUALITY_NAME_PERSIAN = 'پیش‌فرض';

async function importStones() {
  try {
    console.log('🚀 Starting stone import from Excel...');
    
    // Read Excel file
    const excelPath = path.join(__dirname, '../../excel/kala-kod.xls');
    const workbook = XLSX.readFile(excelPath);
    const worksheet = workbook.Sheets['Sheet2'];
    const data = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
    
    console.log(`📊 Found ${data.length} rows in Sheet2`);
    
    // Filter out header row and empty rows
    const stoneRows = data.filter((row, index) => {
      return index > 0 && // Skip header
             row.length >= 15 && // Ensure we have enough columns
             row[0] && // Cut dimension exists
             row[1] && // Cut dimension code exists
             row[2] && // Stone material exists
             row[3] && // Stone material code exists
             row[4] && // Width exists
             row[5] && // Width code exists
             row[6] && // Thickness exists
             row[7] && // Thickness code exists
             row[8] && // Mine name exists
             row[9] && // Mine code exists
             row[10] && // Finish type exists
             row[11] && // Finish code exists
             row[14]; // Product code exists
    });
    
    console.log(`📊 Found ${stoneRows.length} valid stone rows`);
    
    let imported = 0;
    let skipped = 0;
    let errors = 0;
    
    // Get all master data for validation
    const [cutTypes, stoneMaterials, cutWidths, thicknesses, mines, finishTypes, colors] = await Promise.all([
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
    const cutWidthMap = new Map(cutWidths.map(cw => [cw.code, cw]));
    const thicknessMap = new Map(thicknesses.map(t => [t.code, t]));
    const mineMap = new Map(mines.map(m => [m.code, m]));
    const finishTypeMap = new Map(finishTypes.map(ft => [ft.code, ft]));
    const colorMap = new Map(colors.map(c => [c.code, c]));
    
    console.log('📊 Master data loaded:');
    console.log(`  - Cut Types: ${cutTypes.length}`);
    console.log(`  - Stone Materials: ${stoneMaterials.length}`);
    console.log(`  - Cut Widths: ${cutWidths.length}`);
    console.log(`  - Thicknesses: ${thicknesses.length}`);
    console.log(`  - Mines: ${mines.length}`);
    console.log(`  - Finish Types: ${finishTypes.length}`);
    console.log(`  - Colors: ${colors.length}`);
    
    for (let i = 0; i < stoneRows.length; i++) {
      const row = stoneRows[i];
      
      try {
        // Extract data from row using correct column mapping
        const cutDimension = row[0]?.toString().trim();
        const cutDimensionCode = row[1]?.toString().trim();
        const stoneMaterial = row[2]?.toString().trim();
        const stoneMaterialCode = row[3]?.toString().trim();
        const width = row[4]?.toString().trim();
        const widthCode = row[5]?.toString().trim();
        const thickness = row[6]?.toString().trim();
        const thicknessCode = row[7]?.toString().trim();
        const mineName = row[8]?.toString().trim();
        const mineCode = row[9]?.toString().trim();
        const finishType = row[10]?.toString().trim();
        const finishCode = row[11]?.toString().trim();
        const colorName = row[12]?.toString().trim();
        const colorCode = row[13]?.toString().trim();
        const productName = row[14]?.toString().trim();
        const productCode = row[15]?.toString().trim();
        
        // Skip if essential data is missing
        if (!cutDimension || !cutDimensionCode || !stoneMaterial || !stoneMaterialCode || 
            !width || !widthCode || !thickness || !thicknessCode || 
            !mineName || !mineCode || !finishType || !finishCode || !productCode) {
          console.log(`⚠️ Skipping row ${i + 2}: Missing essential data`);
          skipped++;
          continue;
        }
        
        // Map color code
        const mappedColorCode = colorCode ? COLOR_MAPPING[colorCode] || '1' : '1';
        
        // Get master data objects
        const cutType = cutTypeMap.get(cutDimensionCode);
        const stoneMaterialObj = stoneMaterialMap.get(stoneMaterialCode);
        const cutWidth = cutWidthMap.get(widthCode);
        const thicknessObj = thicknessMap.get(thicknessCode);
        const mine = mineMap.get(mineCode);
        const finishTypeObj = finishTypeMap.get(finishCode);
        const color = colorMap.get(mappedColorCode);
        
        // Debug logging for first few rows
        if (i < 5) {
          console.log(`🔍 Debug row ${i + 2}:`, {
            cutDimensionCode, cutType: !!cutType,
            stoneMaterialCode, stoneMaterialObj: !!stoneMaterialObj,
            widthCode, cutWidth: !!cutWidth,
            thicknessCode, thicknessObj: !!thicknessObj,
            mineCode, mine: !!mine,
            finishCode, finishTypeObj: !!finishTypeObj,
            mappedColorCode, color: !!color
          });
        }
        
        if (!cutType || !stoneMaterialObj || !cutWidth || !thicknessObj || !mine || !finishTypeObj || !color) {
          console.log(`⚠️ Skipping row ${i + 2}: Master data not found`, {
            cutDimensionCode, stoneMaterialCode, widthCode, thicknessCode, mineCode, finishCode, mappedColorCode
          });
          skipped++;
          continue;
        }
        
        // Check if product already exists
        const existingProduct = await prisma.product.findUnique({
          where: { code: productCode }
        });
        
        if (existingProduct) {
          console.log(`⚠️ Product ${productCode} already exists, skipping`);
          skipped++;
          continue;
        }
        
        // Create product
        const product = await prisma.product.create({
          data: {
            code: productCode,
            name: productName || `${stoneMaterialObj.name} ${cutWidth.name} ${thicknessObj.name}`,
            namePersian: productName || `${stoneMaterialObj.namePersian} ${cutWidth.namePersian} ${thicknessObj.namePersian}`,
            cuttingDimensionCode: cutDimensionCode,
            cuttingDimensionName: cutType.name || cutType.namePersian,
            cuttingDimensionNamePersian: cutType.namePersian,
            stoneTypeCode: stoneMaterialCode,
            stoneTypeName: stoneMaterialObj.name || stoneMaterialObj.namePersian,
            stoneTypeNamePersian: stoneMaterialObj.namePersian,
            widthCode: widthCode,
            widthValue: cutWidth.value,
            widthName: cutWidth.name || cutWidth.namePersian,
            thicknessCode: thicknessCode,
            thicknessValue: thicknessObj.value,
            thicknessName: thicknessObj.name || thicknessObj.namePersian,
            mineCode: mineCode,
            mineName: mine.name || mine.namePersian,
            mineNamePersian: mine.namePersian,
            finishCode: finishCode,
            finishName: finishTypeObj.name || finishTypeObj.namePersian,
            finishNamePersian: finishTypeObj.namePersian,
            colorCode: mappedColorCode,
            colorName: color.name || color.namePersian,
            colorNamePersian: color.namePersian,
            qualityCode: DEFAULT_QUALITY_CODE,
            qualityName: DEFAULT_QUALITY_NAME,
            qualityNamePersian: DEFAULT_QUALITY_NAME_PERSIAN,
            basePrice: null, // Will be set later
            currency: 'تومان',
            isAvailable: true,
            isActive: true,
            description: `سنگ ${stoneMaterialObj.namePersian} ${cutType.namePersian} ${cutWidth.namePersian} ${thicknessObj.namePersian} ${mine.namePersian} ${finishTypeObj.namePersian}${colorName ? ` ${colorName}` : ''}`
          }
        });
        
        console.log(`✅ Imported: ${product.code} - ${product.namePersian}`);
        imported++;
        
      } catch (error) {
        console.error(`❌ Error importing row ${i + 2}:`, error.message);
        errors++;
      }
    }
    
    console.log('\n📊 Stone Import Summary:');
    console.log(`✅ Successfully imported: ${imported} products`);
    console.log(`⚠️ Skipped: ${skipped} products`);
    console.log(`❌ Errors: ${errors} products`);
    console.log('🎉 Stone import completed!');
    
  } catch (error) {
    console.error('❌ Stone import failed:', error);
  } finally {
    await prisma.$disconnect();
  }
}

// Run the import
importStones();
