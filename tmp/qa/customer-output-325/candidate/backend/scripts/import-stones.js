const { PrismaClient } = require('@prisma/client');
const XLSX = require('xlsx');
const path = require('path');

const prisma = new PrismaClient();

// Mapping functions for Excel data to master data codes
const CUT_DIMENSION_MAPPING = {
  'تایل': '2',
  'طولی': '1',
  'حجمی': '3'
};

const STONE_MATERIAL_MAPPING = {
  'کریستال': '3',
  'مرمریت': '2',
  'تراورتن': '1',
  'گرانیت': '4',
  'بازالت': '5',
  'لایمستون': '6',
  'آندوزیت': '7',
  'ترااونیکس': '8',
  'ترامیت': '9',
  'سند استون': '10',
  'اونیکس': '11',
  'آلاباستر': '12'
};

const WIDTH_MAPPING = {
  'ع10': '1',
  'ع15': '2',
  'ع20': '3',
  'ع25': '4',
  'ع30': '5',
  'ع35': '6',
  'ع40': '7',
  'ع50': '8',
  'ع60': '9',
  'ع70': '10',
  'ع80': '11'
};

const THICKNESS_MAPPING = {
  'ض2': '1',
  'ض3': '2',
  'ض4': '3',
  'ض5': '4',
  'ض6': '5'
};

const FINISH_MAPPING = {
  'صیقل': '01',
  'خام': '02',
  'ساب صفر': '03',
  'چرمی': '04',
  'هوند': '05',
  'فلیم': '06',
  'اسکراچ': '07',
  'شیار': '08',
  'سند بلاست': '09',
  'تیشه': '10',
  'بوش همر': '11',
  'کات همر': '12',
  'کات بروکن': '13'
};

// Mine mapping - this will be more complex as we need to match names
const MINE_MAPPING = {
  'ازنا': '010',
  'الیگودرز': '052',
  'آیس اسکای': '054',
  'جوشقان': '063',
  'قروه': '095',
  'نی ریز': '011',
  'ابریشم': '046',
  'اداوی': '048',
  'اسپایدر': '042',
  'آباده': '044',
  'عباس آباد': '001',
  'یزد': '002',
  'کاشان': '003',
  'نطنز': '004',
  'مشهد': '005',
  'نهبندان': '006',
  'مروارید': '007',
  'خوی': '008',
  'سلماس': '009',
  'آذر شهر': '021',
  'قروه': '023',
  'ارسنجان': '025',
  'بوانات': '026',
  'بهسنگان': '027',
  'پرشین سیلک': '028',
  'پرنس': '029',
  'پلادیوم': '030',
  'تورنادو': '031',
  'جیرفت': '032',
  'خرم آباد': '033',
  'خوبسنگان': '034',
  'دراگون': '035',
  'دهبید': '036',
  'رویال': '037',
  'سنندج': '038',
  'سیمکان': '039',
  'شهیادی': '040',
  'کوبیسم': '041',
  'گلدن بیوتی': '042',
  'گندمک': '043',
  'گوهره خرم آباد': '044',
  'لاشتر': '045',
  'مارفیل': '046',
  'مراغه': '047',
  'مهکام': '048',
  'نجف آباد': '049',
  'هرسین': '050',
  'الموت': '051',
  'تایباد': '052',
  'تویسرکان': '053',
  'چینی': '054',
  'خرم دره': '055',
  'زاهدان': '056',
  'زنجان': '057',
  'سبز جنگلی': '058',
  'شقایق': '059',
  'مروارید': '060',
  'بوکان': '061',
  'سمیرم': '062',
  'نقده': '063',
  'حاجی آباد': '064',
  'خلخال': '065',
  'دره بخاری': '066',
  'رامشه': '067',
  'طبس': '068',
  'طرق': '069',
  'ماکو': '070',
  'ابیانه': '071',
  'آتشکوه': '072',
  'پرهام': '073',
  'تکاب': '074',
  'یزد دهشیر': '075',
  'لوشان': '076',
  'آبگرم': '077'
};

// Color mapping - most entries don't have colors, so we'll use a default
const DEFAULT_COLOR_CODE = '1'; // White
const DEFAULT_QUALITY_CODE = '1'; // Default quality

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
             row.length >= 9 && // Ensure we have enough columns
             row[0] && // Cut dimension exists
             row[1] && // Stone material exists
             row[8]; // Product code exists
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
        // Extract data from row
        const cutDimension = row[0]?.toString().trim();
        const stoneMaterial = row[1]?.toString().trim();
        const widthText = row[2]?.toString().trim();
        const thicknessText = row[3]?.toString().trim();
        const mineName = row[4]?.toString().trim();
        const finishType = row[5]?.toString().trim();
        const colorText = row[6]?.toString().trim();
        const productName = row[7]?.toString().trim();
        const productCode = row[8]?.toString().trim();
        
        // Skip if essential data is missing
        if (!cutDimension || !stoneMaterial || !widthText || !thicknessText || !mineName || !finishType || !productCode) {
          console.log(`⚠️ Skipping row ${i + 2}: Missing essential data`);
          skipped++;
          continue;
        }
        
        // Map to codes
        const cutDimensionCode = CUT_DIMENSION_MAPPING[cutDimension];
        const stoneMaterialCode = STONE_MATERIAL_MAPPING[stoneMaterial];
        const widthCode = WIDTH_MAPPING[widthText];
        const thicknessCode = THICKNESS_MAPPING[thicknessText];
        const mineCode = MINE_MAPPING[mineName];
        const finishCode = FINISH_MAPPING[finishType];
        const colorCode = colorText ? '1' : DEFAULT_COLOR_CODE; // Use white as default if no color
        
        // Validate mappings
        if (!cutDimensionCode || !stoneMaterialCode || !widthCode || !thicknessCode || !mineCode || !finishCode) {
          console.log(`⚠️ Skipping row ${i + 2}: Invalid mapping`, {
            cutDimension, stoneMaterial, widthText, thicknessText, mineName, finishType,
            cutDimensionCode, stoneMaterialCode, widthCode, thicknessCode, mineCode, finishCode
          });
          skipped++;
          continue;
        }
        
        // Get master data objects
        const cutType = cutTypeMap.get(cutDimensionCode);
        const stoneMaterialObj = stoneMaterialMap.get(stoneMaterialCode);
        const cutWidth = cutWidthMap.get(widthCode);
        const thickness = thicknessMap.get(thicknessCode);
        const mine = mineMap.get(mineCode);
        const finishTypeObj = finishTypeMap.get(finishCode);
        const color = colorMap.get(colorCode);
        
        if (!cutType || !stoneMaterialObj || !cutWidth || !thickness || !mine || !finishTypeObj || !color) {
          console.log(`⚠️ Skipping row ${i + 2}: Master data not found`, {
            cutDimensionCode, stoneMaterialCode, widthCode, thicknessCode, mineCode, finishCode, colorCode
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
            name: productName || `${stoneMaterialObj.name} ${cutWidth.name} ${thickness.name}`,
            namePersian: productName || `${stoneMaterialObj.namePersian} ${cutWidth.namePersian} ${thickness.namePersian}`,
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
            thicknessValue: thickness.value,
            thicknessName: thickness.name || thickness.namePersian,
            mineCode: mineCode,
            mineName: mine.name || mine.namePersian,
            mineNamePersian: mine.namePersian,
            finishCode: finishCode,
            finishName: finishTypeObj.name || finishTypeObj.namePersian,
            finishNamePersian: finishTypeObj.namePersian,
            colorCode: colorCode,
            colorName: color.name || color.namePersian,
            colorNamePersian: color.namePersian,
            qualityCode: DEFAULT_QUALITY_CODE,
            qualityName: 'Default',
            qualityNamePersian: 'پیش‌فرض',
            basePrice: null, // Will be set later
            currency: 'تومان',
            isAvailable: true,
            isActive: true,
            description: `سنگ ${stoneMaterialObj.namePersian} ${cutType.namePersian} ${cutWidth.namePersian} ${thickness.namePersian} ${mine.namePersian} ${finishTypeObj.namePersian}`
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
