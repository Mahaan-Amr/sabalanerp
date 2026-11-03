import assert from 'node:assert/strict';
import { expandPersianSearchTokenVariants, normalizePersianSearchTokens } from '../crmCustomerSearch';

assert.deepEqual(normalizePersianSearchTokens(' فريبا\u200c\u200cپور شهيد '), ['فریبا', 'پور', 'شهید']);
assert.deepEqual(normalizePersianSearchTokens('۰۹۱۷ ۱۲۳ ۴۵۶۷'), ['0917', '123', '4567']);
assert.deepEqual(expandPersianSearchTokenVariants('یعقوبی'), ['یعقوبی', 'يعقوبی', 'یعقوبي', 'يعقوبي']);

console.log('CRM customer search tests passed');
