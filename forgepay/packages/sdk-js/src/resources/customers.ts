import type { FPHttpClient } from '../client.js';
import type { Customer, CustomerCreateParams, ListResponse } from '../types.js';

export class CustomersResource {
  constructor(private readonly client: FPHttpClient) {}

  /**
   * Create a customer.
   *
   * ```ts
   * const customer = await forgepay.customers.create({
   *   email: 'alice@acme.io',
   *   name: 'Alice Smith',
   * });
   * ```
   */
  async create(params: CustomerCreateParams): Promise<Customer> {
    return this.client.post<Customer>('/v1/customers', params);
  }

  async retrieve(customerId: string): Promise<Customer> {
    return this.client.get<Customer>(`/v1/customers/${customerId}`);
  }

  async update(customerId: string, params: Partial<CustomerCreateParams>): Promise<Customer> {
    return this.client.patch<Customer>(`/v1/customers/${customerId}`, params);
  }

  async list(params?: { limit?: number; cursor?: string }): Promise<ListResponse<Customer>> {
    return this.client.get<ListResponse<Customer>>('/v1/customers', params as Record<string, string | number | undefined>);
  }

  async delete(customerId: string): Promise<{ id: string; deleted: true }> {
    return this.client.delete(`/v1/customers/${customerId}`);
  }
}
