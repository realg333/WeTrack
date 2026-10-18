import { z } from 'zod';
import { webhookSchema } from './domain.mjs';

export const providerNames = { cakto: 'Cakto', hotmart: 'Hotmart', blackcat: 'Blackcat' };
export const providerSchema = z.enum(['cakto', 'hotmart', 'blackcat']);
const object = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
const text = (v, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const fail = (message) => Object.assign(new Error(message), { status: 400 });
export function timestamp(value) {
  const n = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
  const d = new Date(n);
  return value !== undefined && value !== null && value !== '' && Number.isFinite(d.getTime())
    ? d.toISOString()
    : undefined;
}
const email = (v) => (z.string().email().safeParse(v).success ? v : undefined);
function phone(v, brazil = false) {
  let n = String(v || '').replace(/\D/g, '');
  if (brazil && [10, 11].includes(n.length)) n = '55' + n;
  return /^[1-9][0-9]{7,14}$/.test(n) ? n : undefined;
}
const payment = (v) =>
  ({
    pix: 'pix',
    pix_auto: 'pix',
    boleto: 'boleto',
    billet: 'boleto',
    financed_billet: 'boleto',
    credit_card: 'credit_card',
    card: 'credit_card',
    threeds: 'credit_card',
    three_ds: 'credit_card',
    debit_card: 'debit_card',
  })[String(v || '').toLowerCase()] || 'other';
const tracking = (d) =>
  Object.fromEntries(
    ['source', 'medium', 'campaign', 'content', 'term'].map((k) => [
      `utm_${k}`,
      text(d[`utm_${k}`], k === 'source' || k === 'medium' ? 100 : 200),
    ]),
  );
function sale(data, extra) {
  const result = webhookSchema.safeParse(data);
  if (!result.success)
    throw fail('O evento não contém os campos obrigatórios de uma venda válida.');
  return { ...result.data, ...extra };
}
function currency(value) {
  if (String(value || 'BRL').toUpperCase() !== 'BRL')
    throw fail('Moeda não suportada. Esta operação recebe somente vendas em BRL.');
}
function amount(value, divisor = 1) {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < 0 ||
    (divisor === 100 && !Number.isSafeInteger(value))
  )
    throw fail('Valor monetário inválido no evento.');
  return Math.round((value / divisor) * 100) / 100;
}

export function normalizeCakto(payload) {
  const event = text(payload.event, 100);
  const supported = {
    purchase_approved: 'approved',
    pix_gerado: 'pending',
    boleto_gerado: 'pending',
    picpay_gerado: 'pending',
    openfinance_nubank_gerado: 'pending',
    purchase_refused: 'canceled',
    refund: 'refunded',
    chargeback: 'chargeback',
    subscription_renewed: 'approved',
  };
  if (!Object.hasOwn(supported, event))
    return {
      event,
      ignored:
        'Evento sem alteração de venda: abandono, solicitação de reembolso ou ciclo da assinatura.',
    };
  const items = Array.isArray(payload.data) ? payload.data : [payload.data];
  if (!items.length || items.length > 100) throw fail('Lista de pedidos inválida.');
  return {
    event,
    orders: items.map((item) => {
      const d = object(item),
        customer = object(d.customer);
      currency(d.currency);
      const state =
        { refunded: 'refunded', chargedback: 'chargeback' }[d.status] || supported[event];
      const happened = timestamp(
        d.refundedAt ||
          d.chargedbackAt ||
          d.canceledAt ||
          (state === 'approved' ? d.paidAt : d.createdAt),
      );
      return sale(
        {
          order_id: text(d.id, 120),
          status: state,
          amount: amount(d.amount ?? (state === 'approved' ? undefined : d.baseAmount)),
          product: text(d.product?.name, 150) || 'Venda Cakto',
          customer_name: text(customer.name, 100) || 'Cliente',
          customer_email: email(customer.email),
          customer_phone: phone(customer.phone, true),
          payment_method: payment(d.paymentMethod),
          ...tracking(d),
          utm_source: text(d.utm_source, 100) || 'direct',
          fbc: text(d.fbc, 300) || undefined,
          fbp: text(d.fbp, 200) || undefined,
          created_at: timestamp(d.createdAt),
          approved_at: timestamp(d.paidAt),
          action_source: event === 'subscription_renewed' ? 'system_generated' : 'website',
        },
        { occurred_at: happened, tracking_code: text(d.sck, 30) },
      );
    }),
  };
}

export function normalizeHotmart(payload) {
  const event = text(payload.event, 100);
  const statuses = {
    PURCHASE_APPROVED: 'approved',
    PURCHASE_COMPLETE: 'approved',
    PURCHASE_BILLET_PRINTED: 'pending',
    PURCHASE_DELAYED: 'pending',
    PURCHASE_CANCELED: 'canceled',
    PURCHASE_EXPIRED: 'canceled',
    PURCHASE_REFUNDED: 'refunded',
    PURCHASE_CHARGEBACK: 'chargeback',
    PURCHASE_PROTEST: 'disputed',
  };
  if (!Object.hasOwn(statuses, event))
    return {
      event,
      ignored:
        'Evento sem alteração de venda. Cancelar uma assinatura não reembolsa compras anteriores.',
    };
  if (payload.version !== '2.0.0') throw fail('Configure a versão 2.0.0 do webhook Hotmart.');
  const d = object(payload.data),
    p = object(d.purchase),
    b = object(d.buyer),
    price = object(p.price),
    origin = object(p.origin);
  if (p.status === 'PARTIALLY_REFUNDED')
    throw fail(
      'Reembolso parcial exige conciliação: o webhook não informa o valor efetivamente devolvido.',
    );
  currency(price.currency_value);
  const brazil = (p.checkout_country?.iso || b.address?.country_iso) === 'BR';
  const number = String(b.checkout_phone || '').replace(/\D/g, '');
  const localPhone =
    brazil && [8, 9].includes(number.length) ? text(b.checkout_phone_code, 5) + number : number;
  const code = [origin.xcod, origin.sck, origin.src].find((v) =>
    /^wt[a-zA-Z0-9]{16,26}$/.test(String(v || '')),
  );
  return {
    event,
    orders: [
      sale(
        {
          order_id: text(p.transaction, 120),
          status: statuses[event],
          amount: amount(price.value),
          product: text(d.product?.name, 150) || 'Venda Hotmart',
          customer_name: text(b.name, 100) || 'Cliente',
          customer_email: email(b.email),
          customer_phone: phone(localPhone, brazil),
          payment_method: payment(p.payment?.type),
          utm_source: !code ? text(origin.src || origin.sck, 100) || 'direct' : 'direct',
          created_at: timestamp(p.order_date) || timestamp(payload.creation_date),
          approved_at: timestamp(p.approved_date),
          action_source: p.recurrence_number > 1 ? 'system_generated' : 'website',
        },
        { occurred_at: timestamp(payload.creation_date), tracking_code: code || '' },
      ),
    ],
  };
}

export function normalizeBlackcat(payload, verified) {
  const event = text(payload.event, 100);
  if (!['transaction.created', 'transaction.paid', 'transaction.failed'].includes(event))
    return { event, ignored: 'Evento sem alteração de venda. Saques não são faturamento.' };
  const d = object(verified);
  if (!text(payload.transactionId, 120) || d.transactionId !== payload.transactionId)
    throw fail('Não foi possível confirmar a transação na Blackcat.');
  const status = {
    PENDING: 'pending',
    PAID: 'approved',
    CANCELLED: 'canceled',
    REFUNDED: 'refunded',
  }[d.status];
  if (!status) throw fail('Status de transação Blackcat não suportado.');
  currency(d.currency || payload.currency);
  const utm = object(payload.utm),
    customer = object(payload.customer);
  return {
    event,
    orders: [
      sale(
        {
          order_id: text(d.transactionId, 120),
          status,
          amount: amount(d.amount, 100),
          product: 'Venda Blackcat',
          customer_name: text(customer.name, 100) || 'Cliente',
          customer_email: email(customer.email),
          customer_phone: phone(customer.phone, true),
          payment_method: payment(d.paymentMethod),
          ...tracking(utm),
          utm_source: text(utm.utm_source, 100) || 'direct',
          created_at: timestamp(d.createdAt) || timestamp(payload.timestamp),
          approved_at: timestamp(d.paidAt),
        },
        {
          occurred_at: timestamp(d.updatedAt) || new Date().toISOString(),
          tracking_code: '',
        },
      ),
    ],
  };
}
