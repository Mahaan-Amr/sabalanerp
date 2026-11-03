const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function verifyImport() {
  try {
    console.log('🔍 Verifying import results...');
    
    // Count master data
    const [cutTypes, stoneMaterials, widths, thicknesses, mines, finishTypes, colors, products] = await Promise.all([
      prisma.cutType.count(),
      prisma.stoneMaterial.count(),
      prisma.cutWidth.count(),
      prisma.thickness.count(),
      prisma.mine.count(),
      prisma.finishType.count(),
      prisma.color.count(),
      prisma.product.count()
    ]);
    
    console.log('\n📊 Master Data Counts:');
    console.log(`  - Cut Types: ${cutTypes}`);
    console.log(`  - Stone Materials: ${stoneMaterials}`);
    console.log(`  - Widths: ${widths}`);
    console.log(`  - Thicknesses: ${thicknesses}`);
    console.log(`  - Mines: ${mines}`);
    console.log(`  - Finish Types: ${finishTypes}`);
    console.log(`  - Colors: ${colors}`);
    console.log(`  - Products: ${products}`);
    
    // Show sample products
    console.log('\n📦 Sample Products:');
    const sampleProducts = await prisma.product.findMany({
      take: 5,
      select: {
        code: true,
        namePersian: true,
        cuttingDimensionNamePersian: true,
        stoneTypeNamePersian: true,
        widthName: true,
        thicknessName: true,
        mineNamePersian: true,
        finishNamePersian: true,
        colorNamePersian: true
      }
    });
    
    sampleProducts.forEach((product, index) => {
      console.log(`\n${index + 1}. ${product.namePersian}`);
      console.log(`   Code: ${product.code}`);
      console.log(`   Cut Type: ${product.cuttingDimensionNamePersian}`);
      console.log(`   Stone: ${product.stoneTypeNamePersian}`);
      console.log(`   Width: ${product.widthName}`);
      console.log(`   Thickness: ${product.thicknessName}`);
      console.log(`   Mine: ${product.mineNamePersian}`);
      console.log(`   Finish: ${product.finishNamePersian}`);
      console.log(`   Color: ${product.colorNamePersian}`);
    });
    
    console.log('\n✅ Import verification completed!');
    
  } catch (error) {
    console.error('❌ Error verifying import:', error);
  } finally {
    await prisma.$disconnect();
  }
}

verifyImport();
