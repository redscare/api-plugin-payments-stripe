import Random from "@reactioncommerce/random";
import { STRIPE_PACKAGE_NAME } from "./constants.js";
import getStripeInstanceForShop from "./getStripeInstanceForShop.js";

const METHOD = "credit";
const PAYMENT_METHOD_NAME = "stripe_card";

// NOTE: The "processor" value is lowercased and then prefixed to various payment Meteor method names,
// so for example, if this is "Stripe", the list refunds method is expected to be named "stripe/refund/list"
const PROCESSOR = "Stripe";

// Stripe risk levels mapped to Reaction risk levels
const riskLevelMap = {
  elevated: "elevated",
  highest: "high"
};

/**
 * @summary Given a Reaction shipping address, returns a Stripe shipping object. Otherwise returns null.
 * @param {Object} address The shipping address
 * @returns {Object|null} The `shipping` object.
 */
function getStripeShippingObject(address) {
  if (!address) return null;

  return {
    address: {
      city: address.city,
      country: address.country,
      line1: address.address1,
      line2: address.address2,
      postal_code: address.postal, // eslint-disable-line camelcase
      state: address.region
    },
    name: address.fullName,
    phone: address.phone
  };
}

/**
 * Creates a Stripe charge for a single fulfillment group
 * @param {Object} context The request context
 * @param {Object} input Input necessary to create a payment
 * @returns {Object} The payment object in schema expected by the orders plugin
 */
export default async function stripeCreateAuthorizedPayment(context, input) {
  const {
    accountId,
    amount,
    billingAddress,
    currencyCode,
    email,
    shippingAddress,
    shopId,
    paymentData: {
      stripeTokenId,
      payment_method,
      payment_intent,
    }
  } = input;

  const stripe = await getStripeInstanceForShop(context);

  let intent = null;
  let stripeCustomerId = null;
  if(!payment_intent) {
    const stripeCustomer = await stripe.customers.create({ email, metadata: { accountId }, payment_method: payment_method.id });
    stripeCustomerId = stripeCustomer.id;
    const intentObject = {
      payment_method: payment_method.id,
      amount: Math.round(amount * 100),
      currency: currencyCode.toLowerCase(),
      customer: stripeCustomerId,
      confirmation_method: 'manual',
      shipping: getStripeShippingObject(shippingAddress),
      confirm: true
    };
    intent = await stripe.paymentIntents.create(intentObject)
  } else {
    intent = await stripe.paymentIntents.confirm(payment_intent.id);
    stripeCustomerId = intent.customer;
  }

  // https://stripe.com/docs/api#create_charge
  
  const charge = intent.charges.data[0] || {};
  const brand = payment_method && payment_method.card.brand || 'no brand';
  const last4 = payment_method && payment_method.card.last4 || '0000';

  return {
    _id: Random.id(),
    address: billingAddress,
    amount: charge.amount / 100,
    cardBrand: brand,
    createdAt: new Date(charge.created * 1000), // convert S to MS
    data: {
      intent,
      chargeId: charge.id || 0,
      charge,
      customerId: stripeCustomerId,
      gqlType: "StripeCardPaymentData" // GraphQL union resolver uses this
    },
    displayName: `${brand} ${last4}`,
    method: METHOD,
    mode: "authorize",
    name: PAYMENT_METHOD_NAME,
    paymentPluginName: STRIPE_PACKAGE_NAME,
    processor: PROCESSOR,
    riskLevel: riskLevelMap[charge.outcome && charge.outcome.risk_level] || "normal",
    shopId,
    status: "created",
    transactionId: charge.id || 0,
    transactions: [charge]
  };
}
