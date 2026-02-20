import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function seedSecurityData() {
  console.log('Seeding security data...');

  try {
    // Create default shifts
    const dayShift = await prisma.shift.upsert({
      where: { name: 'Day' },
      update: {},
      create: {
        name: 'Day',
        namePersian: 'شیفت روز',
        startTime: '07:00',
        endTime: '19:00',
        duration: 12,
        isActive: true
      }
    });

    const nightShift = await prisma.shift.upsert({
      where: { name: 'Night' },
      update: {},
      create: {
        name: 'Night',
        namePersian: 'شیفت شب',
        startTime: '19:00',
        endTime: '07:00',
        duration: 12,
        isActive: true
      }
    });

    console.log('Default shifts created:', {
      dayShift: dayShift.namePersian,
      nightShift: nightShift.namePersian
    });

    // Find admin user to assign as security personnel
    const adminUser = await prisma.user.findFirst({
      where: { role: 'ADMIN' }
    });

    if (adminUser) {
      // Assign admin as security supervisor for day shift
      await prisma.securityPersonnel.upsert({
        where: { userId: adminUser.id },
        update: {},
        create: {
          userId: adminUser.id,
          shiftId: dayShift.id,
          position: 'سرپرست حراست',
          isActive: true
        }
      });

      console.log('Admin assigned as security supervisor');
    }

    console.log('Security data seeded successfully!');
  } catch (error) {
    console.error('Error seeding security data:', error);
    throw error;
  }
}

export default seedSecurityData;

