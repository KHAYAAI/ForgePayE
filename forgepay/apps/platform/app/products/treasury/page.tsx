import { ComingLater } from '../../_coming-later';

export default function TreasuryProductPage() {
  return (
    <ComingLater
      name="Forge Treasury"
      summary="Cash visibility, intercompany netting and approval rules for finance teams. In development; not open yet."
      built={[
        'Treasury rules, intercompany netting and approval logic',
        'A forecasting model for cash flows (in development)',
      ]}
      before={[
        'Real bank and wallet connections for balances and transfers',
        'Separate data for each customer organisation',
        'Licensing for moving or investing customer funds',
        'An independent security review',
      ]}
    />
  );
}
