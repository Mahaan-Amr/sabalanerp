import { ErpPresentationProvider } from '@/components/erp';
import { CustomerTransferTracking } from '@/features/partner-sales/customers/CustomerTransferTracking';

export default function PartnerCustomerTransfersPage() {
  return <ErpPresentationProvider scope="workspace"><CustomerTransferTracking /></ErpPresentationProvider>;
}
