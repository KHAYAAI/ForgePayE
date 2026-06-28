import Link from 'next/link';

export default function APIReferencePage() {
  return (
    <div>
      {/* Navigation */}
      <nav style={{ position: 'fixed', top: 0, width: '100%', background: 'rgba(255, 255, 255, 0.98)', borderBottom: '1px solid #eee', padding: '16px 40px', zIndex: 1000 }}>
        <div style={{ maxWidth: 1400, margin: '0 auto', display: 'flex', justifyContent: 'space-between' }}>
          <Link href="/" style={{ fontSize: 20, fontWeight: 700, color: 'var(--navy)', textDecoration: 'none' }}>
            Forge<span style={{ color: 'var(--cyan)' }}>Pay</span>
          </Link>
          <Link href="/auth/signup" className="btn-primary">Start Trial</Link>
        </div>
      </nav>

      {/* Header */}
      <section style={{ padding: '120px 40px 60px', textAlign: 'center', marginTop: 60 }}>
        <h1 style={{ fontSize: 42, fontWeight: 700, marginBottom: 16, color: 'var(--navy)' }}>📚 API Reference</h1>
        <p style={{ fontSize: 18, color: 'var(--text-light)' }}>Complete documentation for ForgePay REST APIs</p>
      </section>

      {/* Content */}
      <section style={{ maxWidth: 1000, margin: '0 auto', padding: '0 40px 100px' }}>
        {/* Authentication */}
        <APISection title="Authentication">
          <p>All API requests require authentication via API key. Include it in the Authorization header:</p>
          <CodeBlock>{`curl -H "Authorization: Bearer YOUR_API_KEY" https://api.forgepay.co.za/v1/payments`}</CodeBlock>
        </APISection>

        {/* Endpoints */}
        <APISection title="Payments Endpoint">
          <Endpoint
            method="POST"
            path="/v1/payments"
            description="Create a payment"
            body={`{
  "amount": 50000,
  "currency": "ZAR",
  "customer_id": "cust_123",
  "description": "Order #1234"
}`}
          />
          <Endpoint
            method="GET"
            path="/v1/payments/{payment_id}"
            description="Retrieve a payment"
            response={`{
  "id": "pay_123",
  "amount": 50000,
  "status": "succeeded",
  "method": "card",
  "created_at": "2026-06-28T10:30:00Z"
}`}
          />
        </APISection>

        {/* Subscriptions */}
        <APISection title="Subscriptions Endpoint">
          <Endpoint
            method="POST"
            path="/v1/subscriptions"
            description="Create a subscription"
            body={`{
  "customer_id": "cust_123",
  "product": "payments",
  "plan": "payments-growth"
}`}
          />
          <Endpoint
            method="PUT"
            path="/v1/subscriptions/{sub_id}"
            description="Upgrade a subscription"
            body={`{
  "plan": "payments-growth"
}`}
          />
          <Endpoint
            method="DELETE"
            path="/v1/subscriptions/{sub_id}"
            description="Cancel a subscription"
          />
        </APISection>

        {/* Credit Scores */}
        <APISection title="Credit Scores Endpoint">
          <Endpoint
            method="POST"
            path="/v1/credit-inquiries"
            description="Request a credit score"
            body={`{
  "customer_id": "cust_123",
  "purpose": "lending",
  "requested_date": "2026-06-28"
}`}
          />
          <Endpoint
            method="GET"
            path="/v1/credit-scores/{customer_id}"
            description="Get credit scores"
            response={`{
  "customer_id": "cust_123",
  "mode_1": {
    "score": 68,
    "factors": {
      "payment_history": 0.40,
      "volume": 0.30,
      "age": 0.20,
      "risk": 0.10
    }
  },
  "mode_2": {
    "score": 72,
    "factors": {
      "success_rate": 0.35,
      "volume": 0.30,
      "compliance": 0.20,
      "age": 0.15
    }
  },
  "variance_explanation": "Mode 2 higher due to strong on-chain success rate"
}`}
          />
        </APISection>

        {/* Webhooks */}
        <APISection title="Webhooks">
          <p>ForgePay sends webhooks for important events. Configure your webhook URL in Settings.</p>
          <div style={{ background: '#f9f9f9', padding: 16, borderRadius: 8, marginTop: 12 }}>
            <strong style={{ display: 'block', marginBottom: 8 }}>Events:</strong>
            <ul style={{ marginLeft: 20, color: 'var(--text-light)' }}>
              <li>payment.completed</li>
              <li>payment.failed</li>
              <li>subscription.created</li>
              <li>subscription.upgraded</li>
              <li>subscription.cancelled</li>
              <li>settlement.completed</li>
            </ul>
          </div>
        </APISection>

        {/* Error Handling */}
        <APISection title="Error Handling">
          <p>Errors return HTTP status codes with a JSON body:</p>
          <CodeBlock>{`{
  "error": {
    "code": "invalid_amount",
    "message": "Amount must be greater than 0"
  }
}`}</CodeBlock>
          <div style={{ marginTop: 16 }}>
            <strong>Status Codes:</strong>
            <ul style={{ marginLeft: 20, marginTop: 8, color: 'var(--text-light)' }}>
              <li>200 – Success</li>
              <li>400 – Bad Request</li>
              <li>401 – Unauthorized</li>
              <li>403 – Forbidden</li>
              <li>404 – Not Found</li>
              <li>429 – Rate Limited</li>
              <li>500 – Server Error</li>
            </ul>
          </div>
        </APISection>

        {/* Rate Limiting */}
        <APISection title="Rate Limiting">
          <p>
            API rate limits are 1000 requests per minute per API key. Rate limit info is included in response headers:
          </p>
          <CodeBlock>{`X-RateLimit-Limit: 1000
X-RateLimit-Remaining: 999
X-RateLimit-Reset: 1234567890`}</CodeBlock>
        </APISection>

        {/* SDK Examples */}
        <APISection title="SDK Examples">
          <div style={{ background: '#f9f9f9', padding: 16, borderRadius: 8 }}>
            <strong style={{ display: 'block', marginBottom: 8 }}>Node.js</strong>
            <CodeBlock>{`const forgepay = require('@forgepay/sdk');
const client = new forgepay.Client('api_key_xxx');

// Create payment
const payment = await client.payments.create({
  amount: 50000,
  currency: 'ZAR',
  customer_id: 'cust_123'
});`}</CodeBlock>
          </div>
        </APISection>
      </section>

      {/* Footer */}
      <footer style={{ background: 'var(--navy)', color: 'white', textAlign: 'center', padding: '40px' }}>
        <p>Full API docs: <a href="https://docs.forgepay.co.za" style={{ color: 'var(--cyan)', textDecoration: 'none' }}>docs.forgepay.co.za</a></p>
      </footer>
    </div>
  );
}

function APISection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 48, paddingBottom: 48, borderBottom: '1px solid #eee' }}>
      <h2 style={{ fontSize: 24, fontWeight: 600, marginBottom: 16, color: 'var(--navy)' }}>
        {title}
      </h2>
      <div style={{ color: 'var(--text-light)', lineHeight: 1.8 }}>
        {children}
      </div>
    </div>
  );
}

function Endpoint({
  method,
  path,
  description,
  body,
  response,
}: {
  method: string;
  path: string;
  description: string;
  body?: string;
  response?: string;
}) {
  const methodColor = method === 'POST' ? '#4ECDC4' : method === 'PUT' ? '#FFA500' : method === 'DELETE' ? '#FF6B6B' : '#4ECB60';

  return (
    <div style={{ background: '#f9f9f9', padding: 16, borderRadius: 8, marginBottom: 16, borderLeft: `4px solid ${methodColor}` }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
        <span
          style={{
            padding: '4px 10px',
            background: methodColor,
            color: 'white',
            borderRadius: 4,
            fontWeight: 600,
            fontSize: 12,
          }}
        >
          {method}
        </span>
        <code style={{ fontSize: 14, fontWeight: 600 }}>{path}</code>
      </div>
      <p style={{ color: 'var(--text-light)', fontSize: 13, marginBottom: 12 }}>{description}</p>
      {body && (
        <>
          <strong style={{ display: 'block', marginBottom: 6, fontSize: 13 }}>Request:</strong>
          <CodeBlock>{body}</CodeBlock>
        </>
      )}
      {response && (
        <>
          <strong style={{ display: 'block', marginBottom: 6, fontSize: 13 }}>Response:</strong>
          <CodeBlock>{response}</CodeBlock>
        </>
      )}
    </div>
  );
}

function CodeBlock({ children }: { children: string }) {
  return (
    <pre
      style={{
        background: '#1a1a1a',
        color: '#00F0FF',
        padding: 12,
        borderRadius: 6,
        overflow: 'auto',
        fontSize: 12,
        fontFamily: 'monospace',
        marginBottom: 12,
      }}
    >
      {children}
    </pre>
  );
}
