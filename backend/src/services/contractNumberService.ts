// Contract number generation service
// Handles contract number generation with gap-filling logic

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * Get user prefix from firstName and lastName (first 3 letters)
 * Example: "Mahaan Amirian" -> "MAH"
 */
export function getUserPrefix(firstName: string, lastName: string): string {
  // Get first 3 letters from firstName, uppercase
  const firstNamePrefix = (firstName || '').substring(0, 3).toUpperCase();
  
  // If firstName has less than 3 letters, fill from lastName
  if (firstNamePrefix.length < 3 && lastName) {
    const needed = 3 - firstNamePrefix.length;
    const lastNamePrefix = (lastName || '').substring(0, needed).toUpperCase();
    return (firstNamePrefix + lastNamePrefix).substring(0, 3);
  }
  
  // If no firstName, use lastName
  if (!firstName && lastName) {
    return (lastName || '').substring(0, 3).toUpperCase();
  }
  
  // Fallback to "USR" if no name available
  return firstNamePrefix || 'USR';
}

/**
 * Extract numeric part from contract number
 */
function extractNumeric(contractNumber: string): number {
  // Handle USER-000001 format (e.g., MAH-000001)
  const prefixMatch = contractNumber.match(/^[A-Z]{3}-(\d+)$/);
  if (prefixMatch) return parseInt(prefixMatch[1]);
  
  // Handle legacy SAL-000001 format (for backward compatibility)
  const salMatch = contractNumber.match(/SAL-(\d+)/);
  if (salMatch) return parseInt(salMatch[1]);
  
  // Handle plain number format
  const match = contractNumber.match(/\d+/);
  return match ? parseInt(match[0]) : 0;
}

/**
 * Generate next contract number for a user with gap-filling logic
 */
export async function generateContractNumber(userId: string): Promise<string> {
  // Get user information to generate user-specific prefix
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { firstName: true, lastName: true }
  });

  if (!user) {
    throw new Error('User not found');
  }

  // Generate user prefix (first 3 letters of firstName)
  const userPrefix = getUserPrefix(user.firstName || '', user.lastName || '');
  
  // Get all existing contract numbers for this user (matching the prefix)
  const existingContracts = await prisma.salesContract.findMany({
    where: {
      contractNumber: {
        startsWith: userPrefix + '-'
      }
    },
    select: { contractNumber: true },
    orderBy: { contractNumber: 'asc' }
  });

  // Get all existing numbers as integers for this user
  const existingNumbers = existingContracts
    .map(contract => extractNumeric(contract.contractNumber))
    .filter(num => num >= 1) // Consider all numbers >= 1
    .sort((a, b) => a - b);

  console.log(`Existing contract numbers for user ${userPrefix}:`, existingNumbers);

  // Find the first gap or next number
  let nextNumber = 1; // Start from 1
  
  if (existingNumbers.length === 0) {
    // No contracts exist for this user, start with 1
    nextNumber = 1;
  } else {
    // Find the first gap in the sequence
    for (let i = 0; i < existingNumbers.length; i++) {
      const expectedNumber = i + 1;
      if (existingNumbers[i] !== expectedNumber) {
        nextNumber = expectedNumber;
        break;
      }
    }
    
    // If no gap found, use the next number after the highest
    if (nextNumber === 1 && existingNumbers.length > 0) {
      nextNumber = Math.max(...existingNumbers) + 1;
    }
  }

  // Format as USER-000001 (e.g., MAH-000001)
  const contractNumber = `${userPrefix}-${String(nextNumber).padStart(6, '0')}`;
  
  console.log(`Next contract number for user ${userPrefix}:`, contractNumber);

  return contractNumber;
}

/**
 * Get next contract number (alias for generateContractNumber)
 */
export async function getNextContractNumber(userId: string): Promise<string> {
  return generateContractNumber(userId);
}

/**
 * Validate contract number format
 */
export function validateContractNumber(contractNumber: string): boolean {
  // Format: USER-000001 (3 uppercase letters, dash, 6 digits)
  const pattern = /^[A-Z]{3}-\d{6}$/;
  return pattern.test(contractNumber);
}

