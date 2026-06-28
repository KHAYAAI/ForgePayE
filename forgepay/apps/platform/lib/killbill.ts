import axios, { AxiosInstance } from 'axios';

const KB_API_KEY = process.env.KILLBILL_API_KEY || '';
const KB_API_SECRET = process.env.KILLBILL_API_SECRET || '';
const KB_BASE_URL = process.env.KILLBILL_BASE_URL || 'http://killbill:8080';
const KB_TENANT_ID = process.env.KILLBILL_TENANT_ID || 'default-tenant';

export interface KBAccount {
  accountId: string;
  email: string;
  name: string;
  currency: string;
  createdDate: string;
}

export interface KBSubscription {
  subscriptionId: string;
  accountId: string;
  productName: string;
  planName: string;
  priceListName: string;
  state: 'PENDING' | 'ACTIVE' | 'CANCELLED' | 'PAUSED';
  startDate: string;
  effectiveEndDate?: string;
  chargedThroughDate?: string;
  billingStartDate?: string;
  billingEndDate?: string;
}

export interface KBInvoice {
  invoiceId: string;
  accountId: string;
  invoiceNumber: number;
  invoiceDate: string;
  targetDate: string;
  amount: number;
  balance: number;
  status: 'DRAFT' | 'COMMITTED' | 'VOID';
  items: KBInvoiceItem[];
}

export interface KBInvoiceItem {
  invoiceItemId: string;
  subscriptionId: string;
  planName: string;
  amount: number;
  startDate: string;
  endDate: string;
}

class KillBillClient {
  private client: AxiosInstance;

  constructor() {
    this.client = axios.create({
      baseURL: KB_BASE_URL,
      headers: {
        'X-Killbill-ApiKey': KB_API_KEY,
        'X-Killbill-ApiSecret': KB_API_SECRET,
        'X-Killbill-TenantId': KB_TENANT_ID,
        'Content-Type': 'application/json',
      },
      timeout: 10000,
    });
  }

  async createAccount(email: string, name: string, currency: string = 'ZAR'): Promise<KBAccount> {
    try {
      const response = await this.client.post('/accounts', {
        email,
        name,
        currency,
        externalKey: `cust-${Date.now()}`,
      });
      return response.data;
    } catch (error) {
      console.error('Kill Bill create account error:', error);
      throw new Error('Failed to create Kill Bill account');
    }
  }

  async createSubscription(
    accountId: string,
    productName: string,
    planName: string
  ): Promise<KBSubscription> {
    try {
      const response = await this.client.post(
        `/accounts/${accountId}/subscriptions`,
        {
          accountId,
          productName,
          planName,
          externalKey: `sub-${Date.now()}`,
        }
      );
      return response.data;
    } catch (error) {
      console.error('Kill Bill create subscription error:', error);
      throw new Error('Failed to create subscription');
    }
  }

  async getSubscription(subscriptionId: string): Promise<KBSubscription> {
    try {
      const response = await this.client.get(`/subscriptions/${subscriptionId}`);
      return response.data;
    } catch (error) {
      console.error('Kill Bill get subscription error:', error);
      throw new Error('Failed to fetch subscription');
    }
  }

  async getAccountSubscriptions(accountId: string): Promise<KBSubscription[]> {
    try {
      const response = await this.client.get(`/accounts/${accountId}/subscriptions`);
      return Array.isArray(response.data) ? response.data : [];
    } catch (error) {
      console.error('Kill Bill get account subscriptions error:', error);
      throw new Error('Failed to fetch account subscriptions');
    }
  }

  async upgradeSubscription(
    subscriptionId: string,
    planName: string,
    requestedDate?: string
  ): Promise<KBSubscription> {
    try {
      const response = await this.client.put(
        `/subscriptions/${subscriptionId}`,
        {
          planName,
          requestedDate: requestedDate || new Date().toISOString().split('T')[0],
        }
      );
      return response.data;
    } catch (error) {
      console.error('Kill Bill upgrade subscription error:', error);
      throw new Error('Failed to upgrade subscription');
    }
  }

  async cancelSubscription(subscriptionId: string, requestedDate?: string): Promise<void> {
    try {
      await this.client.delete(`/subscriptions/${subscriptionId}`, {
        params: {
          requestedDate: requestedDate || new Date().toISOString().split('T')[0],
        },
      });
    } catch (error) {
      console.error('Kill Bill cancel subscription error:', error);
      throw new Error('Failed to cancel subscription');
    }
  }

  async getInvoices(accountId: string): Promise<KBInvoice[]> {
    try {
      const response = await this.client.get(`/accounts/${accountId}/invoices`);
      return Array.isArray(response.data) ? response.data : [];
    } catch (error) {
      console.error('Kill Bill get invoices error:', error);
      throw new Error('Failed to fetch invoices');
    }
  }

  async getAccountByEmail(email: string): Promise<KBAccount | null> {
    try {
      const response = await this.client.get(`/accounts/search?email=${email}`);
      const accounts = Array.isArray(response.data) ? response.data : [];
      return accounts.length > 0 ? accounts[0] : null;
    } catch (error) {
      console.error('Kill Bill search account error:', error);
      return null;
    }
  }

  async getAllSubscriptions(limit: number = 100, offset: number = 0): Promise<KBSubscription[]> {
    try {
      const response = await this.client.get('/subscriptions', {
        params: { limit, offset },
      });
      return Array.isArray(response.data) ? response.data : [];
    } catch (error) {
      console.error('Kill Bill get all subscriptions error:', error);
      throw new Error('Failed to fetch subscriptions');
    }
  }
}

export const killbillClient = new KillBillClient();
