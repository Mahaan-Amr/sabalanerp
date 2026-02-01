const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function seedCuttingTypes() {
  console.log('🌱 Seeding cutting types...');
  
  try {
    // Check if cutting types already exist
    const existingCount = await prisma.cuttingType.count();
    if (existingCount > 0) {
      console.log(`✅ Cutting types already exist (${existingCount} found). Skipping seed.`);
      return;
    }

    // Create the two main cutting types
    const cuttingTypes = [
      {
        code: 'LONG',
        name: 'Longitudinal Cut',
        namePersian: 'برش طولی',
        description: 'Used when customer wants width smaller than product\'s original width',
        isActive: true
      },
      {
        code: 'CROSS',
        name: 'Cross Cut',
        namePersian: 'برش عرضی',
        description: 'Used when customer wants specific dimensions (e.g., 40×60) from a longitudinal product',
        isActive: true
      }
    ];

    for (const cuttingType of cuttingTypes) {
      await prisma.cuttingType.create({
        data: cuttingType
      });
      console.log(`✅ Created cutting type: ${cuttingType.namePersian} (${cuttingType.code})`);
    }

    console.log('🎉 Cutting types seeded successfully!');
  } catch (error) {
    console.error('❌ Error seeding cutting types:', error);
  } finally {
    await prisma.$disconnect();
  }
}

seedCuttingTypes();
