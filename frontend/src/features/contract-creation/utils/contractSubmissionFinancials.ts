import type { ContractProduct, ContractServiceRow, PaymentMethod } from '../types/contract.types';
import { validatePayment } from '../services/validationService';
import { getContractPayableTotal } from './contractProductPricing';

export const prepareContractSubmissionFinancials = (
  products: ContractProduct[],
  serviceRows: ContractServiceRow[],
  discountAmount: number,
  payment: PaymentMethod,
  existingContract: boolean
) => {
  const totalAmount = getContractPayableTotal(products, serviceRows, discountAmount);
  const normalizedPayment = { ...payment, totalContractAmount: totalAmount };
  return {
    totalAmount,
    payment: normalizedPayment,
    validation: validatePayment(normalizedPayment, totalAmount, existingContract)
  };
};
