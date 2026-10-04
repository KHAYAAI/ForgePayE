import { ComingLater } from '../../_coming-later';

export default function PaymentsProductPage() {
  return (
    <ComingLater
      name="Forge Payments"
      summary="Card, bank and stablecoin payments for merchants. Not open yet: payments launch only after licensing."
      built={[
        'Stablecoin deposits and payouts in USDC on Base, used today by the Credit Bureau for its own billing',
        'Crypto invoices in BTC, ETH, LTC and XMR (in development)',
        'Card routing through the Hyperswitch payment engine (not yet connected to a card acquirer)',
        'Tax calculation for checkout (in development; not a Merchant of Record service)',
      ]}
      before={[
        'The licences South African law requires to process payments for other businesses',
        'Card acquirer and bank connections, and settlement to merchants',
        'An independent security review',
        'PCI DSS certification (none is held today)',
      ]}
    />
  );
}
