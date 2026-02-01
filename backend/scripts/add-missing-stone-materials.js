const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

// Missing stone material codes from Excel that need to be added
const missingMaterials = [
  { code: '02', name: 'Unknown Material 02', namePersian: 'مواد ناشناخته 02' }
];

async function addMissingMaterials() {
  try {
    console.log('🚀 Adding missing stone material codes...');
    
    let addedCount = 0;
    
    for (const material of missingMaterials) {
      try {
        await prisma.stoneMaterial.create({
          data: {
            code: material.code,
            name: material.name,
            namePersian: material.namePersian,
            isActive: true
          }
        });
        console.log(`✅ Added stone material: ${material.code} - ${material.namePersian}`);
        addedCount++;
      } catch (error) {
        if (error.code === 'P2002') {
          console.log(`⚠️ Stone material ${material.code} already exists, skipping`);
        } else {
          console.error(`❌ Error adding stone material ${material.code}:`, error.message);
        }
      }
    }
    
    console.log(`\n📊 Summary: Added ${addedCount} new stone material codes`);
    
  } catch (error) {
    console.error('Error adding missing stone materials:', error);
  } finally {
    await prisma.$disconnect();
  }
}

addMissingMaterials();
