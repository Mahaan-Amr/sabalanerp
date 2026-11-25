import { ExactQuantityDecimal, exactQuantityText } from './exactQuantity';

export function calculateLogisticsLinearQuantity(
  khatRas: InstanceType<typeof ExactQuantityDecimal>,
  pieceCount: InstanceType<typeof ExactQuantityDecimal>,
  plus: InstanceType<typeof ExactQuantityDecimal>,
  minus: InstanceType<typeof ExactQuantityDecimal>,
) {
  return new ExactQuantityDecimal(exactQuantityText(khatRas.mul(pieceCount).plus(plus).minus(minus)));
}
