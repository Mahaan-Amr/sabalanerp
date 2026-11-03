const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function clearDatabase() {
  try {
    console.log('🧹 Clearing database from products and master data...');
    
    // Delete in correct order to avoid foreign key constraints
    console.log('🗑️ Deleting products...');
    await prisma.product.deleteMany();
    
    console.log('🗑️ Deleting master data...');
    await prisma.color.deleteMany();
    await prisma.finishType.deleteMany();
    await prisma.mine.deleteMany();
    await prisma.thickness.deleteMany();
    await prisma.cutWidth.deleteMany();
    await prisma.stoneMaterial.deleteMany();
    await prisma.cutType.deleteMany();
    
    console.log('✅ Database cleared successfully!');
    
  } catch (error) {
    console.error('❌ Error clearing database:', error);
  } finally {
    await prisma.$disconnect();
  }
}

clearDatabase();
