import type { ContractProduct, ContractServiceRow, PaymentMethod } from '../types/contract.types';
import { validatePayment } from '../services/validationService';
import { getContractPayableTotal, getContractUnroundedPayableTotal } from './contractProductPricing';
import { roundContractPayableTotal } from '@sabalanerp/contract-product-graph';

export const prepareContractSubmissionFinancials = (
  products: ContractProduct[],
  serviceRows: ContractServiceRow[],
  discountAmount: number,
  payment: PaymentMethod,
  existingContract: boolean,
  applyMonetaryRounding = true
) => {
  const monetaryRounding = applyMonetaryRounding ? roundContractPayableTotal(
    getContractUnroundedPayableTotal(products, serviceRows, discountAmount), payment.currency) : undefined;
  const totalAmount = getContractPayableTotal(products, serviceRows, discountAmount, applyMonetaryRounding);
  const normalizedPayment = { ...payment, totalContractAmount: totalAmount };
  return {
    totalAmount,
    monetaryRounding,
    payment: normalizedPayment,
    validation: validatePayment(normalizedPayment, totalAmount, existingContract)
  };
};
